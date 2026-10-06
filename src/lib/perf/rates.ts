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

const MS_PER_MIN = 60_000

export type CountSample = { at: number; total: number }

/**
 * Appends a cumulative-count sample to `samples` (mutates it: also trims it in place), drops samples older than `windowMs` (keeping one at the
 * window edge) and returns the rate per minute across what is left; 0 until time has passed.
 */
export function trailingPerMinute(samples: CountSample[], sample: CountSample, windowMs: number): number {
  samples.push(sample)
  while (samples.length > 2 && sample.at - samples[1].at >= windowMs) samples.shift()
  const first = samples[0]
  const elapsed = sample.at - first.at
  return elapsed > 0 ? ((sample.total - first.total) / elapsed) * MS_PER_MIN : 0
}
