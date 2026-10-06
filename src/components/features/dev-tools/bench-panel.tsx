import { Badge } from '@/components/common/badge'
import { useBench } from '@/hooks/use-bench'
import { cn } from '@/lib/utils/cn'

/** Progress + raw JSON results of a `?bench=` run. Renders nothing otherwise. */
export function BenchPanel() {
  const bench = useBench()
  if (bench === 'disabled') return null

  return (
    <aside
      // Bottom-right, above the dev footer; the perf HUD is docked top-left.
      // Compact while measuring so it covers as little of the page as possible.
      className={cn(
        'card fixed right-4 bottom-16 z-50 flex max-h-[60vh] max-w-[calc(100vw-2rem)] flex-col gap-2 p-3 font-mono text-caption shadow-sticky',
        bench.kind === 'done' ? 'w-[28rem]' : 'w-72',
      )}
      data-testid="bench-panel"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="eyebrow">Benchmark</h2>
        <Badge tone="brand">{bench.mode}</Badge>
      </div>
      {bench.kind === 'idle' && <p className="text-muted">Waiting for a live connection…</p>}
      {bench.kind === 'running' && (
        <p className="text-fg-secondary" data-testid="bench-phase">
          <span className="tabular-nums text-muted">
            {bench.index + 1}/{bench.total}
          </span>{' '}
          {bench.phase}
        </p>
      )}
      {bench.kind === 'done' && (
        <>
          <p className="text-yes" data-testid="bench-done">
            {bench.output.kind === 'phases'
              ? `Benchmark done · ${bench.output.results.length} phases`
              : `Soak done · ${bench.output.result.samples.length} samples`}
          </p>
          {bench.seedWarning !== 'none' && (
            <p className="text-warn" data-testid="bench-seed-warning">
              {bench.seedWarning}
            </p>
          )}
          <pre data-testid="bench-result" className="min-h-0 overflow-auto whitespace-pre-wrap text-fg-secondary">
            {JSON.stringify(bench.output.kind === 'phases' ? bench.output.results : bench.output.result, null, 2)}
          </pre>
        </>
      )}
    </aside>
  )
}
