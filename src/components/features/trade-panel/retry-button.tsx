import { Button } from '@/components/common/button'
import { useRetryPrice } from '@/hooks/use-retry-price'
import type { Side } from '@/lib/realtime/protocol'
import { describeRetry } from '@/lib/utils/describe-order-result'

type RetryButtonProps = { side: Side; amount: number | 'invalid'; slippage: number; onRetry: () => void }

/** Leaf subscriber: shown only after a slippage rejection, priced from the latest quote. */
export function RetryButton({ side, amount, slippage, onRetry }: RetryButtonProps) {
  const price = useRetryPrice(side, amount, slippage)
  if (price === 'none') return null
  const { label, ariaLabel } = describeRetry(price)
  return (
    <Button variant="subtle" size="sm" aria-label={ariaLabel} data-testid="ticket-retry" onClick={onRetry}>
      {label}
    </Button>
  )
}
