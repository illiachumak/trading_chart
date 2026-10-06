import type { QuoteResult } from '@/lib/realtime/protocol'
import { PRICE_BOUND } from '@/config/market'
import { formatCents, formatPercent, formatShares, formatSignedUsd, formatUsd } from '@/lib/utils/format'

export function QuoteSummary({ quote }: { quote: QuoteResult | 'none' }) {
  if (quote !== 'none' && quote.status === 'unavailable') {
    return <p className="text-body text-warn">Price is at the {formatPercent(PRICE_BOUND)} limit — no shares available</p>
  }
  const ok = quote === 'none' ? 'none' : quote
  return (
    <dl className="grid grid-cols-2 items-baseline gap-y-1.5 text-body tabular-nums">
      <dt className="text-muted">Shares</dt>
      <dd className="text-right">{ok === 'none' ? '—' : formatShares(ok.shares)}</dd>
      <dt className="text-muted">Avg price</dt>
      <dd className="text-right">{ok === 'none' ? '—' : formatCents(ok.avgPrice)}</dd>
      <dt className="text-muted">To win</dt>
      <dd className="text-right text-heading text-yes" data-testid="to-win">
        {ok === 'none' ? '—' : formatUsd(ok.potentialPayout)}
      </dd>
      <dt className="text-muted">Profit if right</dt>
      <dd className="text-right text-fg-secondary">{ok === 'none' ? '—' : formatSignedUsd(ok.potentialProfit)}</dd>
      {ok !== 'none' && ok.clipped && (
        <dd className="col-span-2 text-caption text-warn">Only {formatUsd(ok.cost)} fills before the {formatPercent(PRICE_BOUND)} limit</dd>
      )}
    </dl>
  )
}
