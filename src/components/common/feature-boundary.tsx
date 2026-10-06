import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react'
import { ErrorBoundary } from '@/components/common/error-boundary'
import { perfMetrics } from '@/lib/perf/perf-metrics'

const recordCommit: ProfilerOnRenderCallback = (id) => perfMetrics.recordCommit(id)

/** Error isolation + commit counting for one feature section. */
export function FeatureBoundary({ id, children }: { id: string; children: ReactNode }) {
  return (
    <ErrorBoundary name={id}>
      <Profiler id={id} onRender={recordCommit}>
        {children}
      </Profiler>
    </ErrorBoundary>
  )
}
