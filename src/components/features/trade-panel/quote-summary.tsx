import { Stat, StatList } from '@/components/common/stat-list'
import { PRICE_BOUND } from '@/config/market'
import { useAccount } from '@/hooks/use-market'
import { pickQuoteFor } from '@/lib/realtime/account-store'
import type { Side } from '@/lib/realtime/protocol'
import { PRICE_LIMIT_TEXT } from '@/lib/utils/describe-order-result'
import { formatCents, formatPercent, formatShares, formatSignedUsd, formatSlippage, formatUsd, PLACEHOLDER } from '@/lib/utils/format'

type QuoteSummaryProps = { side: Side; amount: number | 'invalid'; slippage: number }

/** Leaf subscriber: the only quote reader besides the submit button, so quote updates re-render just these. */
export function QuoteSummary({ side, amount, slippage }: QuoteSummaryProps) {
  const quote = useAccount((state) => pickQuoteFor(state, side, amount, slippage))
  const maxSlippage = formatSlippage(slippage)
  if (quote === 'none') {
    return <QuoteStats shares={PLACEHOLDER} avgPrice={PLACEHOLDER} toWin={PLACEHOLDER} profit={PLACEHOLDER} maxSlippage={maxSlippage} />
  }
  if (quote.status === 'unavailable') return <p className="text-body text-warn">{PRICE_LIMIT_TEXT}</p>
  return (
    <QuoteStats
      shares={formatShares(quote.shares)}
      avgPrice={formatCents(quote.avgPrice)}
      toWin={formatUsd(quote.potentialPayout)}
      profit={formatSignedUsd(quote.potentialProfit)}
      maxSlippage={maxSlippage}
      note={quote.clipped ? `Only ${formatUsd(quote.cost)} fills before the ${formatPercent(PRICE_BOUND)} limit` : 'none'}
    />
  )
}

type QuoteStatsProps = { shares: string; avgPrice: string; toWin: string; profit: string; maxSlippage: string; note?: string }

function QuoteStats({ shares, avgPrice, toWin, profit, maxSlippage, note = 'none' }: QuoteStatsProps) {
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
      <Stat label="Max slippage" className="text-fg-secondary">
        {maxSlippage}
      </Stat>
      {note !== 'none' && <dd className="col-span-2 text-caption text-warn">{note}</dd>}
    </StatList>
  )
}
