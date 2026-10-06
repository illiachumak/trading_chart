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

export function formatCents(price: number): string {
  return `${(price * 100).toFixed(1)}¢`
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

export function formatClock(ts: number): string {
  return CLOCK.format(ts)
}

export function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
