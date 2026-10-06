import { useEffect } from 'react'
import { QUOTE_DEBOUNCE_MS, QUOTE_REFRESH_MS } from '@/config/market'
import { useAccount } from '@/hooks/use-market'
import { useMarketRuntime } from '@/hooks/use-market-runtime'
import { selectQuote } from '@/lib/realtime/account-store'
import type { QuoteResult, Side } from '@/lib/realtime/protocol'

/** Server-side quote for (side, amount): debounced, then refreshed while inputs are stable. */
export function useQuote(side: Side, amount: number | 'invalid'): QuoteResult | 'none' {
  const runtime = useMarketRuntime()
  const quote = useAccount(selectQuote)

  useEffect(() => {
    if (amount === 'invalid') return
    // AccountStore assigns requestIds and shows only the answer to the latest request.
    const request = (): void => runtime.account.requestQuote(side, amount)
    let refresh: ReturnType<typeof setInterval> | 'none' = 'none'
    const debounce = setTimeout(() => {
      request()
      refresh = setInterval(request, QUOTE_REFRESH_MS)
    }, QUOTE_DEBOUNCE_MS)
    return () => {
      clearTimeout(debounce)
      if (refresh !== 'none') clearInterval(refresh)
    }
  }, [runtime, side, amount])

  if (amount === 'invalid' || quote === 'none' || quote.side !== side || quote.amountUsd !== amount) return 'none'
  return quote
}
