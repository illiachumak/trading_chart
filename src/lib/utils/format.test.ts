import { describe, expect, it } from 'vitest'
import {
  formatCents,
  formatCountdown,
  formatPercent,
  formatShares,
  formatSideCents,
  formatSignedUsd,
  formatUsd,
} from '@/lib/utils/format'

describe('format', () => {
  it('formats prices', () => {
    expect(formatPercent(0.634)).toBe('63%')
    expect(formatCents(0.634)).toBe('63.4¢')
    expect(formatSideCents(0.634, 'yes')).toBe('63.4¢')
    expect(formatSideCents(0.634, 'no')).toBe('36.6¢')
  })

  it('formats money and shares', () => {
    expect(formatUsd(1234.5)).toBe('$1,234.50')
    expect(formatSignedUsd(12.3)).toBe('+$12.30')
    expect(formatSignedUsd(-5)).toBe('−$5.00')
    expect(formatSignedUsd(0)).toBe('$0.00')
    expect(formatShares(12.345)).toBe('12.35')
  })

  it('formats the countdown', () => {
    expect(formatCountdown(65)).toBe('1:05')
    expect(formatCountdown(9)).toBe('0:09')
    expect(formatCountdown(0)).toBe('0:00')
  })
})
