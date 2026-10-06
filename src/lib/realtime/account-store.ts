import type { MarketClient } from '@/lib/realtime/market-client'
import type { Account, OrderResult, QuoteResult, ServerMessage } from '@/lib/realtime/protocol'
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

const INITIAL: AccountStoreState = { account: 'loading', order: { kind: 'idle' }, quote: 'none' }

export const selectAccount = (s: AccountStoreState): Account | 'loading' => s.account
export const selectOrder = (s: AccountStoreState): OrderStatus => s.order
export const selectQuote = (s: AccountStoreState): QuoteResult | 'none' => s.quote

/** Discrete, low-frequency events only — published immediately. */
export class AccountStore {
  readonly store: ExternalStore<AccountStoreState> = createExternalStore(INITIAL)

  attach(client: Pick<MarketClient, 'onMessage'>): () => void {
    return client.onMessage((message) => this.handle(message))
  }

  reset(): void {
    this.store.setState(INITIAL)
  }

  markPending(clientOrderId: string): void {
    this.store.setState({ ...this.store.getState(), order: { kind: 'pending', clientOrderId } })
  }

  handle(message: ServerMessage): void {
    const state = this.store.getState()
    switch (message.type) {
      case 'snapshot':
      case 'account':
        this.store.setState({ ...state, account: message.account })
        return
      case 'order_result': {
        const order = state.order
        if (order.kind !== 'pending' || order.clientOrderId !== message.result.clientOrderId) return
        this.store.setState({ ...state, order: { kind: 'done', result: message.result } })
        return
      }
      case 'quote_result':
        this.store.setState({ ...state, quote: message.quote })
        return
      default:
        return
    }
  }
}
