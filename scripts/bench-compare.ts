// Compares two bench-cdp.js result files (A = baseline, B = candidate) phase by phase.
//
// Usage: node scripts/bench-compare.ts A.json B.json
// (Node ≥ 23 runs .ts directly by stripping types; no dependencies.)
//
// Input: the JSON string bench-cdp.js returns, saved to a file: { meta, runs: [{ phases: { <phase>: { <metric>: number | 'n/a' } } }] }.
// For every phase present in both files and every key metric it prints mean ± 95% CI of A and B and the
// difference B − A with its 95% Welch interval. A change is flagged only when that interval excludes zero;
// 'n/a' values (e.g. INP with no interactions) are skipped, and a metric needs ≥ 2 values on each side.

import { readFileSync } from 'node:fs'
import { meanCI, welchDiffCI } from '../src/lib/perf/stats.ts'

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
const HIGHER_IS_BETTER: ReadonlySet<string> = new Set(['fillRate'])

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
  console.log('Difference = B − A with a 95% Welch CI; flagged only when the CI excludes zero.\n')

  let flagged = 0
  for (const [phase, metricsA] of a.values) {
    const metricsB = b.values.get(phase)
    if (metricsB === undefined) {
      console.log(`${phase}: only in A`)
      continue
    }
    console.log(phase)
    for (const metric of KEY_METRICS) {
      const va = metricsA.get(metric) ?? []
      const vb = metricsB.get(metric) ?? []
      if (va.length === 0 && vb.length === 0) continue
      const d = welchDiffCI(va, vb)
      const diff = d === 'n/a' ? 'diff n/a (needs ≥ 2 values each side)' : `diff ${fmt(d.diff)} [${fmt(d.low)}, ${fmt(d.high)}]`
      let flag = ''
      if (d !== 'n/a' && d.significant) {
        flagged++
        const better = HIGHER_IS_BETTER.has(metric) ? d.diff > 0 : d.diff < 0
        flag = better ? '  ** CHANGED (better)' : '  ** CHANGED (worse)'
      }
      console.log(`  ${metric.padEnd(20)} A ${fmtMean(va).padEnd(18)} B ${fmtMean(vb).padEnd(18)} ${diff}${flag}`)
    }
  }
  for (const phase of b.values.keys()) {
    if (!a.values.has(phase)) console.log(`${phase}: only in B`)
  }
  console.log(`\n${flagged} metric change(s) flagged.`)
  return 0
}

process.exitCode = main(process.argv.slice(2))
