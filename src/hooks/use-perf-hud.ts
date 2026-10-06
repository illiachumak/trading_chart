// Samples metrics at HUD_REFRESH_MS and writes text straight into DOM nodes,
// so the HUD itself causes zero React commits.

import { useEffect } from 'react'
import { HUD_REFRESH_MS } from '@/config/market'
import { useMarketRuntime } from '@/hooks/use-market-runtime'
import { browserSamplingEnv, perfMetrics } from '@/lib/perf/perf-metrics'
import { ratesPerSecond } from '@/lib/perf/rates'

export type HudField = 'fps' | 'frame' | 'flush' | 'latency' | 'ticks' | 'msgs' | 'trades' | 'commits' | 'longTasks' | 'net'

export function usePerfHud(write: (field: HudField, text: string) => void): void {
  const runtime = useMarketRuntime()

  useEffect(() => {
    const release = perfMetrics.acquireSampling(browserSamplingEnv())
    let previousStats = { ...runtime.client.stats }
    let previousCommits = perfMetrics.snapshot().totals.commits
    let previousAt = performance.now()

    const timer = setInterval(() => {
      const now = performance.now()
      const elapsed = now - previousAt
      const snap = perfMetrics.snapshot()
      const stats = { ...runtime.client.stats }
      const perSecond = ratesPerSecond(
        { messages: stats.messages, trades: stats.trades },
        { messages: previousStats.messages, trades: previousStats.trades },
        elapsed,
      )
      const commitRates = ratesPerSecond(snap.totals.commits, previousCommits, elapsed)

      write('fps', String(snap.fps))
      write('frame', `${snap.frameP50.toFixed(1)} / ${snap.frameP95.toFixed(1)} ms`)
      write('flush', `${snap.flushP50.toFixed(2)} / ${snap.flushP95.toFixed(2)} / ${snap.flushMax.toFixed(2)} ms`)
      write('latency', `${snap.latencyP50.toFixed(0)} / ${snap.latencyP95.toFixed(0)} ms`)
      write('ticks', `${snap.ticksPerFlushP50} / flush · setData ${snap.totals.setDataFlushes}`)
      write('msgs', `${perSecond.messages.toFixed(0)}/s`)
      write('trades', `${perSecond.trades.toFixed(0)}/s`)
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
