import { useEffect } from 'react'
import { QUOTE_DEBOUNCE_MS, QUOTE_REFRESH_MS } from '@/config/market'
import { useMarketRuntime } from '@/hooks/use-market-runtime'
import type { Side } from '@/lib/realtime/protocol'

/**
 * Requests a server-side quote for (side, amount): debounced, then refreshed while inputs are stable.
 * Subscribes to nothing: results are read by leaf components, so the caller never re-renders on a quote.
 */
export function useQuoteRequests(side: Side, amount: number | 'invalid'): void {
  const runtime = useMarketRuntime()

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
}
