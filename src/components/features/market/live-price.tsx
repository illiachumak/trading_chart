import { useMarket } from '@/hooks/use-market'
import { selectPrice } from '@/lib/realtime/market-store'
import type { Side } from '@/lib/realtime/protocol'
import { formatPercent, formatSideCents, PLACEHOLDER } from '@/lib/utils/format'

type LivePriceProps = { side: Side; format: 'cents' | 'percent' }

function formatPrice(yesPrice: number, { side, format }: LivePriceProps): string {
  if (format === 'cents') return formatSideCents(yesPrice, side)
  return formatPercent(side === 'yes' ? yesPrice : 1 - yesPrice)
}

/**
 * Leaf that subscribes to the throttled price on its own, so only this text node
 * re-renders on price changes — parents stay presentational and commit-free.
 */
export function LivePrice(props: LivePriceProps) {
  const price = useMarket(selectPrice)
  return <>{price === 'loading' ? PLACEHOLDER : formatPrice(price, props)}</>
}
