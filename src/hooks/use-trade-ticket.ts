import { useState } from 'react'
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
  quote: QuoteResult | 'none'
  order: OrderStatus
  canSubmit: boolean
  submit: () => void
}

export function useTradeTicket(): TradeTicket {
  const [side, setSide] = useState<Side>('yes')
  const [amountInput, setAmountInput] = useState('10')
  const amount = parseAmount(amountInput)
  const quote = useQuote(side, amount)
  const round = useMarket(selectRound)
  const status = useMarket(selectStatus)
  const { order, place } = usePlaceOrder()

  const canSubmit =
    status === 'live' && round !== 'loading' && quote !== 'none' && quote.status === 'ok' && order.kind !== 'pending'

  const submit = (): void => {
    if (status !== 'live' || round === 'loading' || quote === 'none' || quote.status !== 'ok') return
    if (order.kind === 'pending') return
    // The quote's average price is what the user saw; the server enforces slippage against it.
    place({ roundId: round.id, side, amountUsd: quote.amountUsd, expectedPrice: quote.avgPrice })
  }

  return {
    side,
    setSide,
    amountInput,
    setAmountInput,
    amountValid: amount !== 'invalid',
    quote,
    order,
    canSubmit,
    submit,
  }
}
