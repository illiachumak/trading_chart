import type { MarketClient } from '@/lib/realtime/market-client'
import type { Account, OrderResult, PlaceOrder, Position, QuoteResult, RoundResult, ServerMessage, Side } from '@/lib/realtime/protocol'
import { createExternalStore, type ExternalStore } from '@/lib/utils/external-store'

export type OrderStatus =
  | { kind: 'idle' }
  | { kind: 'pending'; clientOrderId: string }
  | { kind: 'done'; result: OrderResult }

export type AccountStoreState = {
  account: Account | 'loading'
  order: OrderStatus
  quote: QuoteResult | 'none'
}

export type OrderRequest = Omit<PlaceOrder, 'type'>

type AccountClient = Pick<MarketClient, 'onMessage' | 'onStatus' | 'send'>

const EMPTY_HISTORY: readonly RoundResult[] = []

const INITIAL: AccountStoreState = { account: 'loading', order: { kind: 'idle' }, quote: 'none' }

export const selectAccount = (s: AccountStoreState): Account | 'loading' => s.account
export const selectOrder = (s: AccountStoreState): OrderStatus => s.order
export const selectRoundHistory = (s: AccountStoreState): readonly RoundResult[] =>
  s.account === 'loading' ? EMPTY_HISTORY : s.account.history
export const selectQuote = (s: AccountStoreState): QuoteResult | 'none' => s.quote

/**
 * The stored quote if it answers exactly (side, amount, maxSlippage); 'none' otherwise.
 * Pure, for synchronous reads at submit time. The tolerance must match because the quote's
 * worst-price protection is computed for it.
 */
export function pickQuoteFor(
  state: AccountStoreState,
  side: Side,
  amount: number | 'invalid',
  maxSlippage: number,
): QuoteResult | 'none' {
  const quote = state.quote
  if (
    amount === 'invalid' ||
    quote === 'none' ||
    quote.side !== side ||
    quote.amountUsd !== amount ||
    quote.maxSlippage !== maxSlippage
  ) {
    return 'none'
  }
  return quote
}

/** Primitive selector: true when a fillable quote exists for (side, amount, maxSlippage). */
export function hasOkQuoteFor(
  state: AccountStoreState,
  side: Side,
  amount: number | 'invalid',
  maxSlippage: number,
): boolean {
  const quote = pickQuoteFor(state, side, amount, maxSlippage)
  return quote !== 'none' && quote.status === 'ok'
}

function samePosition(a: Position, b: Position): boolean {
  return (
    a.yesShares === b.yesShares &&
    a.noShares === b.noShares &&
    a.spent === b.spent &&
    a.payoutIfYes === b.payoutIfYes &&
    a.payoutIfNo === b.payoutIfNo
  )
}

// History rows are immutable per roundId, so comparing id + pnl is enough.
function sameHistory(a: readonly RoundResult[], b: readonly RoundResult[]): boolean {
  return a.length === b.length && a.every((row, i) => row.roundId === b[i].roundId && row.pnl === b[i].pnl)
}

/** Reuses the previous history array / position object when unchanged, so selectors stay referentially stable. */
function shareStructure(previous: Account | 'loading', next: Account): Account {
  if (previous === 'loading') return next
  const history = sameHistory(previous.history, next.history) ? previous.history : next.history
  const position = samePosition(previous.position, next.position) ? previous.position : next.position
  return history === next.history && position === next.position ? next : { ...next, history, position }
}

/**
 * Discrete, low-frequency events only — published immediately.
 * Owns the order/quote request flow: one order in flight at a time, and quote answers are
 * applied newest-first (an answer older than the one shown is dropped).
 */
export class AccountStore {
  private readonly writable = createExternalStore(INITIAL)
  readonly store: ExternalStore<AccountStoreState> = this.writable
  private client: AccountClient | 'detached' = 'detached'
  private detachClient: () => void = () => {}
  private nextRequestId = 1
  /** 0 = no quote requested yet. */
  private latestRequestId = 0
  /** Newest requestId whose answer is shown; 0 = none yet. */
  private lastAppliedRequestId = 0

  /** Re-attaching replaces the previous client, so messages are never handled twice. */
  attach(client: AccountClient): () => void {
    this.detachClient()
    const offMessage = client.onMessage((message) => this.handle(message))
    const offStatus = client.onStatus((status) => {
      if (status === 'idle') this.reset()
    })
    this.client = client
    const detach = (): void => {
      offMessage()
      offStatus()
      this.client = 'detached'
      this.detachClient = () => {}
    }
    this.detachClient = detach
    return detach
  }

  reset(): void {
    this.latestRequestId = 0
    this.lastAppliedRequestId = 0
    this.writable.setState(INITIAL)
  }

  /** Marks the order pending and sends it. Refuses a second order while one is in flight. */
  placeOrder(request: OrderRequest): 'sent' | 'busy' {
    const client = this.attached()
    const state = this.writable.getState()
    if (state.order.kind === 'pending') return 'busy'
    this.writable.setState({ ...state, order: { kind: 'pending', clientOrderId: request.clientOrderId } })
    client.send({ type: 'place_order', ...request })
    return 'sent'
  }

  /** Clears a finished order's message; a pending order is left alone. */
  dismissOrder(): void {
    const state = this.writable.getState()
    if (state.order.kind === 'done') this.writable.setState({ ...state, order: { kind: 'idle' } })
  }

  requestQuote(side: Side, amountUsd: number, maxSlippage: number): void {
    const client = this.attached()
    const requestId = this.nextRequestId++
    this.latestRequestId = requestId
    client.send({ type: 'quote', requestId, side, amountUsd, maxSlippage })
  }

  handle(message: ServerMessage): void {
    const state = this.writable.getState()
    switch (message.type) {
      case 'snapshot':
      case 'account':
        this.writable.setState({ ...state, account: shareStructure(state.account, message.account) })
        return
      case 'order_result': {
        const order = state.order
        if (order.kind !== 'pending' || order.clientOrderId !== message.result.clientOrderId) return
        this.writable.setState({ ...state, order: { kind: 'done', result: message.result } })
        return
      }
      case 'quote_result': {
        // Any answer newer than the one shown is applied, so a refresh interval shorter than the
        // round trip cannot starve the ticket. Ids above the latest request are not ours
        // (e.g. bench probe ids), and older answers arriving late are ignored.
        const id = message.quote.requestId
        if (id <= this.lastAppliedRequestId || id > this.latestRequestId) return
        this.lastAppliedRequestId = id
        this.writable.setState({ ...state, quote: message.quote })
        return
      }
      case 'round_started':
        // A quote priced in the previous round is meaningless now, and so is a finished order's message.
        // A pending order is never touched: its result is still on the way.
        if (state.quote !== 'none' || state.order.kind === 'done') {
          this.writable.setState({
            ...state,
            quote: 'none',
            order: state.order.kind === 'done' ? { kind: 'idle' } : state.order,
          })
        }
        return
      default:
        return
    }
  }

  private attached(): AccountClient {
    if (this.client === 'detached') throw new Error('AccountStore is not attached to a client')
    return this.client
  }
}
