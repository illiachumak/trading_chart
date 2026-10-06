import { Badge } from '@/components/common/badge'
import { useMarket } from '@/hooks/use-market'
import type { ConnectionStatus } from '@/lib/realtime/market-client'
import { selectStatus } from '@/lib/realtime/market-store'
import { cn } from '@/lib/utils/cn'

const STATUS_VIEW: Record<ConnectionStatus, { label: string; dot: string }> = {
  idle: { label: 'Offline', dot: 'bg-subtle' },
  connecting: { label: 'Connecting', dot: 'bg-warn' },
  resyncing: { label: 'Syncing', dot: 'bg-warn' },
  live: { label: 'Live', dot: 'bg-yes' },
  reconnecting: { label: 'Reconnecting', dot: 'bg-no' },
}

export function ConnectionBadge() {
  const status = useMarket(selectStatus)
  const view = STATUS_VIEW[status]
  return (
    <Badge role="status" data-testid="connection-status">
      <span aria-hidden className={cn('size-2 rounded-pill', view.dot)} />
      {view.label}
    </Badge>
  )
}
