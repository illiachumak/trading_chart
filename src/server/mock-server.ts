// Mock backend: owns the market engine, numbers every outgoing message,
// serves resyncs, and can inject latency / drops / disconnects for demos and tests.

import {
  DEFAULT_TRADES_PER_SEC,
  LMSR_LIQUIDITY,
  MAX_DROP_RATE,
  MAX_LATENCY_MS,
  PRICE_BOUND,
  RECENT_TRADES_LIMIT,
  REPLAY_BUFFER_SIZE,
  ROUND_HISTORY_LIMIT,
  ROUND_MS,
  START_BALANCE,
} from '@/config/market'
import type { MainToWorker, WorkerToMain } from '@/lib/realtime/bridge'
import { type ClientMessage, type DevCommand, parseClientMessage, type ServerMessage } from '@/lib/realtime/protocol'
import { type EngineConfig, MarketEngine } from '@/server/market-engine'
import { ArrivalGenerator, MEAN_REVERTING_TRADERS } from '@/server/mock-traders'
import { Outbox } from '@/server/outbox'
import { createCoinflipResolver } from '@/server/resolvers/coinflip-resolver'
import type { Rng } from '@/server/rng'

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
  tradesPerSec: DEFAULT_TRADES_PER_SEC,
  replayCapacity: REPLAY_BUFFER_SIZE,
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
}

export class MockServer {
  private readonly deps: MockServerDeps
  private readonly engine: MarketEngine
  private readonly outbox: Outbox
  private readonly arrivals: ArrivalGenerator
  private readonly connections = new Set<number>()
  private latencyMs = 0
  private dropRate = 0

  constructor(deps: MockServerDeps, config: ServerConfig) {
    this.deps = deps
    const now = deps.now()
    this.engine = new MarketEngine(
      config,
      { rng: deps.rng, resolver: createCoinflipResolver(deps.rng), traders: MEAN_REVERTING_TRADERS },
      now,
    )
    this.outbox = new Outbox(config.replayCapacity)
    this.arrivals = new ArrivalGenerator(deps.rng, now, config.tradesPerSec)
  }

  getLastSeq(): number {
    return this.outbox.lastSeq
  }

  /** Full state as of `getLastSeq()`; used by tests to compare against what a client rebuilt. */
  getSnapshot(): ServerMessage {
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
    for (const payload of this.engine.advance(now)) this.broadcast(this.outbox.publish(payload))
  }

  heartbeat(): void {
    this.broadcast(this.outbox.publish({ type: 'heartbeat', ts: this.deps.now() }))
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
        this.broadcast(this.outbox.publish(this.engine.quote(now, message)))
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
        return
    }
  }

  private broadcast(message: ServerMessage): void {
    for (const connId of this.connections) this.send(connId, message)
  }

  private send(connId: number, message: ServerMessage): void {
    if (this.dropRate > 0 && this.deps.rng() < this.dropRate) return
    const data = JSON.stringify(message)
    const deliver = (): void => {
      if (this.connections.has(connId)) this.deps.post({ kind: 'data', connId, data })
    }
    if (this.latencyMs > 0) this.deps.schedule(deliver, this.latencyMs)
    else deliver()
  }
}
