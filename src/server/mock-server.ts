// Mock backend: owns the market engine, numbers every outgoing message,
// serves resyncs, and can inject latency / drops / disconnects for demos and tests.

import {
  DEFAULT_AGGREGATION,
  DEFAULT_TRADES_PER_SEC,
  BATCH_INTERVAL_MS,
  FEED_TRADES_PER_BATCH,
  HEARTBEAT_INTERVAL_MS,
  LMSR_LIQUIDITY,
  MAX_BATCH_INTERVAL_MS,
  MAX_DROP_RATE,
  MAX_LATENCY_MS,
  MAX_SLIPPAGE,
  MIN_BATCH_INTERVAL_MS,
  ORDER_RESULT_CACHE_SIZE,
  PRICE_BOUND,
  RECENT_TRADES_LIMIT,
  REPLAY_BUFFER_SIZE,
  ROUND_HISTORY_LIMIT,
  ROUND_MS,
  START_BALANCE,
} from '@/config/market'
import type { MainToWorker, WorkerToMain } from '@/lib/realtime/bridge'
import {
  type AggregationMode,
  type ClientMessage,
  type DevCommand,
  parseClientMessage,
  type ServerMessage,
  type ServerPayload,
  type SnapshotPayload,
} from '@/lib/realtime/protocol'
import { type EngineConfig, MarketEngine } from '@/server/market-engine'
import { ArrivalGenerator, MEAN_REVERTING_TRADERS } from '@/server/mock-traders'
import { Outbox } from '@/server/outbox'
import { compactTrades } from '@/server/trade-compaction'
import { createCoinflipResolver } from '@/server/resolvers/coinflip-resolver'
import { createRng, type Rng } from '@/server/rng'

export type MockServerDeps = {
  post: (message: WorkerToMain) => void
  now: () => number
  /** Monotonic clock for tick timing only (performance.now in the worker). */
  perfNow: () => number
  rng: Rng
  schedule: (fn: () => void, ms: number) => void
}

export type ServerConfig = EngineConfig & {
  tradesPerSec: number
  replayCapacity: number
  /** Initial interval between `trades` batches; changeable at runtime via a dev command. */
  batchIntervalMs: number
  /** Initial `trades` aggregation; changeable at runtime via a dev command. */
  aggregation: AggregationMode
}

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  liquidity: LMSR_LIQUIDITY,
  priceBound: PRICE_BOUND,
  startBalance: START_BALANCE,
  maxSlippage: MAX_SLIPPAGE,
  roundMs: ROUND_MS,
  recentTradesLimit: RECENT_TRADES_LIMIT,
  roundHistoryLimit: ROUND_HISTORY_LIMIT,
  orderResultCacheLimit: ORDER_RESULT_CACHE_SIZE,
  tradesPerSec: DEFAULT_TRADES_PER_SEC,
  replayCapacity: REPLAY_BUFFER_SIZE,
  batchIntervalMs: BATCH_INTERVAL_MS,
  aggregation: DEFAULT_AGGREGATION,
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
}

type PendingDelivery = { data: string; dueAt: number }

export class MockServer {
  private readonly deps: MockServerDeps
  private readonly engine: MarketEngine
  private readonly outbox: Outbox
  private readonly arrivals: ArrivalGenerator
  private readonly connections = new Set<number>()
  /** Separate stream so that fault settings never change trades or round outcomes. */
  private readonly faultRng: Rng
  private latencyMs = 0
  private dropRate = 0
  private batchIntervalMs: number
  private aggregation: AggregationMode
  private lastPublishAt: number
  /** Tick timing for the bench (`report_server_stats`): two clock reads per tick. */
  private tickCount = 0
  private tickMsTotal = 0
  private tickMsMax = 0
  /** Per-connection FIFO of delayed messages; drained by a single timer per connection. */
  private readonly pending = new Map<number, PendingDelivery[]>()

  constructor(deps: MockServerDeps, config: ServerConfig) {
    this.deps = deps
    this.batchIntervalMs = config.batchIntervalMs
    this.aggregation = config.aggregation
    this.faultRng = createRng(Math.floor(deps.rng() * 4_294_967_296))
    const now = deps.now()
    this.engine = new MarketEngine(
      config,
      { rng: deps.rng, resolver: createCoinflipResolver(deps.rng), traders: MEAN_REVERTING_TRADERS },
      now,
    )
    this.outbox = new Outbox(config.replayCapacity)
    this.arrivals = new ArrivalGenerator(deps.rng, now, config.tradesPerSec)
    // Publish the initial round so every snapshot has seq >= 1 (no connections yet, nothing to broadcast).
    this.outbox.publish({ type: 'round_started', ts: now, round: this.engine.getRound(), price: this.engine.getPrice() })
    this.lastPublishAt = now
  }

  getLastSeq(): number {
    return this.outbox.lastSeq
  }

  /** Full state as of `getLastSeq()`; used by tests to compare against what a client rebuilt. */
  getSnapshot(): SnapshotPayload & { seq: number } {
    return { ...this.engine.snapshot(this.deps.now()), seq: this.outbox.lastSeq }
  }

  onBridgeMessage(message: MainToWorker): void {
    switch (message.kind) {
      case 'connect':
        this.connections.add(message.connId)
        this.deps.post({ kind: 'open', connId: message.connId })
        return
      case 'close':
        this.connections.delete(message.connId)
        this.pending.delete(message.connId)
        return
      case 'data': {
        if (!this.connections.has(message.connId)) return
        const parsed = parseClientMessage(message.data)
        if (parsed !== 'invalid') this.handleClient(message.connId, parsed)
        return
      }
    }
  }

  /** Current delay between `tick()` calls; the host loop re-reads it after every tick. */
  getBatchIntervalMs(): number {
    return this.batchIntervalMs
  }

  /** Called every `getBatchIntervalMs()`: generate mock arrivals, execute due events, broadcast. */
  tick(): void {
    const startedAt = this.deps.perfNow()
    const now = this.deps.now()
    for (const arrival of this.arrivals.generate(now)) this.engine.enqueueMock(arrival.ts, arrival.shares)
    for (const payload of this.engine.advance(now)) this.broadcast(this.publish(this.aggregate(payload)))
    const elapsed = this.deps.perfNow() - startedAt
    this.tickCount++
    this.tickMsTotal += elapsed
    if (elapsed > this.tickMsMax) this.tickMsMax = elapsed
  }

  /** Compaction happens before publish, so replays carry exactly what live clients got. */
  private aggregate(payload: ServerPayload): ServerPayload {
    if (payload.type !== 'trades' || this.aggregation === 'full') return payload
    return { ...payload, ...compactTrades(payload.items, FEED_TRADES_PER_BATCH) }
  }

  /** Sent only when nothing else went out during the last heartbeat interval. */
  heartbeat(): void {
    const now = this.deps.now()
    if (now - this.lastPublishAt < HEARTBEAT_INTERVAL_MS) return
    this.broadcast(this.publish({ type: 'heartbeat', ts: now }))
  }

  private publish(payload: ServerPayload): ServerMessage {
    this.lastPublishAt = this.deps.now()
    return this.outbox.publish(payload)
  }

  private handleClient(connId: number, message: ClientMessage): void {
    const now = this.deps.now()
    switch (message.type) {
      case 'resync': {
        const replay = this.outbox.replayFrom(message.fromSeq)
        if (replay === 'snapshot_required') {
          this.send(connId, { ...this.engine.snapshot(now), seq: this.outbox.lastSeq })
          return
        }
        if (replay.length === 0) {
          // The client is already up to date. Publish a heartbeat so it sees seq = lastSeq + 1
          // and goes live now instead of waiting for the next trade or quiet-interval heartbeat.
          this.broadcast(this.publish({ type: 'heartbeat', ts: now }))
          return
        }
        for (const replayed of replay) this.send(connId, replayed)
        return
      }
      case 'quote':
        this.broadcast(this.publish(this.engine.quote(now, message)))
        return
      case 'place_order':
        // Stamped with the server receive time; executed in ts order on the next tick.
        this.engine.enqueueOrder(now, message)
        return
      case 'dev':
        this.applyDev(message.command)
        return
    }
  }

  private applyDev(command: DevCommand): void {
    switch (command.kind) {
      case 'set_rate':
        this.arrivals.setRate(command.tradesPerSec)
        return
      case 'set_latency':
        this.latencyMs = clamp(command.ms, 0, MAX_LATENCY_MS)
        return
      case 'set_drop_rate':
        this.dropRate = clamp(command.rate, 0, MAX_DROP_RATE)
        return
      case 'set_batch_interval':
        this.batchIntervalMs = clamp(command.ms, MIN_BATCH_INTERVAL_MS, MAX_BATCH_INTERVAL_MS)
        return
      case 'set_aggregation':
        this.aggregation = command.mode
        return
      case 'set_balance': {
        this.engine.setBalance(command.usd)
        const ts = this.deps.now()
        this.broadcast(this.publish({ type: 'account', ts, account: this.engine.getAccount() }))
        return
      }
      case 'report_server_stats': {
        const { tickCount, tickMsTotal, tickMsMax } = this
        this.tickMsMax = 0
        this.broadcast(this.publish({ type: 'server_stats', ts: this.deps.now(), tickCount, tickMsTotal, tickMsMax }))
        return
      }
      case 'force_disconnect':
        for (const connId of this.connections) this.deps.post({ kind: 'closed', connId })
        this.connections.clear()
        this.pending.clear()
        return
    }
  }

  private broadcast(message: ServerMessage): void {
    for (const connId of this.connections) this.send(connId, message)
  }

  private send(connId: number, message: ServerMessage): void {
    if (this.dropRate > 0 && this.faultRng() < this.dropRate) return
    const data = JSON.stringify(message)
    const queue = this.pending.get(connId)
    // Never overtake a message that is still waiting, even if latency was lowered meanwhile.
    if (this.latencyMs === 0 && queue === undefined) {
      this.deps.post({ kind: 'data', connId, data })
      return
    }
    const delivery: PendingDelivery = { data, dueAt: this.deps.now() + this.latencyMs }
    if (queue !== undefined) {
      queue.push(delivery)
      return
    }
    const fresh = [delivery]
    this.pending.set(connId, fresh)
    this.scheduleDrain(connId, fresh)
  }

  private scheduleDrain(connId: number, queue: PendingDelivery[]): void {
    const delay = Math.max(1, queue[0].dueAt - this.deps.now())
    this.deps.schedule(() => this.drain(connId, queue), delay)
  }

  private drain(connId: number, queue: PendingDelivery[]): void {
    // The queue was dropped by close/force_disconnect (a reconnect gets a fresh one).
    if (this.pending.get(connId) !== queue) return
    const now = this.deps.now()
    while (queue.length > 0 && queue[0].dueAt <= now) {
      const next = queue.shift()
      if (next !== undefined) this.deps.post({ kind: 'data', connId, data: next.data })
    }
    if (queue.length === 0) {
      this.pending.delete(connId)
      return
    }
    this.scheduleDrain(connId, queue)
  }
}
