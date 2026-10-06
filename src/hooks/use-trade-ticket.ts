import { useState } from 'react'
import { DEFAULT_MAX_SLIPPAGE } from '@/config/market'
import { useMarket } from '@/hooks/use-market'
import { usePlaceOrder } from '@/hooks/use-place-order'
import { useQuote } from '@/hooks/use-quote'
import type { OrderStatus } from '@/lib/realtime/account-store'
import { selectRound, selectStatus } from '@/lib/realtime/market-store'
import type { QuoteResult, Side } from '@/lib/realtime/protocol'
import { parseAmount } from '@/lib/utils/parse-amount'

export type TradeTicket = {
  side: Side
  setSide: (side: Side) => void
  amountInput: string
  setAmountInput: (value: string) => void
  amountValid: boolean
  slippage: number
  setSlippage: (value: number) => void
  quote: QuoteResult | 'none'
  order: OrderStatus
  canSubmit: boolean
  submit: () => void
}

export function useTradeTicket(): TradeTicket {
  const [side, setSideState] = useState<Side>('yes')
  const [amountInput, setAmountState] = useState('10')
  const [slippage, setSlippageState] = useState<number>(DEFAULT_MAX_SLIPPAGE)
  const amount = parseAmount(amountInput)
  const quote = useQuote(side, amount)
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

  // Single source of truth for "can this ticket be sent right now", narrowed for submit().
  const ready =
    status === 'live' && round !== 'loading' && quote !== 'none' && quote.status === 'ok' && order.kind !== 'pending'
      ? { roundId: round.id, quote }
      : 'not-ready'

  const submit = (): void => {
    if (ready === 'not-ready') return
    // The quote's average price is what the user saw; the server enforces slippage against it.
    place({
      roundId: ready.roundId,
      side,
      amountUsd: ready.quote.amountUsd,
      expectedPrice: ready.quote.avgPrice,
      maxSlippage: slippage,
    })
  }

  return {
    side,
    setSide,
    amountInput,
    setAmountInput,
    amountValid: amount !== 'invalid',
    slippage,
    setSlippage,
    quote,
    order,
    canSubmit: ready !== 'not-ready',
    submit,
  }
}
