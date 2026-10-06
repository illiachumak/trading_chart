import { memo } from 'react'
import { Badge } from '@/components/common/badge'
import { Panel } from '@/components/common/panel'
import { SideLabel } from '@/components/features/market/side-label'
import { useMarket } from '@/hooks/use-market'
import { selectRecentTrades } from '@/lib/realtime/market-store'
import type { Trade } from '@/lib/realtime/protocol'
import { cn } from '@/lib/utils/cn'
import { formatCents, formatClock, formatShares } from '@/lib/utils/format'

/** Row height is h-8 (2rem) exactly, so the 24rem list shows whole rows only. */
const VISIBLE_TRADES = 12
const GRID = 'grid grid-cols-[3rem_1fr_4.5rem_4.5rem] gap-2'

export function TradesFeed() {
  const trades = useMarket(selectRecentTrades)
  return (
    <Panel title="Live trades">
      <div>
        <div className={cn(GRID, 'px-1 pb-2 text-caption text-muted')}>
          <span>Side</span>
          <span>Shares</span>
          <span className="text-right">YES after</span>
          <span className="text-right">Time</span>
        </div>
        <ul className="h-[24rem] divide-hairline divide-border overflow-hidden" data-testid="trades-feed">
          {trades.slice(0, VISIBLE_TRADES).map((trade) => (
            <TradeRow key={trade.id} trade={trade} />
          ))}
        </ul>
      </div>
    </Panel>
  )
}

// Rows keep identity across publishes, so only new rows render.
const TradeRow = memo(function TradeRow({ trade }: { trade: Trade }) {
  return (
    <li className={cn(GRID, 'h-8 items-center px-1 text-body tabular-nums')}>
      <SideLabel side={trade.side} />
      <span>
        {formatShares(trade.shares)}
        {trade.source === 'user' && (
          <Badge tone="brand" className="ml-2">
            you
          </Badge>
        )}
      </span>
      <span className="text-right">{formatCents(trade.priceAfter)}</span>
      <span className="text-right font-mono text-caption text-muted">{formatClock(trade.ts)}</span>
    </li>
  )
})
