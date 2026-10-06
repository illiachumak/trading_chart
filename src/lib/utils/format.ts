// Display formatting only. Market values come from the server; NO = 1 − YES is the
// display complement of the server's YES price.

import type { Side } from '@/lib/realtime/protocol'

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const CLOCK = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

export function formatPercent(price: number): string {
  return `${Math.round(price * 100)}%`
}

/** Absorbs float noise (e.g. 0.29 * 100 = 28.999…) before a directional round. */
const ROUNDING_EPSILON = 1e-9

/** Price in cents with one decimal, without the unit (for spoken labels), e.g. 0.634 -> "63.4". */
export function formatCentsValue(price: number): string {
  return (price * 100).toFixed(1)
}

export function formatCents(price: number): string {
  return `${formatCentsValue(price)}¢`
}

/** Like formatCents but rounded up, for an upper bound that must not be understated ("worst avg"). */
export function formatCentsCeil(price: number): string {
  return `${(Math.ceil(price * 1_000 - ROUNDING_EPSILON) / 10).toFixed(1)}¢`
}

/** Whole-cent label for an absolute price tolerance, e.g. 0.03 -> "3¢". */
export function formatSlippage(tolerance: number): string {
  return `${Math.round(tolerance * 100)}¢`
}

export function formatSideCents(yesPrice: number, side: Side): string {
  return formatCents(side === 'yes' ? yesPrice : 1 - yesPrice)
}

export function formatUsd(value: number): string {
  return USD.format(value)
}

export function formatSignedUsd(value: number): string {
  const magnitude = USD.format(Math.abs(value))
  if (value > 0) return `+${magnitude}`
  if (value < 0) return `−${magnitude}`
  return magnitude
}

export function formatShares(value: number): string {
  return value.toFixed(2)
}

/** Like formatShares but rounded down, for a lower bound that must not be overstated ("at least"). */
export function formatSharesFloor(value: number): string {
  return (Math.floor(value * 100 + ROUNDING_EPSILON) / 100).toFixed(2)
}

export function formatClock(ts: number): string {
  return CLOCK.format(ts)
}

export function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Shown in place of a value that has not arrived yet. */
export const PLACEHOLDER = '—'
