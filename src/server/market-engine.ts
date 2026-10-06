// Authoritative market state. Pure: time is passed in, randomness is injected.
// Events (mock trades, user orders) are executed strictly in `ts` order,
// regardless of the order they were enqueued in.

import type {
  Account,
  ChartPoint,
  OrderResult,
  PlaceOrder,
  Position,
  QuoteRequest,
  RejectReason,
  RoundInfo,
  RoundResult,
  ServerPayload,
  SnapshotPayload,
  Trade,
} from '@/lib/realtime/protocol'
import { buyShares, buyWithBudget, sidePrice, yesPrice } from '@/server/lmsr'
import type { MockTraderModel } from '@/server/mock-traders'
import type { Resolver } from '@/server/resolvers/types'
import type { Rng } from '@/server/rng'

export type EngineConfig = {
  liquidity: number
  priceBound: number
  startBalance: number
  roundMs: number
  recentTradesLimit: number
  roundHistoryLimit: number
  orderResultCacheLimit: number
}

export type EngineDeps = { rng: Rng; resolver: Resolver; traders: MockTraderModel }

type QueuedEvent =
  | { kind: 'mock'; ts: number; insertedAt: number; shares: number }
  | { kind: 'order'; ts: number; insertedAt: number; request: PlaceOrder }

type Execution = { result: OrderResult; trade: Trade | 'none' }

export type QuoteResultPayload = Extract<ServerPayload, { type: 'quote_result' }>

const EPSILON = 1e-9
const EMPTY_POSITION: Position = { yesShares: 0, noShares: 0, spent: 0, payoutIfYes: 0, payoutIfNo: 0 }

function toSecond(ts: number): number {
  return Math.floor(ts / 1_000)
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

export class MarketEngine {
  private readonly config: EngineConfig
  private readonly deps: EngineDeps
  private queue: QueuedEvent[] = []
  private insertCounter = 0
  private tradeCounter = 0
  private diff = 0
  private round: RoundInfo
  private history: ChartPoint[] = []
  private recentTrades: Trade[] = []
  private userTrades: Trade[] = []
  private balance: number
  private position: Position = EMPTY_POSITION
  private roundHistory: RoundResult[] = []
  private readonly orderResults = new Map<string, OrderResult>()

  constructor(config: EngineConfig, deps: EngineDeps, now: number) {
    this.config = config
    this.deps = deps
    this.balance = config.startBalance
    this.round = this.openRound(1, now)
  }

  getRound(): RoundInfo {
    return this.round
  }

  getPrice(): number {
    return yesPrice(this.diff, this.config.liquidity)
  }

  enqueueMock(ts: number, shares: number): void {
    this.queue.push({ kind: 'mock', ts, insertedAt: this.insertCounter++, shares })
  }

  enqueueOrder(ts: number, request: PlaceOrder): void {
    this.queue.push({ kind: 'order', ts, insertedAt: this.insertCounter++, request })
  }

  quote(ts: number, request: QuoteRequest): QuoteResultPayload {
    const { requestId, side, amountUsd } = request
    const unavailable: QuoteResultPayload = {
      type: 'quote_result',
      ts,
      quote: { status: 'unavailable', requestId, side, amountUsd },
    }
    if (!isPositiveFinite(amountUsd)) return unavailable
    const fill = buyWithBudget(this.diff, side, amountUsd, this.config.liquidity, this.config.priceBound)
    if (fill.shares <= EPSILON) return unavailable
    return {
      type: 'quote_result',
      ts,
      quote: {
        status: 'ok',
        requestId,
        side,
        amountUsd,
        shares: fill.shares,
        avgPrice: fill.cost / fill.shares,
        cost: fill.cost,
        potentialPayout: fill.shares,
        potentialProfit: fill.shares - fill.cost,
        clipped: fill.clipped,
      },
    }
  }

  advance(now: number): ServerPayload[] {
    const out: ServerPayload[] = []
    let trades: Trade[] = []
    let results: OrderResult[] = []
    let accountDirty = false

    const flush = (ts: number): void => {
      if (trades.length > 0) out.push({ type: 'trades', ts, items: trades })
      for (const result of results) out.push({ type: 'order_result', ts, result })
      if (accountDirty) out.push({ type: 'account', ts, account: this.account() })
      trades = []
      results = []
      accountDirty = false
    }

    const rollover = (until: number): void => {
      while (until >= this.round.endTs) {
        const endTs = this.round.endTs
        flush(endTs)
        out.push(this.resolveRound(endTs))
        this.round = this.openRound(this.round.id + 1, endTs)
        out.push({ type: 'round_started', ts: endTs, round: this.round, price: this.getPrice() })
        // Built after the new round is open, so it carries the new roundId and an empty position.
        out.push({ type: 'account', ts: endTs, account: this.account() })
      }
    }

    for (const event of this.takeDue(now)) {
      rollover(event.ts)
      if (event.kind === 'mock') {
        const trade = this.executeMock(event.ts, event.shares)
        if (trade !== 'none') trades.push(trade)
        continue
      }
      const execution = this.executeOrder(event.ts, event.request)
      results.push(execution.result)
      if (execution.trade !== 'none') {
        trades.push(execution.trade)
        accountDirty = true
      }
    }
    rollover(now)
    flush(now)
    return out
  }

  snapshot(now: number): SnapshotPayload {
    return {
      type: 'snapshot',
      ts: now,
      round: this.round,
      price: this.getPrice(),
      history: [...this.history],
      recentTrades: [...this.recentTrades].reverse(),
      userTrades: [...this.userTrades],
      account: this.account(),
    }
  }

  private takeDue(now: number): QueuedEvent[] {
    this.queue.sort((a, b) => a.ts - b.ts || a.insertedAt - b.insertedAt)
    const firstFuture = this.queue.findIndex((event) => event.ts > now)
    if (firstFuture === -1) {
      const due = this.queue
      this.queue = []
      return due
    }
    const due = this.queue.slice(0, firstFuture)
    this.queue = this.queue.slice(firstFuture)
    return due
  }

  private executeMock(ts: number, shares: number): Trade | 'none' {
    const side = this.deps.traders.pickSide(this.getPrice(), this.deps.rng)
    const fill = buyShares(this.diff, side, shares, this.config.liquidity, this.config.priceBound)
    if (fill.shares <= EPSILON) return 'none'
    this.diff = fill.diffAfter
    return this.recordTrade({
      id: ++this.tradeCounter,
      ts,
      side,
      shares: fill.shares,
      priceAfter: this.getPrice(),
      source: 'mock',
    })
  }

  private executeOrder(ts: number, request: PlaceOrder): Execution {
    const existing = this.orderResults.get(request.clientOrderId)
    if (existing !== undefined) return { result: existing, trade: 'none' }
    const execution = this.fillOrder(ts, request)
    this.orderResults.set(request.clientOrderId, execution.result)
    // Map iterates in insertion order, so the first key is the oldest.
    if (this.orderResults.size > this.config.orderResultCacheLimit) {
      const [oldest] = this.orderResults.keys()
      this.orderResults.delete(oldest)
    }
    return execution
  }

  private fillOrder(ts: number, request: PlaceOrder): Execution {
    const { clientOrderId, side, amountUsd } = request
    const currentPrice = sidePrice(this.diff, side, this.config.liquidity)
    const reject = (reason: RejectReason): Execution => ({
      result: { status: 'rejected', clientOrderId, side, reason, currentPrice },
      trade: 'none',
    })

    if (request.roundId !== this.round.id) return reject('round_closed')
    if (
      !isPositiveFinite(amountUsd) ||
      !isPositiveFinite(request.expectedPrice) ||
      !Number.isFinite(request.maxSlippage) ||
      request.maxSlippage < 0
    ) {
      return reject('invalid')
    }
    if (amountUsd > this.balance + EPSILON) return reject('insufficient_balance')

    const fill = buyWithBudget(this.diff, side, amountUsd, this.config.liquidity, this.config.priceBound)
    if (fill.shares <= EPSILON) return reject('price_limit')
    const avgPrice = fill.cost / fill.shares
    if (avgPrice > request.expectedPrice * (1 + request.maxSlippage) + EPSILON) return reject('slippage')

    this.diff = fill.diffAfter
    this.balance -= fill.cost
    const yesShares = this.position.yesShares + (side === 'yes' ? fill.shares : 0)
    const noShares = this.position.noShares + (side === 'no' ? fill.shares : 0)
    this.position = {
      yesShares,
      noShares,
      spent: this.position.spent + fill.cost,
      payoutIfYes: yesShares,
      payoutIfNo: noShares,
    }
    const trade = this.recordTrade({
      id: ++this.tradeCounter,
      ts,
      side,
      shares: fill.shares,
      priceAfter: this.getPrice(),
      source: 'user',
      clientOrderId,
    })
    return {
      result: {
        status: fill.clipped ? 'partial' : 'filled',
        clientOrderId,
        side,
        shares: fill.shares,
        avgPrice,
        cost: fill.cost,
        refund: amountUsd - fill.cost,
      },
      trade,
    }
  }

  private recordTrade(trade: Trade): Trade {
    this.recentTrades.push(trade)
    if (this.recentTrades.length > this.config.recentTradesLimit) this.recentTrades.shift()
    if (trade.source === 'user') this.userTrades.push(trade)
    const point: ChartPoint = { time: toSecond(trade.ts), value: trade.priceAfter }
    const last = this.history.at(-1)
    if (last !== undefined && last.time === point.time) {
      this.history[this.history.length - 1] = point
    } else {
      this.history.push(point)
    }
    return trade
  }

  private resolveRound(endTs: number): ServerPayload {
    const roundId = this.round.id
    const outcome = this.deps.resolver.resolve(this.round)
    const payout = outcome === 'yes' ? this.position.yesShares : this.position.noShares
    const spent = this.position.spent
    this.balance += payout
    this.roundHistory = [{ roundId, outcome, spent, payout, pnl: payout - spent }, ...this.roundHistory].slice(
      0,
      this.config.roundHistoryLimit,
    )
    this.position = EMPTY_POSITION
    return { type: 'round_resolved', ts: endTs, roundId, outcome, payout }
  }

  private openRound(id: number, startTs: number): RoundInfo {
    const round: RoundInfo = { id, startTs, endTs: startTs + this.config.roundMs }
    this.diff = 0
    this.position = EMPTY_POSITION
    this.userTrades = []
    this.history = [{ time: toSecond(startTs), value: yesPrice(0, this.config.liquidity) }]
    this.deps.resolver.onRoundStart(round)
    return round
  }

  private account(): Account {
    return {
      balance: this.balance,
      roundId: this.round.id,
      position: this.position,
      history: [...this.roundHistory],
    }
  }
}
