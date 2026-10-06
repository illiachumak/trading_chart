import type { MarketClient } from '@/lib/realtime/market-client'
import type { Account, OrderResult, PlaceOrder, QuoteResult, ServerMessage, Side } from '@/lib/realtime/protocol'
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

const INITIAL: AccountStoreState = { account: 'loading', order: { kind: 'idle' }, quote: 'none' }

export const selectAccount = (s: AccountStoreState): Account | 'loading' => s.account
export const selectOrder = (s: AccountStoreState): OrderStatus => s.order
export const selectQuote = (s: AccountStoreState): QuoteResult | 'none' => s.quote

/**
 * Discrete, low-frequency events only — published immediately.
 * Owns the order/quote request flow: one order in flight at a time, and only the
 * answer to the latest quote request is shown.
 */
export class AccountStore {
  private readonly writable = createExternalStore(INITIAL)
  readonly store: ExternalStore<AccountStoreState> = this.writable
  private client: AccountClient | 'detached' = 'detached'
  private detachClient: () => void = () => {}
  private nextRequestId = 1
  /** 0 = no quote requested yet. */
  private latestRequestId = 0

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

  requestQuote(side: Side, amountUsd: number): void {
    const client = this.attached()
    const requestId = this.nextRequestId++
    this.latestRequestId = requestId
    client.send({ type: 'quote', requestId, side, amountUsd })
  }

  handle(message: ServerMessage): void {
    const state = this.writable.getState()
    switch (message.type) {
      case 'snapshot':
      case 'account':
        this.writable.setState({ ...state, account: message.account })
        return
      case 'order_result': {
        const order = state.order
        if (order.kind !== 'pending' || order.clientOrderId !== message.result.clientOrderId) return
        this.writable.setState({ ...state, order: { kind: 'done', result: message.result } })
        return
      }
      case 'quote_result':
        // Superseded requests and quotes for other connections are ignored.
        if (message.quote.requestId !== this.latestRequestId) return
        this.writable.setState({ ...state, quote: message.quote })
        return
      case 'round_started':
        // A quote priced in the previous round is meaningless now.
        if (state.quote !== 'none') this.writable.setState({ ...state, quote: 'none' })
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
