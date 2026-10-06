import { useEffect, useRef } from 'react'
import { QUOTE_DEBOUNCE_MS, QUOTE_REFRESH_MS } from '@/config/market'
import { useMarketRuntime } from '@/hooks/use-market-runtime'
import type { Side } from '@/lib/realtime/protocol'
import { shouldRefreshQuote } from '@/lib/utils/quote-refresh'

/**
 * Requests a server-side quote for (side, amount, maxSlippage): debounced, then refreshed while inputs are stable.
 * Refreshes pause while the tab is hidden or an order is pending; the next tick (or tab focus) resumes them.
 * Subscribes to nothing: results are read by leaf components, so the caller never re-renders on a quote.
 */
export function useQuoteRequests(
  side: Side,
  amount: number | 'invalid',
  maxSlippage: number,
  orderPending: boolean,
): void {
  const runtime = useMarketRuntime()
  // A ref, so a pending flag flip doesn't restart the debounce/interval.
  const orderPendingRef = useRef(orderPending)
  useEffect(() => {
    orderPendingRef.current = orderPending
  }, [orderPending])

  useEffect(() => {
    if (amount === 'invalid') return
    // AccountStore assigns increasing requestIds and applies an answer only when lastApplied < id ≤ latest:
    // stale answers (older than the one shown) are dropped, but an older-than-latest answer still shows while
    // the newest is in flight, so quotes never starve when RTT exceeds the refresh interval.
    const request = (): void => {
      if (shouldRefreshQuote({ hidden: document.hidden, orderPending: orderPendingRef.current })) {
        runtime.account.requestQuote(side, amount, maxSlippage)
      }
    }
    const onVisibility = (): void => request()
    document.addEventListener('visibilitychange', onVisibility)
    let refresh: ReturnType<typeof setInterval> | 'none' = 'none'
    const debounce = setTimeout(() => {
      request()
      refresh = setInterval(request, QUOTE_REFRESH_MS)
    }, QUOTE_DEBOUNCE_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimeout(debounce)
      if (refresh !== 'none') clearInterval(refresh)
    }
  }, [runtime, side, amount, maxSlippage])
}
