import { useCallback } from 'react'
import { useAccount } from '@/hooks/use-market'
import { useMarketRuntime } from '@/hooks/use-market-runtime'
import { type OrderStatus, selectOrder } from '@/lib/realtime/account-store'
import type { Side } from '@/lib/realtime/protocol'

export type PlaceOrderInput = { roundId: number; side: Side; amountUsd: number; expectedPrice: number; maxSlippage: number }

export function usePlaceOrder(): {
  order: OrderStatus
  place: (input: PlaceOrderInput) => 'sent' | 'busy'
  dismiss: () => void
} {
  const runtime = useMarketRuntime()
  const order = useAccount(selectOrder)
  const place = useCallback(
    (input: PlaceOrderInput) =>
      // Marks pending and sends in one step; refuses while another order is in flight.
      runtime.account.placeOrder({ clientOrderId: crypto.randomUUID(), ...input }),
    [runtime],
  )
  const dismiss = useCallback(() => runtime.account.dismissOrder(), [runtime])
  return { order, place, dismiss }
}
