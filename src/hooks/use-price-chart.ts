// Owns the Lightweight Charts instance. Ticks flow client → ChartFeeder → series.update()
// inside requestAnimationFrame; React state is never involved.

import {
  ColorType,
  createChart,
  createSeriesMarkers,
  isUTCTimestamp,
  LineSeries,
  LineStyle,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { type RefObject, useEffect } from 'react'
import { CHART_COLORS, CHART_FONT } from '@/config/chart-theme'
import { CHART_BACKLOG_THRESHOLD } from '@/config/market'
import { useMarketRuntime } from '@/hooks/use-market-runtime'
import { perfMetrics } from '@/lib/perf/perf-metrics'
import { ChartFeeder } from '@/lib/realtime/chart-feeder'
import { selectUserTrades } from '@/lib/realtime/market-store'
import type { ChartPoint, Trade } from '@/lib/realtime/protocol'
import { formatClock, formatPercent } from '@/lib/utils/format'
import { SIDE_LABEL } from '@/lib/utils/side-label'

// Lightweight Charts brands unix seconds as UTCTimestamp; this is the one sanctioned cast.
function toUtc(seconds: number): UTCTimestamp {
  return seconds as UTCTimestamp
}

function toSeriesPoint(point: ChartPoint): { time: UTCTimestamp; value: number } {
  return { time: toUtc(point.time), value: point.value }
}

function formatTime(time: Time): string {
  return isUTCTimestamp(time) ? formatClock(time * 1_000) : ''
}

function toMarker(trade: Trade): SeriesMarker<Time> {
  const yes = trade.side === 'yes'
  return {
    time: toUtc(Math.floor(trade.ts / 1_000)),
    position: yes ? 'belowBar' : 'aboveBar',
    shape: yes ? 'arrowUp' : 'arrowDown',
    color: yes ? CHART_COLORS.yes : CHART_COLORS.no,
    text: `${SIDE_LABEL[trade.side]} ${Math.round(trade.shares)}`,
  }
}

export function usePriceChart(container: RefObject<HTMLDivElement | null>): void {
  const runtime = useMarketRuntime()

  useEffect(() => {
    const element = container.current
    if (element === null) return

    const chart = createChart(element, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: CHART_COLORS.background },
        textColor: CHART_COLORS.text,
        fontFamily: CHART_FONT,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: CHART_COLORS.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 4,
        barSpacing: 10,
        fixLeftEdge: true,
        tickMarkFormatter: formatTime,
      },
      localization: { priceFormatter: formatPercent, timeFormatter: formatTime },
    })
    const series = chart.addSeries(LineSeries, {
      color: CHART_COLORS.line,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      priceFormat: { type: 'custom', formatter: formatPercent, minMove: 0.001 },
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 1 } }),
    })
    series.createPriceLine({
      price: 0.5,
      color: CHART_COLORS.baseline,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
      title: '',
    })
    const markers = createSeriesMarkers(series, [])

    const feeder = new ChartFeeder(
      {
        update: (point) => series.update(toSeriesPoint(point)),
        setData: (points) => series.setData(points.map(toSeriesPoint)),
      },
      {
        scheduler: {
          request: (callback) => {
            const handle = requestAnimationFrame(callback)
            return () => cancelAnimationFrame(handle)
          },
        },
        perfNow: () => performance.now(),
        serverNow: () => runtime.serverNow(),
        backlogThreshold: CHART_BACKLOG_THRESHOLD,
        onFlush: (stats) => perfMetrics.recordFlush(stats),
      },
    )
    const offMessage = runtime.client.onMessage((message) => feeder.handle(message))

    // Markers change only on the user's own fills — subscribe outside React.
    let userTrades = selectUserTrades(runtime.market.store.getState())
    markers.setMarkers(userTrades.map(toMarker))
    const offStore = runtime.market.store.subscribe(() => {
      const next = selectUserTrades(runtime.market.store.getState())
      if (next === userTrades) return
      userTrades = next
      markers.setMarkers(next.map(toMarker))
    })

    // Mounted after the session started (HMR/remount): fetch the full round. The client
    // remembers the request and sends it on the next open if the socket is down right now.
    if (runtime.client.getStatus() !== 'idle') runtime.client.requestSnapshot()

    return () => {
      offMessage()
      offStore()
      feeder.dispose()
      chart.remove()
    }
  }, [container, runtime])
}
