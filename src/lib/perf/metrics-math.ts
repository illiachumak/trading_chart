// Pure helpers behind the industry metrics: percentiles, frame budget, display rate, INP grouping
// and disconnect-recovery timelines. No browser APIs here — the observers live in perf-metrics.ts.

import type { ConnectionStatus } from '@/lib/realtime/market-client'

/** Nearest-rank percentile of an ascending array; 0 when empty. */
export function percentileOfSorted(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]
}

/** Nearest-rank percentile of unsorted values; 0 when empty. */
export function percentile(values: readonly number[], p: number): number {
  return percentileOfSorted([...values].sort((a, b) => a - b), p)
}

/** Share of frames longer than the budget, in percent (0–100); 0 when there are no frames. */
export function pctOverBudget(frameMs: readonly number[], budgetMs: number): number {
  if (frameMs.length === 0) return 0
  let over = 0
  for (const ms of frameMs) if (ms > budgetMs) over++
  return (over / frameMs.length) * 100
}

/** Refresh rates real displays run at; an estimate within REFRESH_SNAP_TOLERANCE snaps to one of them. */
const COMMON_REFRESH_HZ = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240, 360] as const
const REFRESH_SNAP_TOLERANCE = 0.03

/**
 * Display refresh rate from the median rAF delta: 1000 / median, snapped to a common rate when
 * within 3%. A median far from any common rate (busy main thread) is reported rounded, as measured.
 */
export function estimateDisplayHz(medianFrameMs: number): number | 'n/a' {
  if (!(medianFrameMs > 0) || !Number.isFinite(medianFrameMs)) return 'n/a'
  const raw = 1_000 / medianFrameMs
  for (const hz of COMMON_REFRESH_HZ) {
    if (Math.abs(raw - hz) / hz <= REFRESH_SNAP_TOLERANCE) return hz
  }
  return Math.round(raw)
}

/** The fields of a PerformanceEventTiming entry INP needs. */
export type EventTimingSample = { interactionId: number; durationMs: number }

/**
 * Groups Event Timing entries into interactions: one interaction = all entries sharing an
 * `interactionId` (pointerdown/up/click of one tap), its latency = the longest of them.
 * Entries with interactionId 0 (hover, scroll, …) are not interactions and are skipped.
 * Accumulates into `into` so entries of one interaction may arrive in several observer callbacks.
 */
export function groupInteractions(
  entries: readonly EventTimingSample[],
  into: Map<number, number> = new Map(),
): Map<number, number> {
  for (const { interactionId, durationMs } of entries) {
    if (interactionId <= 0) continue
    into.set(interactionId, Math.max(into.get(interactionId) ?? 0, durationMs))
  }
  return into
}

export type InteractionSummary = { count: number; p75Ms: number | 'n/a'; maxMs: number | 'n/a' }

/** Per-window INP view: p75 and max interaction latency; 'n/a' when there were no interactions. */
export function summarizeInteractions(latenciesMs: Iterable<number>): InteractionSummary {
  const sorted = [...latenciesMs].sort((a, b) => a - b)
  if (sorted.length === 0) return { count: 0, p75Ms: 'n/a', maxMs: 'n/a' }
  return { count: sorted.length, p75Ms: percentileOfSorted(sorted, 0.75), maxMs: sorted[sorted.length - 1] }
}

export type StatusSample = { at: number; status: ConnectionStatus }

export type RecoveryTimeline = {
  /** Outage durations: leaving `live` → back to `live`, in timeline order. */
  recoveredMs: number[]
  /** Outages still open at the end of the timeline. */
  unrecovered: number
}

/**
 * Recovery times from a client status timeline (first sample = status at the start).
 * An outage starts when the status leaves `live` (or at the first sample if it is not live)
 * and ends at the next `live`.
 */
export function recoveryTimes(timeline: readonly StatusSample[]): RecoveryTimeline {
  const recoveredMs: number[] = []
  let downSince: number | 'up' = 'up'
  for (const { at, status } of timeline) {
    if (status === 'live') {
      if (downSince !== 'up') recoveredMs.push(at - downSince)
      downSince = 'up'
    } else if (downSince === 'up') {
      downSince = at
    }
  }
  return { recoveredMs, unrecovered: downSince === 'up' ? 0 : 1 }
}
