import type { ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

/** Two-column label → value list. Children are `<Stat>` rows (plus optional full-width notes). */
export function StatList({ className, children }: { className?: string; children: ReactNode }) {
  return <dl className={cn('grid grid-cols-2 items-baseline gap-y-1.5 text-body tabular-nums', className)}>{children}</dl>
}

type StatProps = { label: string; className?: string; testId?: string; children: ReactNode }

export function Stat({ label, className, testId, children }: StatProps) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className={cn('text-right', className)} data-testid={testId}>
        {children}
      </dd>
    </>
  )
}
