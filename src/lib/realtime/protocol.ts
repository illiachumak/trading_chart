// Wire contract between the market backend (mock worker today, real WS later) and the client.
// Every server message carries a monotonically increasing `seq` and the server `ts` (ms).

import { isRecord } from '@/lib/utils/is-record'

export type Side = 'yes' | 'no'

export type RoundInfo = { id: number; startTs: number; endTs: number }

/** One chart point per second: `time` is unix seconds, `value` is the YES price (0..1). */
export type ChartPoint = { time: number; value: number }

type TradeBase = { id: number; ts: number; side: Side; shares: number; priceAfter: number }
/** `priceAfter` is the YES price right after this trade executed. */
export type Trade =
  | (TradeBase & { source: 'mock' })
  | (TradeBase & { source: 'user'; clientOrderId: string })

export type Position = {
  yesShares: number
  noShares: number
  spent: number
  payoutIfYes: number
  payoutIfNo: number
}

export type RoundResult = { roundId: number; outcome: Side; spent: number; payout: number; pnl: number }

export type Account = {
  balance: number
  roundId: number
  position: Position
  /** Newest first. */
  history: readonly RoundResult[]
}

export type RejectReason = 'slippage' | 'round_closed' | 'insufficient_balance' | 'invalid' | 'price_limit'

export type OrderResult =
  | {
      status: 'filled' | 'partial'
      clientOrderId: string
      side: Side
      shares: number
      avgPrice: number
      cost: number
      refund: number
    }
  | { status: 'rejected'; clientOrderId: string; side: Side; reason: RejectReason; currentPrice: number }

export type QuoteResult =
  | {
      status: 'ok'
      requestId: number
      side: Side
      amountUsd: number
      shares: number
      avgPrice: number
      cost: number
      potentialPayout: number
      potentialProfit: number
      clipped: boolean
    }
  | { status: 'unavailable'; requestId: number; side: Side; amountUsd: number }

export type DevCommand =
  | { kind: 'set_rate'; tradesPerSec: number }
  | { kind: 'set_latency'; ms: number }
  | { kind: 'set_drop_rate'; rate: number }
  | { kind: 'force_disconnect' }

export type PlaceOrder = {
  type: 'place_order'
  clientOrderId: string
  /** The round the user intended to trade in; a mismatch at execution time → `round_closed`. */
  roundId: number
  side: Side
  amountUsd: number
  /** Average price the user saw (from the latest quote). */
  expectedPrice: number
  /** Allowed relative worsening of the average price, e.g. 0.02 = 2%. */
  maxSlippage: number
}

export type QuoteRequest = { type: 'quote'; requestId: number; side: Side; amountUsd: number }

export type ClientMessage =
  | PlaceOrder
  | QuoteRequest
  | { type: 'resync'; fromSeq: number }
  | { type: 'dev'; command: DevCommand }

export type ServerPayload =
  | { type: 'trades'; ts: number; items: readonly Trade[] }
  | { type: 'round_started'; ts: number; round: RoundInfo; price: number }
  | { type: 'round_resolved'; ts: number; roundId: number; outcome: Side; payout: number }
  | { type: 'order_result'; ts: number; result: OrderResult }
  | { type: 'quote_result'; ts: number; quote: QuoteResult }
  | { type: 'account'; ts: number; account: Account }
  | { type: 'heartbeat'; ts: number }

export type SnapshotPayload = {
  type: 'snapshot'
  ts: number
  round: RoundInfo
  price: number
  /** Current round, one point per second, ascending. */
  history: readonly ChartPoint[]
  /** Newest first. */
  recentTrades: readonly Trade[]
  /** The user's trades in the current round, oldest first. */
  userTrades: readonly Trade[]
  account: Account
}

/**
 * A snapshot's `seq` is the last seq whose effects it already includes.
 * seq starts at 1; a snapshot's seq is always >= 1.
 */
export type ServerMessage = (ServerPayload | SnapshotPayload) & { seq: number }

const SERVER_TYPES: ReadonlySet<string> = new Set([
  'snapshot',
  'trades',
  'round_started',
  'round_resolved',
  'order_result',
  'quote_result',
  'account',
  'heartbeat',
])

// Shallow guard: the payload comes from our own backend, we only verify the envelope.
export function isServerMessage(value: unknown): value is ServerMessage {
  return (
    isRecord(value) &&
    typeof value.type === 'string' &&
    SERVER_TYPES.has(value.type) &&
    typeof value.seq === 'number' &&
    typeof value.ts === 'number'
  )
}

function isSide(value: unknown): value is Side {
  return value === 'yes' || value === 'no'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

function isDevCommand(value: unknown): value is DevCommand {
  if (!isRecord(value)) return false
  switch (value.kind) {
    case 'set_rate':
      return isNumber(value.tradesPerSec)
    case 'set_latency':
      return isNumber(value.ms)
    case 'set_drop_rate':
      return isNumber(value.rate)
    case 'force_disconnect':
      return true
    default:
      return false
  }
}

// Deep guard: the server must not trust client input. Range checks (amount > 0 etc.)
// stay in the engine so that an out-of-range order still gets an `invalid` rejection.
export function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value)) return false
  switch (value.type) {
    case 'place_order':
      return (
        typeof value.clientOrderId === 'string' &&
        value.clientOrderId.length > 0 &&
        isNumber(value.roundId) &&
        isSide(value.side) &&
        isNumber(value.amountUsd) &&
        isNumber(value.expectedPrice) &&
        isNumber(value.maxSlippage)
      )
    case 'quote':
      return isNumber(value.requestId) && isSide(value.side) && isNumber(value.amountUsd)
    case 'resync':
      return Number.isInteger(value.fromSeq)
    case 'dev':
      return isDevCommand(value.command)
    default:
      return false
  }
}

function parseJson(raw: string): unknown {
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed
  } catch {
    return 'invalid-json'
  }
}

export function parseServerMessage(raw: string): ServerMessage | 'invalid' {
  const value = parseJson(raw)
  return isServerMessage(value) ? value : 'invalid'
}

export function parseClientMessage(raw: string): ClientMessage | 'invalid' {
  const value = parseJson(raw)
  return isClientMessage(value) ? value : 'invalid'
}
