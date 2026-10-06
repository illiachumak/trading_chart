import { describe, expect, it } from 'vitest'
import {
  BATCH_INTERVAL_MS,
  BATCH_INTERVAL_OPTIONS,
  DEFAULT_MAX_SLIPPAGE,
  MAX_BATCH_INTERVAL_MS,
  MAX_SLIPPAGE,
  MIN_BATCH_INTERVAL_MS,
  SLIPPAGE_OPTIONS,
} from '@/config/market'

describe('batch interval constants', () => {
  it('offers only intervals the server accepts, including the default', () => {
    for (const ms of BATCH_INTERVAL_OPTIONS) {
      expect(ms).toBeGreaterThanOrEqual(MIN_BATCH_INTERVAL_MS)
      expect(ms).toBeLessThanOrEqual(MAX_BATCH_INTERVAL_MS)
    }
    expect(BATCH_INTERVAL_OPTIONS).toContain(BATCH_INTERVAL_MS)
  })
})

describe('slippage constants', () => {
  it('offers only tolerances the server accepts, including the default', () => {
    for (const option of SLIPPAGE_OPTIONS) {
      expect(option).toBeGreaterThanOrEqual(0)
      expect(option).toBeLessThanOrEqual(MAX_SLIPPAGE)
    }
    expect(SLIPPAGE_OPTIONS).toContain(DEFAULT_MAX_SLIPPAGE)
  })
})
