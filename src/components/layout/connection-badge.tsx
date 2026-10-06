import { useMarket } from '@/hooks/use-market'
import type { ConnectionStatus } from '@/lib/realtime/market-client'
import { selectStatus } from '@/lib/realtime/market-store'

const STATUS_VIEW: Record<ConnectionStatus, { label: string; dot: string }> = {
  idle: { label: 'Offline', dot: 'bg-muted' },
  connecting: { label: 'Connecting', dot: 'bg-warn' },
  resyncing: { label: 'Syncing', dot: 'bg-warn' },
  live: { label: 'Live', dot: 'bg-yes' },
  reconnecting: { label: 'Reconnecting', dot: 'bg-no' },
}

export function ConnectionBadge() {
  const status = useMarket(selectStatus)
  const view = STATUS_VIEW[status]
  return (
    <span className="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs" data-testid="connection-status">
      <span className={`size-2 rounded-full ${view.dot}`} />
      {view.label}
    </span>
  )
}
