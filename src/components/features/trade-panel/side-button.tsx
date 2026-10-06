import { LivePrice } from '@/components/features/market/live-price'
import type { Side } from '@/lib/realtime/protocol'
import { cn } from '@/lib/utils/cn'
import { SIDE_LABEL, SIDE_TONE } from '@/lib/utils/side'

const IDLE = 'border-border bg-surface-raised text-fg-secondary hover:text-fg'

type SideButtonProps = { side: Side; selected: boolean; onSelect: (side: Side) => void }

export function SideButton({ side, selected, onSelect }: SideButtonProps) {
  const tone = SIDE_TONE[side]
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-testid={`ticket-side-${side}`}
      onClick={() => onSelect(side)}
      className={cn(
        'h-11 rounded-control border-hairline text-body font-semibold tabular-nums transition-colors',
        selected ? cn(tone.strong, tone.text) : IDLE,
      )}
    >
      {SIDE_LABEL[side]} <LivePrice side={side} format="cents" />
    </button>
  )
}
