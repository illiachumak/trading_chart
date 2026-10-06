// Low-frequency market view for React. Tick-rate data is coalesced here
// (≤ 1 publish per throttle window); the chart does not read from this store.

import { ClockSync } from '@/lib/realtime/clock-sync'
import type { ConnectionStatus, MarketClient } from '@/lib/realtime/market-client'
import type { RoundInfo, ServerMessage, Side, Trade } from '@/lib/realtime/protocol'
import { createExternalStore, type ExternalStore } from '@/lib/utils/external-store'

export type Resolution = { roundId: number; outcome: Side }

export type MarketReady = {
  phase: 'ready'
  status: ConnectionStatus
  round: RoundInfo
  price: number
  /** Newest first. */
  recentTrades: readonly Trade[]
  /** Current round, oldest first. */
  userTrades: readonly Trade[]
  lastResolution: Resolution | 'none'
  clockOffsetMs: number
}

export type MarketState = { phase: 'loading'; status: ConnectionStatus } | MarketReady

export type MarketStoreOptions = {
  throttleMs: number
  recentTradesLimit: number
  clockWindow: number
  now: () => number
}

const EMPTY_TRADES: readonly Trade[] = []

export const selectStatus = (s: MarketState): ConnectionStatus => s.status
export const selectRound = (s: MarketState): RoundInfo | 'loading' => (s.phase === 'ready' ? s.round : 'loading')
export const selectPrice = (s: MarketState): number | 'loading' => (s.phase === 'ready' ? s.price : 'loading')
export const selectRecentTrades = (s: MarketState): readonly Trade[] =>
  s.phase === 'ready' ? s.recentTrades : EMPTY_TRADES
export const selectUserTrades = (s: MarketState): readonly Trade[] =>
  s.phase === 'ready' ? s.userTrades : EMPTY_TRADES
export const selectLastResolution = (s: MarketState): Resolution | 'none' =>
  s.phase === 'ready' ? s.lastResolution : 'none'
export const selectClockOffset = (s: MarketState): number => (s.phase === 'ready' ? s.clockOffsetMs : 0)

type Timer = ReturnType<typeof setTimeout>

export class MarketStore {
  readonly store: ExternalStore<MarketState>
  private readonly options: MarketStoreOptions
  private draft: MarketState = { phase: 'loading', status: 'idle' }
  private clock: ClockSync
  private lastPublishAt = Number.NEGATIVE_INFINITY
  private trailing: Timer | 'none' = 'none'

  constructor(options: MarketStoreOptions) {
    this.options = options
    this.clock = new ClockSync(options.clockWindow)
    this.store = createExternalStore(this.draft)
  }

  attach(client: Pick<MarketClient, 'onMessage' | 'onStatus'>): () => void {
    const offMessage = client.onMessage((message) => this.handle(message))
    const offStatus = client.onStatus((status) => {
      this.draft = { ...this.draft, status }
      this.publishNow()
    })
    return () => {
      offMessage()
      offStatus()
      this.cancelTrailing()
    }
  }

  reset(): void {
    this.clock = new ClockSync(this.options.clockWindow)
    this.draft = { phase: 'loading', status: this.draft.status }
    this.publishNow()
  }

  handle(message: ServerMessage): void {
    if (message.type === 'heartbeat') this.clock.observe(message.ts, this.options.now())
    if (message.type === 'snapshot') {
      this.draft = {
        phase: 'ready',
        status: this.draft.status,
        round: message.round,
        price: message.price,
        recentTrades: message.recentTrades.slice(0, this.options.recentTradesLimit),
        userTrades: message.userTrades,
        lastResolution: this.draft.phase === 'ready' ? this.draft.lastResolution : 'none',
        clockOffsetMs: this.clock.offsetMs,
      }
      this.publishNow()
      return
    }
    const draft = this.draft
    if (draft.phase !== 'ready') return
    switch (message.type) {
      case 'trades': {
        const last = message.items.at(-1)
        if (last === undefined) return
        const userItems = message.items.filter((t) => t.source === 'user')
        this.draft = {
          ...draft,
          price: last.priceAfter,
          recentTrades: [...[...message.items].reverse(), ...draft.recentTrades].slice(
            0,
            this.options.recentTradesLimit,
          ),
          userTrades: userItems.length > 0 ? [...draft.userTrades, ...userItems] : draft.userTrades,
        }
        this.publishThrottled()
        return
      }
      case 'round_started':
        this.draft = { ...draft, round: message.round, price: message.price, userTrades: EMPTY_TRADES }
        this.publishNow()
        return
      case 'round_resolved':
        this.draft = { ...draft, lastResolution: { roundId: message.roundId, outcome: message.outcome } }
        this.publishNow()
        return
      case 'heartbeat': {
        const offset = this.clock.offsetMs
        if (offset === draft.clockOffsetMs) return
        this.draft = { ...draft, clockOffsetMs: offset }
        this.publishThrottled()
        return
      }
      default:
        return
    }
  }

  private cancelTrailing(): void {
    if (this.trailing !== 'none') clearTimeout(this.trailing)
    this.trailing = 'none'
  }

  private publishNow(): void {
    this.cancelTrailing()
    this.lastPublishAt = this.options.now()
    this.store.setState(this.draft)
  }

  private publishThrottled(): void {
    if (this.trailing !== 'none') return
    const wait = this.lastPublishAt + this.options.throttleMs - this.options.now()
    if (wait <= 0) {
      this.publishNow()
      return
    }
    this.trailing = setTimeout(() => {
      this.trailing = 'none'
      this.publishNow()
    }, wait)
  }
}
