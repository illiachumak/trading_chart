// Small-sample statistics for benchmark repeats: mean ± 95% t-interval, the Welch interval and p-value for a
// difference of means, and Holm–Bonferroni correction across many such tests. Pure and import-free so `node scripts/bench-compare.ts` can load it directly;
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

/**
 * B − A with its 95% Welch interval; `significant` when the interval excludes zero (uncorrected, i.e. p < 0.05 for
 * this one test). `p` is the two-sided Welch t-test p-value, for multiple-testing correction across many metrics.
 */
export type WelchDiff = { diff: number; low: number; high: number; df: number; significant: boolean; p: number }

/** Welch's interval for mean(b) − mean(a) with Welch–Satterthwaite df; 'n/a' unless both sides have ≥ 2 values. */
export function welchDiffCI(a: readonly number[], b: readonly number[]): WelchDiff | 'n/a' {
  if (a.length < 2 || b.length < 2) return 'n/a'
  const diff = mean(b) - mean(a)
  const va = sampleVariance(a) / a.length
  const vb = sampleVariance(b) / b.length
  const se2 = va + vb
  if (se2 === 0) {
    // No spread on either side: the difference is exact.
    return { diff, low: diff, high: diff, df: a.length + b.length - 2, significant: diff !== 0, p: diff === 0 ? 1 : 0 }
  }
  const df = se2 ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1))
  const half = tQuantile975(df) * Math.sqrt(se2)
  const low = diff - half
  const high = diff + half
  return { diff, low, high, df, significant: low > 0 || high < 0, p: tTwoSidedP(diff / Math.sqrt(se2), df) }
}

/** ln Γ(x) for x > 0 (Lanczos, g = 7, n = 9; relative error ~1e-15). */
function logGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  const z = x - 1
  let sum = c[0]
  for (let i = 1; i < c.length; i++) sum += c[i] / (z + i)
  const t = z + 7.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum)
}

/** Continued fraction for the regularized incomplete beta function (modified Lentz). */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const tiny = 1e-300
  let c = 1
  let d = 1 - ((a + b) * x) / (a + 1)
  d = Math.abs(d) < tiny ? tiny : d
  d = 1 / d
  let h = d
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2))
    d = 1 + aa * d
    d = Math.abs(d) < tiny ? tiny : d
    c = 1 + aa / c
    c = Math.abs(c) < tiny ? tiny : c
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))
    d = 1 + aa * d
    d = Math.abs(d) < tiny ? tiny : d
    c = 1 + aa / c
    c = Math.abs(c) < tiny ? tiny : c
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < 1e-15) break
  }
  return h
}

/** Regularized incomplete beta I_x(a, b) for 0 ≤ x ≤ 1. */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(x, a, b)) / a
    : 1 - (front * betaContinuedFraction(1 - x, b, a)) / b
}

/** Two-sided p-value P(|T| ≥ |t|) of Student's t with `df` (possibly fractional) degrees of freedom. */
export function tTwoSidedP(t: number, df: number): number {
  if (t === 0) return 1
  return incompleteBeta(df / (df + t * t), df / 2, 0.5)
}

/**
 * Holm–Bonferroni step-down correction: controls the family-wise error rate at `alpha` across all tests.
 * Sort p ascending, reject while p_(k) ≤ alpha / (m − k) (k = 0-based rank), stop at the first failure.
 * Returns, in input order, whether each hypothesis is rejected (i.e. the change is significant after correction).
 */
export function holmBonferroni(pValues: readonly number[], alpha = 0.05): boolean[] {
  const m = pValues.length
  const order = pValues.map((p, index) => ({ p, index })).sort((x, y) => x.p - y.p)
  const rejected = pValues.map(() => false)
  for (let k = 0; k < m; k++) {
    if (order[k].p > alpha / (m - k)) break
    rejected[order[k].index] = true
  }
  return rejected
}
