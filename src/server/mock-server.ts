// Mock backend: owns the market engine, numbers every outgoing message,
// serves resyncs, and can inject latency / drops / disconnects for demos and tests.

import {
  DEFAULT_TRADES_PER_SEC,
  HEARTBEAT_INTERVAL_MS,
  LMSR_LIQUIDITY,
  MAX_DROP_RATE,
  MAX_LATENCY_MS,
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
import { createCoinflipResolver } from '@/server/resolvers/coinflip-resolver'
import { createRng, type Rng } from '@/server/rng'

export type MockServerDeps = {
  post: (message: WorkerToMain) => void
  now: () => number
  rng: Rng
  schedule: (fn: () => void, ms: number) => void
}

export type ServerConfig = EngineConfig & { tradesPerSec: number; replayCapacity: number }

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  liquidity: LMSR_LIQUIDITY,
  priceBound: PRICE_BOUND,
  startBalance: START_BALANCE,
  roundMs: ROUND_MS,
  recentTradesLimit: RECENT_TRADES_LIMIT,
  roundHistoryLimit: ROUND_HISTORY_LIMIT,
  orderResultCacheLimit: ORDER_RESULT_CACHE_SIZE,
  tradesPerSec: DEFAULT_TRADES_PER_SEC,
  replayCapacity: REPLAY_BUFFER_SIZE,
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
  private lastPublishAt: number
  /** Per-connection FIFO of delayed messages; drained by a single timer per connection. */
  private readonly pending = new Map<number, PendingDelivery[]>()

  constructor(deps: MockServerDeps, config: ServerConfig) {
    this.deps = deps
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

  /** Called every BATCH_INTERVAL_MS: generate mock arrivals, execute due events, broadcast. */
  tick(): void {
    const now = this.deps.now()
    for (const arrival of this.arrivals.generate(now)) this.engine.enqueueMock(arrival.ts, arrival.shares)
    for (const payload of this.engine.advance(now)) this.broadcast(this.publish(payload))
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
