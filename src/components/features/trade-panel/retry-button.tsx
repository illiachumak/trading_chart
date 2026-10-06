import { Button } from '@/components/common/button'
import { useRetryPrice } from '@/hooks/use-retry-price'
import type { Side } from '@/lib/realtime/protocol'
import { describeRetry } from '@/lib/utils/describe-order-result'

type RetryButtonProps = {
  side: Side
  amount: number | 'invalid'
  slippage: number
  /** Market live and round known (same gate as the submit button). */
  marketReady: boolean
  onRetry: () => void
}

/** Leaf subscriber: shown only after a slippage rejection, priced from the latest quote. */
export function RetryButton({ side, amount, slippage, marketReady, onRetry }: RetryButtonProps) {
  const price = useRetryPrice(side, amount, slippage)
  if (price === 'none') return null
  const { label, ariaLabel } = describeRetry(price)
  return (
    <Button variant="subtle" size="sm" disabled={!marketReady} aria-label={ariaLabel} data-testid="ticket-retry" onClick={onRetry}>
      {label}
    </Button>
  )
}
