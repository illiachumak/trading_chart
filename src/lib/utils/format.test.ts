import { describe, expect, it } from 'vitest'
import {
  formatCents,
  formatCentsCeil,
  formatCentsValue,
  formatCountdown,
  formatPercent,
  formatShares,
  formatSharesFloor,
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

  it('formats the bare cents number shared by visible and spoken labels', () => {
    expect(formatCentsValue(0.5128)).toBe('51.3')
    expect(formatCents(0.5128)).toBe(`${formatCentsValue(0.5128)}¢`)
  })

  it('rounds guarantees conservatively: worst price up, minimum shares down', () => {
    expect(formatCentsCeil(0.54211)).toBe('54.3¢') // nearest would be 54.2¢, which overstates
    expect(formatCentsCeil(0.543)).toBe('54.3¢') // exact values are not bumped by float noise
    expect(formatCentsCeil(0.57)).toBe('57.0¢')
    expect(formatSharesFloor(18.4239)).toBe('18.42')
    expect(formatSharesFloor(12.349)).toBe('12.34') // nearest would be 12.35
    expect(formatSharesFloor(0.29)).toBe('0.29') // 0.29 * 100 = 28.999… must not drop to 0.28
    expect(formatSharesFloor(2000)).toBe('2000.00')
  })

  it('formats the countdown', () => {
    expect(formatCountdown(65)).toBe('1:05')
    expect(formatCountdown(9)).toBe('0:09')
    expect(formatCountdown(0)).toBe('0:00')
  })
})
