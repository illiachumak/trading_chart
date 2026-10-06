import { describe, expect, it } from 'vitest'
import { shouldRefreshQuote } from '@/lib/utils/quote-refresh'

describe('shouldRefreshQuote', () => {
  it('refreshes only when the tab is visible and no order is pending', () => {
    expect(shouldRefreshQuote({ hidden: false, orderPending: false })).toBe(true)
    expect(shouldRefreshQuote({ hidden: true, orderPending: false })).toBe(false)
    expect(shouldRefreshQuote({ hidden: false, orderPending: true })).toBe(false)
    expect(shouldRefreshQuote({ hidden: true, orderPending: true })).toBe(false)
  })
})
