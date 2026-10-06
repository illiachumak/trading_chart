import type { ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

type PanelProps = { title: string; className?: string; children: ReactNode }

/** Card shell with an eyebrow heading — the frame of every sidebar/feed section. */
export function Panel({ title, className, children }: PanelProps) {
  return (
    <section className={cn('card flex flex-col gap-3 p-4 md:p-5', className)}>
      <h2 className="eyebrow">{title}</h2>
      {children}
    </section>
  )
}
