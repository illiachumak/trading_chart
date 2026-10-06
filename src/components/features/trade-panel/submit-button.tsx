import { Button } from '@/components/common/button'
import { useAccount } from '@/hooks/use-market'
import { hasOkQuoteFor } from '@/lib/realtime/account-store'
import type { Side } from '@/lib/realtime/protocol'
import { SIDE_LABEL } from '@/lib/utils/side'

type SubmitButtonProps = {
  side: Side
  amount: number | 'invalid'
  slippage: number
  marketReady: boolean
  pending: boolean
  onSubmit: () => void
}

/** Leaf subscriber: re-renders only when "has a fillable quote for this side/amount/slippage" flips. */
export function SubmitButton({ side, amount, slippage, marketReady, pending, onSubmit }: SubmitButtonProps) {
  const hasQuote = useAccount((state) => hasOkQuoteFor(state, side, amount, slippage))
  return (
    <Button
      variant="primary"
      className="w-full"
      disabled={!marketReady || !hasQuote}
      data-testid="ticket-submit"
      onClick={onSubmit}
    >
      {pending ? 'Placing…' : `Buy ${SIDE_LABEL[side]}`}
    </Button>
  )
}
