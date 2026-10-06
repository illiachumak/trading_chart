import { ConnectionBadge } from '@/components/layout/connection-badge'
import { ModeTabs } from '@/components/layout/mode-tabs'

export function Header() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold">Coinflip</h1>
          <span className="hidden text-sm text-muted sm:inline">Will this round resolve YES?</span>
        </div>
        <div className="flex items-center gap-3">
          <ModeTabs />
          <ConnectionBadge />
        </div>
      </div>
    </header>
  )
}
