import { useMarket } from '@/hooks/use-market'
import { selectPrice } from '@/lib/realtime/market-store'
import type { Side } from '@/lib/realtime/protocol'
import { formatSideCents } from '@/lib/utils/format'
import { SIDE_LABEL } from '@/lib/utils/side-label'

const SELECTED: Record<Side, string> = {
  yes: 'border-yes/40 bg-yes-strong text-yes',
  no: 'border-no/40 bg-no-strong text-no',
}
const IDLE = 'border-border bg-surface-raised text-fg-secondary hover:text-fg'

type SideButtonProps = { side: Side; selected: boolean; onSelect: (side: Side) => void }

export function SideButton({ side, selected, onSelect }: SideButtonProps) {
  const price = useMarket(selectPrice)
  const tone = selected ? SELECTED[side] : IDLE
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(side)}
      className={`h-11 rounded-control border-hairline text-body font-semibold tabular-nums transition-colors ${tone}`}
    >
      {SIDE_LABEL[side]} {price === 'loading' ? '—' : formatSideCents(price, side)}
    </button>
  )
}
