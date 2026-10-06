import { describe, expect, it } from 'vitest'
import { BATCH_INTERVAL_MS, BATCH_INTERVAL_OPTIONS, MAX_BATCH_INTERVAL_MS, MIN_BATCH_INTERVAL_MS } from '@/config/market'

describe('batch interval constants', () => {
  it('offers only intervals the server accepts, including the default', () => {
    for (const ms of BATCH_INTERVAL_OPTIONS) {
      expect(ms).toBeGreaterThanOrEqual(MIN_BATCH_INTERVAL_MS)
      expect(ms).toBeLessThanOrEqual(MAX_BATCH_INTERVAL_MS)
    }
    expect(BATCH_INTERVAL_OPTIONS).toContain(BATCH_INTERVAL_MS)
  })
})
