import { useState } from 'react'
import { DEFAULT_MAX_SLIPPAGE } from '@/config/market'
import { useMarket } from '@/hooks/use-market'
import { usePlaceOrder } from '@/hooks/use-place-order'
import { useMarketRuntime } from '@/hooks/use-market-runtime'
import { useQuoteRequests } from '@/hooks/use-quote'
import { type OrderStatus, pickQuoteFor } from '@/lib/realtime/account-store'
import { selectRound, selectStatus } from '@/lib/realtime/market-store'
import type { Side } from '@/lib/realtime/protocol'
import { parseAmount } from '@/lib/utils/parse-amount'

export type TradeTicket = {
  side: Side
  setSide: (side: Side) => void
  amountInput: string
  setAmountInput: (value: string) => void
  amount: number | 'invalid'
  amountValid: boolean
  slippage: number
  setSlippage: (value: number) => void
  order: OrderStatus
  /** Everything except the quote: market live, round known, no order in flight. */
  marketReady: boolean
  submit: () => void
}

export function useTradeTicket(): TradeTicket {
  const [side, setSideState] = useState<Side>('yes')
  const [amountInput, setAmountState] = useState('10')
  const [slippage, setSlippageState] = useState<number>(DEFAULT_MAX_SLIPPAGE)
  const amount = parseAmount(amountInput)
  const runtime = useMarketRuntime()
  useQuoteRequests(side, amount)
  const round = useMarket(selectRound)
  const status = useMarket(selectStatus)
  const { order, place, dismiss } = usePlaceOrder()

  // Editing the ticket makes the previous order's message stale.
  const setSide = (next: Side): void => {
    setSideState(next)
    dismiss()
  }
  const setAmountInput = (value: string): void => {
    setAmountState(value)
    dismiss()
  }

  const setSlippage = (value: number): void => {
    setSlippageState(value)
    dismiss()
  }

  const marketReady = status === 'live' && round !== 'loading' && order.kind !== 'pending'

  const submit = (): void => {
    if (status !== 'live' || round === 'loading' || order.kind === 'pending') return
    // Read the latest quote now (not from a render closure), so the order uses the freshest price.
    const quote = pickQuoteFor(runtime.account.store.getState(), side, amount)
    if (quote === 'none' || quote.status !== 'ok') return
    // The quote's average price is what the user saw; the server enforces slippage against it.
    place({
      roundId: round.id,
      side,
      amountUsd: quote.amountUsd,
      expectedPrice: quote.avgPrice,
      maxSlippage: slippage,
    })
  }

  return {
    side,
    setSide,
    amountInput,
    setAmountInput,
    amount,
    amountValid: amount !== 'invalid',
    slippage,
    setSlippage,
    order,
    marketReady,
    submit,
  }
}
