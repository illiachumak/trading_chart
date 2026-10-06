import { useCallback, useRef } from 'react'
import { type HudField, usePerfHud } from '@/hooks/use-perf-hud'

const ROWS: readonly { field: HudField; label: string }[] = [
  { field: 'fps', label: 'FPS' },
  { field: 'frame', label: 'Frame p50/p95' },
  { field: 'flush', label: 'Flush p50/p95/max' },
  { field: 'latency', label: 'Tick→paint p50/p95' },
  { field: 'ticks', label: 'Ticks per flush' },
  { field: 'msgs', label: 'Messages' },
  { field: 'trades', label: 'Trades' },
  { field: 'commits', label: 'Commits/s' },
  { field: 'longTasks', label: 'Long tasks' },
  { field: 'net', label: 'Network' },
]

export function PerfHud() {
  const cells = useRef(new Map<HudField, HTMLElement>())
  const write = useCallback((field: HudField, text: string) => {
    const cell = cells.current.get(field)
    if (cell !== undefined && cell.textContent !== text) cell.textContent = text
  }, [])
  usePerfHud(write)

  return (
    <aside
      className="card fixed top-16 right-4 z-50 w-96 p-3 font-mono text-caption shadow-sticky"
      data-testid="perf-hud"
    >
      <dl className="grid grid-cols-[8rem_1fr] gap-x-2 gap-y-1">
        {ROWS.map(({ field, label }) => (
          <div key={field} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd
              className="tabular-nums"
              ref={(element) => {
                if (element !== null) cells.current.set(field, element)
              }}
            >
              —
            </dd>
          </div>
        ))}
      </dl>
    </aside>
  )
}
