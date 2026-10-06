import { Stat, StatList } from '@/components/common/stat-list'
import { PRICE_BOUND } from '@/config/market'
import type { QuoteResult } from '@/lib/realtime/protocol'
import { PRICE_LIMIT_TEXT } from '@/lib/utils/describe-order-result'
import { formatCents, formatPercent, formatShares, formatSignedUsd, formatUsd, PLACEHOLDER } from '@/lib/utils/format'

export function QuoteSummary({ quote }: { quote: QuoteResult | 'none' }) {
  if (quote === 'none') return <QuoteStats shares={PLACEHOLDER} avgPrice={PLACEHOLDER} toWin={PLACEHOLDER} profit={PLACEHOLDER} />
  if (quote.status === 'unavailable') return <p className="text-body text-warn">{PRICE_LIMIT_TEXT}</p>
  return (
    <QuoteStats
      shares={formatShares(quote.shares)}
      avgPrice={formatCents(quote.avgPrice)}
      toWin={formatUsd(quote.potentialPayout)}
      profit={formatSignedUsd(quote.potentialProfit)}
      note={quote.clipped ? `Only ${formatUsd(quote.cost)} fills before the ${formatPercent(PRICE_BOUND)} limit` : 'none'}
    />
  )
}

type QuoteStatsProps = { shares: string; avgPrice: string; toWin: string; profit: string; note?: string }

function QuoteStats({ shares, avgPrice, toWin, profit, note = 'none' }: QuoteStatsProps) {
  return (
    <StatList>
      <Stat label="Shares">{shares}</Stat>
      <Stat label="Avg price">{avgPrice}</Stat>
      <Stat label="To win" className="text-heading text-yes" testId="to-win">
        {toWin}
      </Stat>
      <Stat label="Profit if right" className="text-fg-secondary">
        {profit}
      </Stat>
      {note !== 'none' && <dd className="col-span-2 text-caption text-warn">{note}</dd>}
    </StatList>
  )
}
