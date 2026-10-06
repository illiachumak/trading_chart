// Small-sample statistics for benchmark repeats: mean ± 95% t-interval, and the Welch interval for a
// difference of means. Pure and import-free so `node scripts/bench-compare.ts` can load it directly;
// scripts/bench-cdp.js inlines a copy of meanCI (it cannot import) — this file is the source of truth.

/** Two-sided 95% t quantiles (t at 0.975) for df = 1..30. */
const T975: readonly number[] = [
  12.706205, 4.302653, 3.182446, 2.776445, 2.570582, 2.446912, 2.364624, 2.306004, 2.262157, 2.228139, 2.200985,
  2.178813, 2.160369, 2.144787, 2.13145, 2.119905, 2.109816, 2.100922, 2.093024, 2.085963, 2.079614, 2.073873,
  2.068658, 2.063899, 2.059539, 2.055529, 2.051831, 2.048407, 2.04523, 2.042272,
]
const Z975 = 1.959964

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('mean of no values')
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/** Sample standard deviation (n − 1 denominator). */
export function sampleSd(values: readonly number[]): number {
  return Math.sqrt(sampleVariance(values))
}

function sampleVariance(values: readonly number[]): number {
  if (values.length < 2) throw new RangeError('sample variance needs at least two values')
  const m = mean(values)
  return values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1)
}

/**
 * t quantile at 0.975 (two-sided 95%) for `df` degrees of freedom. Table for df ≤ 30, interpolated in 1/df
 * for fractional (Welch) df; above 30 the Cornish–Fisher expansion around the normal quantile (error < 1e-3).
 */
export function tQuantile975(df: number): number {
  const d = Math.max(1, df)
  if (d > T975.length) {
    const z = Z975
    return z + (z ** 3 + z) / (4 * d) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * d ** 2)
  }
  const lo = Math.floor(d)
  const hi = Math.ceil(d)
  if (lo === hi) return T975[lo - 1]
  const frac = (1 / lo - 1 / d) / (1 / lo - 1 / hi)
  return T975[lo - 1] + frac * (T975[hi - 1] - T975[lo - 1])
}

/** Mean with the 95% t-interval half-width (mean ± ci95); 'n/a' interval for a single value. */
export type MeanCI = { mean: number; ci95: number | 'n/a'; n: number }

export function meanCI(values: readonly number[]): MeanCI {
  const n = values.length
  const m = mean(values)
  if (n < 2) return { mean: m, ci95: 'n/a', n }
  return { mean: m, ci95: (tQuantile975(n - 1) * sampleSd(values)) / Math.sqrt(n), n }
}

/** B − A with its 95% Welch interval; `significant` when the interval excludes zero. */
export type WelchDiff = { diff: number; low: number; high: number; df: number; significant: boolean }

/** Welch's interval for mean(b) − mean(a) with Welch–Satterthwaite df; 'n/a' unless both sides have ≥ 2 values. */
export function welchDiffCI(a: readonly number[], b: readonly number[]): WelchDiff | 'n/a' {
  if (a.length < 2 || b.length < 2) return 'n/a'
  const diff = mean(b) - mean(a)
  const va = sampleVariance(a) / a.length
  const vb = sampleVariance(b) / b.length
  const se2 = va + vb
  if (se2 === 0) {
    // No spread on either side: the difference is exact.
    return { diff, low: diff, high: diff, df: a.length + b.length - 2, significant: diff !== 0 }
  }
  const df = se2 ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1))
  const half = tQuantile975(df) * Math.sqrt(se2)
  const low = diff - half
  const high = diff + half
  return { diff, low, high, df, significant: low > 0 || high < 0 }
}
