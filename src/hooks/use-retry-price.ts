import { useAccount } from '@/hooks/use-market'
import { pickQuoteFor } from '@/lib/realtime/account-store'
import type { Side } from '@/lib/realtime/protocol'
import { retryPriceFor } from '@/lib/utils/describe-order-result'

/**
 * Price a "retry" after a slippage rejection would use: the latest quote for the ticket's
 * (side, amount, slippage), or 'none' when no retry is offered. Primitive selector over the
 * throttled quote store, so the caller re-renders only when the offered price changes.
 */
export function useRetryPrice(side: Side, amount: number | 'invalid', slippage: number): number | 'none' {
  return useAccount((state) => retryPriceFor(state.order, pickQuoteFor(state, side, amount, slippage)))
}
