import type { Side } from '@/lib/realtime/protocol'
import { cn } from '@/lib/utils/cn'
import { SIDE_LABEL, SIDE_TONE } from '@/lib/utils/side'

export function SideLabel({ side, className }: { side: Side; className?: string }) {
  return <span className={cn('font-medium', SIDE_TONE[side].text, className)}>{SIDE_LABEL[side]}</span>
}
