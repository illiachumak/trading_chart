export function ratesPerSecond(
  current: Readonly<Record<string, number>>,
  previous: Readonly<Record<string, number>>,
  elapsedMs: number,
): Record<string, number> {
  const rates: Record<string, number> = {}
  if (elapsedMs <= 0) return rates
  const seconds = elapsedMs / 1_000
  for (const [key, value] of Object.entries(current)) {
    const before = Object.hasOwn(previous, key) ? previous[key] : 0
    rates[key] = (value - before) / seconds
  }
  return rates
}
