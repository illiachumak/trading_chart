// Compares two bench-cdp.js result files (A = baseline, B = candidate) phase by phase.
//
// Usage: node scripts/bench-compare.ts A.json B.json
// (Node ≥ 23 runs .ts directly by stripping types; no dependencies.)
//
// Input: the JSON string bench-cdp.js returns, saved to a file: { meta, runs: [{ phases: { <phase>: { <metric>: number | 'n/a' } } }] }.
// For every phase present in both files and every key metric it prints mean ± 95% CI of A and B, the
// difference B − A with its 95% Welch interval and the Welch p-value. With ~250 (phase, metric) tests per
// comparison, uncorrected 95% intervals would flag a dozen pure-noise changes, so a change is flagged only when
// (1) it stays significant after Holm–Bonferroni correction across all tests of the comparison (family-wise
// alpha 0.05) AND (2) |B − A| reaches the metric's minimum meaningful change (MIN_EFFECT).
// 'n/a' values (e.g. INP with no interactions) are skipped, and a metric needs ≥ 2 values on each side.
// Differing run conditions (meta.benchUrl / displayHz / cpuThrottle) are warned about on stderr and in the header.

import { readFileSync } from 'node:fs'
import { holmBonferroni, meanCI, welchDiffCI, type WelchDiff } from '../src/lib/perf/stats.ts'

/** Metrics compared, in print order. Lower is better for all but fillRate. */
const KEY_METRICS = [
  'frameP95',
  'pctFramesOverBudget',
  'loafPerMin',
  'inpP75',
  'dataAgeP95',
  'mainThreadBusyPct',
  'scriptMsPerSec',
  'commitsPerSec',
  'fillRate',
  'recoveryP50',
  'recoveryMax',
  'heapGrowthMb',
] as const
type KeyMetric = (typeof KEY_METRICS)[number]
const HIGHER_IS_BETTER: ReadonlySet<string> = new Set(['fillRate'])

/** Family-wise error rate across all (phase, metric) tests of one comparison. */
const FAMILY_ALPHA = 0.05

/**
 * Smallest |B − A| worth reporting, in the metric's own unit: a statistically real change below this is too
 * small to matter (or to survive a different machine/day), so it is never flagged.
 */
const MIN_EFFECT: Readonly<Record<KeyMetric, number>> = {
  frameP95: 0.5, // ms
  pctFramesOverBudget: 0.5, // percentage points
  loafPerMin: 1,
  inpP75: 8, // ms — Event Timing durations are 8 ms-granular
  dataAgeP95: 10, // ms
  mainThreadBusyPct: 1, // percentage points
  scriptMsPerSec: 5,
  commitsPerSec: 1,
  fillRate: 0.03,
  recoveryP50: 50, // ms
  recoveryMax: 50, // ms
  heapGrowthMb: 2,
}

/** Run conditions that must match for A and B to be comparable. */
const CONDITION_KEYS = ['benchUrl', 'displayHz', 'cpuThrottle'] as const

type PhaseValues = Map<string, Map<string, number[]>>
type BenchFile = { meta: Record<string, unknown>; values: PhaseValues; runs: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readBenchFile(path: string): BenchFile {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isRecord(parsed) || !Array.isArray(parsed.runs)) throw new Error(`${path}: expected { meta, runs: [...] } from bench-cdp.js`)
  const values: PhaseValues = new Map()
  for (const run of parsed.runs) {
    if (!isRecord(run) || !isRecord(run.phases)) continue
    for (const [phase, metrics] of Object.entries(run.phases)) {
      if (!isRecord(metrics)) continue
      const byMetric = values.get(phase) ?? new Map<string, number[]>()
      values.set(phase, byMetric)
      for (const metric of KEY_METRICS) {
        const value = metrics[metric]
        if (typeof value !== 'number' || !Number.isFinite(value)) continue
        byMetric.set(metric, [...(byMetric.get(metric) ?? []), value])
      }
    }
  }
  return { meta: isRecord(parsed.meta) ? parsed.meta : {}, values, runs: parsed.runs.length }
}

function fmt(value: number): string {
  const abs = Math.abs(value)
  return abs >= 100 ? value.toFixed(0) : abs >= 10 ? value.toFixed(1) : value.toFixed(2)
}

function fmtMean(values: readonly number[]): string {
  if (values.length === 0) return 'n/a'
  const ci = meanCI(values)
  return ci.ci95 === 'n/a' ? `${fmt(ci.mean)} (n=1)` : `${fmt(ci.mean)} ± ${fmt(ci.ci95)}`
}

type Row = { phase: string; metric: KeyMetric; va: number[]; vb: number[]; d: WelchDiff | 'n/a' }

function conditionMismatches(metaA: Record<string, unknown>, metaB: Record<string, unknown>): string[] {
  return CONDITION_KEYS.filter((key) => JSON.stringify(metaA[key]) !== JSON.stringify(metaB[key])).map(
    (key) => `${key}: A ${JSON.stringify(metaA[key]) ?? 'missing'} vs B ${JSON.stringify(metaB[key]) ?? 'missing'}`,
  )
}

function main(argv: readonly string[]): number {
  if (argv.length !== 2) {
    console.error('usage: node scripts/bench-compare.ts A.json B.json')
    return 2
  }
  const [pathA, pathB] = argv
  const a = readBenchFile(pathA)
  const b = readBenchFile(pathB)
  console.log(`A: ${pathA} (${a.runs} runs) ${JSON.stringify(a.meta)}`)
  console.log(`B: ${pathB} (${b.runs} runs) ${JSON.stringify(b.meta)}`)
  const mismatches = conditionMismatches(a.meta, b.meta)
  for (const mismatch of mismatches) {
    console.error(`warning: run conditions differ — ${mismatch}`)
    console.log(`WARNING: run conditions differ — ${mismatch}; differences may not be caused by the code change.`)
  }

  // Collect every testable (phase, metric) first: the correction needs the whole family.
  const rows: Row[] = []
  for (const [phase, metricsA] of a.values) {
    const metricsB = b.values.get(phase)
    if (metricsB === undefined) continue
    for (const metric of KEY_METRICS) {
      const va = metricsA.get(metric) ?? []
      const vb = metricsB.get(metric) ?? []
      if (va.length === 0 && vb.length === 0) continue
      rows.push({ phase, metric, va, vb, d: welchDiffCI(va, vb) })
    }
  }
  const tested = rows.filter((row) => row.d !== 'n/a')
  const rejected = holmBonferroni(
    tested.map((row) => (row.d === 'n/a' ? 1 : row.d.p)),
    FAMILY_ALPHA,
  )
  const significant = new Set(tested.filter((_, i) => rejected[i]))

  console.log(
    `${tested.length} tests, Holm–Bonferroni family-wise alpha ${FAMILY_ALPHA}. Difference = B − A with a 95% Welch CI ` +
      '(uncorrected) and p; flagged only when significant after correction AND |diff| ≥ the metric minimum (min).\n',
  )

  let flagged = 0
  let printedPhase = ''
  for (const phase of a.values.keys()) {
    if (!b.values.has(phase)) console.log(`${phase}: only in A`)
  }
  for (const row of rows) {
    if (row.phase !== printedPhase) {
      console.log(row.phase)
      printedPhase = row.phase
    }
    const { d, metric } = row
    const diff =
      d === 'n/a'
        ? 'diff n/a (needs ≥ 2 values each side)'
        : `diff ${fmt(d.diff)} [${fmt(d.low)}, ${fmt(d.high)}] p=${d.p < 0.001 ? d.p.toExponential(1) : d.p.toFixed(3)}`
    let flag = ''
    if (d !== 'n/a' && significant.has(row)) {
      if (Math.abs(d.diff) >= MIN_EFFECT[metric]) {
        flagged++
        const better = HIGHER_IS_BETTER.has(metric) ? d.diff > 0 : d.diff < 0
        flag = better ? '  ** CHANGED (better)' : '  ** CHANGED (worse)'
      } else {
        flag = `  (significant, below min ${MIN_EFFECT[metric]})`
      }
    }
    console.log(`  ${metric.padEnd(20)} A ${fmtMean(row.va).padEnd(18)} B ${fmtMean(row.vb).padEnd(18)} ${diff}${flag}`)
  }
  for (const phase of b.values.keys()) {
    if (!a.values.has(phase)) console.log(`${phase}: only in B`)
  }
  const warning = mismatches.length > 0 ? ' (run conditions differ — see warning above)' : ''
  console.log(`\n${flagged} metric change(s) flagged out of ${tested.length} tests${warning}.`)
  return 0
}

process.exitCode = main(process.argv.slice(2))
