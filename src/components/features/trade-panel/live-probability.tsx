import { useMarket } from '@/hooks/use-market'
import { selectPrice } from '@/lib/realtime/market-store'
import type { Side } from '@/lib/realtime/protocol'
import { formatSideCents } from '@/lib/utils/format'
import { SIDE_LABEL } from '@/lib/utils/side-label'

const OUTCOME_TONE: Record<Side, { shell: string; label: string }> = {
  yes: { shell: 'border-yes/40 bg-yes-soft', label: 'text-yes' },
  no: { shell: 'border-no/40 bg-no-soft', label: 'text-no' },
}

export function LiveProbability() {
  const price = useMarket(selectPrice)
  return (
    <section className="card p-4 md:p-5">
      <p className="eyebrow">Live probability</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Outcome side="yes" price={price} />
        <Outcome side="no" price={price} />
      </div>
    </section>
  )
}

function Outcome({ side, price }: { side: Side; price: number | 'loading' }) {
  const tone = OUTCOME_TONE[side]
  return (
    <div className={`rounded-control border-hairline p-3 ${tone.shell}`}>
      <p className={`text-caption font-semibold ${tone.label}`}>{SIDE_LABEL[side]}</p>
      <p className="mt-1 text-heading-lg tabular-nums">{price === 'loading' ? '—' : formatSideCents(price, side)}</p>
    </div>
  )
}
