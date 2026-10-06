import { ConnectionBadge } from '@/components/layout/connection-badge'
import { ModeTabs } from '@/components/layout/mode-tabs'

export function Header() {
  return (
    <header className="sticky top-0 z-10 border-b-hairline border-border bg-canvas/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-8">
        <div className="flex items-baseline gap-3">
          <h1 className="text-heading">Coinflip</h1>
          <span className="hidden text-body text-muted sm:inline">Will this round resolve YES?</span>
        </div>
        <div className="flex items-center gap-3">
          <ModeTabs />
          <ConnectionBadge />
        </div>
      </div>
    </header>
  )
}
