import { Panel } from '@/components/common/panel'
import { LivePrice } from '@/components/features/market/live-price'
import { SideLabel } from '@/components/features/market/side-label'
import type { Side } from '@/lib/realtime/protocol'
import { cn } from '@/lib/utils/cn'
import { SIDE_TONE } from '@/lib/utils/side'

export function LiveProbability() {
  return (
    <Panel title="Live probability">
      <div className="grid grid-cols-2 gap-2">
        <Outcome side="yes" />
        <Outcome side="no" />
      </div>
    </Panel>
  )
}

function Outcome({ side }: { side: Side }) {
  return (
    <div className={cn('rounded-control border-hairline p-3', SIDE_TONE[side].soft)}>
      <SideLabel side={side} className="block text-caption font-semibold" />
      <p className="mt-1 text-heading-lg tabular-nums">
        <LivePrice side={side} format="cents" />
      </p>
    </div>
  )
}
