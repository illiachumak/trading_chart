// Samples metrics at HUD_REFRESH_MS and writes text straight into DOM nodes,
// so the HUD itself causes zero React commits.

import { useEffect } from 'react'
import { FRAME_MISS_THRESHOLD_MS, HUD_REFRESH_MS } from '@/config/market'
import { useMarketRuntime } from '@/hooks/use-market-runtime'
import { browserSamplingEnv, perfMetrics } from '@/lib/perf/perf-metrics'
import { type CountSample, ratesPerSecond, trailingPerMinute } from '@/lib/perf/rates'

export type HudField =
  | 'frame'
  | 'display'
  | 'loaf'
  | 'flush'
  | 'dataAge'
  | 'ticks'
  | 'msgs'
  | 'trades'
  | 'items'
  | 'kb'
  | 'commits'
  | 'longTasks'
  | 'net'

/** LoAF/min is averaged over this trailing window. */
const LOAF_RATE_WINDOW_MS = 60_000

export function usePerfHud(write: (field: HudField, text: string) => void): void {
  const runtime = useMarketRuntime()

  useEffect(() => {
    const release = perfMetrics.acquireSampling(browserSamplingEnv())
    let previousStats = { ...runtime.client.stats }
    let previousCommits = perfMetrics.snapshot().totals.commits
    let previousAt = performance.now()
    const loafSamples: CountSample[] = [{ at: previousAt, total: perfMetrics.snapshot().totals.longAnimationFrames }]

    const timer = setInterval(() => {
      const now = performance.now()
      const elapsed = now - previousAt
      const snap = perfMetrics.snapshot()
      const stats = { ...runtime.client.stats }
      const perSecond = ratesPerSecond(
        { messages: stats.messages, trades: stats.trades, items: stats.tradeItems, bytes: stats.bytes },
        { messages: previousStats.messages, trades: previousStats.trades, items: previousStats.tradeItems, bytes: previousStats.bytes },
        elapsed,
      )
      const commitRates = ratesPerSecond(snap.totals.commits, previousCommits, elapsed)

      const loafPerMin = trailingPerMinute(loafSamples, { at: now, total: snap.totals.longAnimationFrames }, LOAF_RATE_WINDOW_MS)

      write('frame', `${snap.frameP95.toFixed(1)} ms · ${snap.pctFramesOverBudget.toFixed(1)}% >${Math.round(FRAME_MISS_THRESHOLD_MS)}ms`)
      write('display', `${snap.displayHz === 'n/a' ? '—' : `${snap.displayHz} Hz`} · ${snap.fps} fps`)
      write('loaf', snap.loafSupported ? `${loafPerMin.toFixed(1)}/min` : 'n/a')
      write('flush', `${snap.flushP50.toFixed(2)} / ${snap.flushP95.toFixed(2)} / ${snap.flushMax.toFixed(2)} ms`)
      write('dataAge', `${snap.dataAgeP50.toFixed(0)} / ${snap.dataAgeP95.toFixed(0)} ms`)
      write('ticks', `${snap.ticksPerFlushP50} / flush · setData ${snap.totals.setDataFlushes}`)
      write('msgs', `${perSecond.messages.toFixed(0)}/s`)
      write('trades', `${perSecond.trades.toFixed(0)}/s`)
      write('items', `${perSecond.items.toFixed(0)}/s`)
      write('kb', `${(perSecond.bytes / 1024).toFixed(1)} KB/s`)
      write(
        'commits',
        Object.entries(commitRates)
          .map(([id, rate]) => `${id} ${rate.toFixed(1)}`)
          .join(' · ') || '—',
      )
      write('longTasks', `${snap.totals.longTasks} (max ${snap.totals.longTaskMaxMs.toFixed(0)} ms)`)
      write(
        'net',
        `gaps ${stats.gaps} · resyncs ${stats.resyncs} · dups ${stats.duplicates} · reconnects ${stats.reconnects}`,
      )

      previousStats = stats
      previousCommits = snap.totals.commits
      previousAt = now
    }, HUD_REFRESH_MS)

    return () => {
      clearInterval(timer)
      release()
    }
  }, [runtime, write])
}
