import { memo } from 'react'
import { useMarket } from '@/hooks/use-market'
import { selectRecentTrades } from '@/lib/realtime/market-store'
import type { Trade } from '@/lib/realtime/protocol'
import { formatCents, formatClock, formatShares } from '@/lib/utils/format'
import { SIDE_LABEL } from '@/lib/utils/side-label'

/** Row height is h-8 (2rem) exactly, so the 24rem list shows whole rows only. */
const VISIBLE_TRADES = 12
const GRID = 'grid grid-cols-[3rem_1fr_4.5rem_4.5rem] gap-2'

export function TradesFeed() {
  const trades = useMarket(selectRecentTrades)
  return (
    <section className="card p-4 md:p-5">
      <h2 className="eyebrow mb-3">Live trades</h2>
      <div className={`${GRID} px-1 pb-2 text-caption text-muted`}>
        <span>Side</span>
        <span>Shares</span>
        <span className="text-right">YES after</span>
        <span className="text-right">Time</span>
      </div>
      <ul className="h-[24rem] overflow-hidden" data-testid="trades-feed">
        {trades.slice(0, VISIBLE_TRADES).map((trade) => (
          <TradeRow key={trade.id} trade={trade} />
        ))}
      </ul>
    </section>
  )
}

// Rows keep identity across publishes, so only new rows render.
const TradeRow = memo(function TradeRow({ trade }: { trade: Trade }) {
  return (
    <li className={`${GRID} h-8 items-center border-b-hairline border-border px-1 text-body tabular-nums last:border-b-0`}>
      <span className={trade.side === 'yes' ? 'font-medium text-yes' : 'font-medium text-no'}>
        {SIDE_LABEL[trade.side]}
      </span>
      <span>
        {formatShares(trade.shares)}
        {trade.source === 'user' && (
          <span className="ml-2 rounded-pill border-hairline border-brand-border bg-brand-surface px-1.5 text-caption text-brand-text">
            you
          </span>
        )}
      </span>
      <span className="text-right">{formatCents(trade.priceAfter)}</span>
      <span className="text-right font-mono text-caption text-muted">{formatClock(trade.ts)}</span>
    </li>
  )
})
