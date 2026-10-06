import { useCallback } from 'react'
import { useCountdown } from '@/hooks/use-countdown'
import { useMarket } from '@/hooks/use-market'
import { useMarketRuntime } from '@/hooks/use-market-runtime'
import { selectLastResolution, selectPrice, selectRound } from '@/lib/realtime/market-store'
import { formatCountdown, formatPercent } from '@/lib/utils/format'
import { SIDE_LABEL } from '@/lib/utils/side-label'

export function RoundHeader() {
  const round = useMarket(selectRound)
  if (round === 'loading') {
    return <div className="h-20 animate-pulse rounded-control bg-surface-raised" />
  }
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow">Round #{round.id}</p>
        <Probability />
      </div>
      <div className="text-right">
        <Countdown endTs={round.endTs} />
        <LastResolution />
      </div>
    </div>
  )
}

function Probability() {
  const price = useMarket(selectPrice)
  return (
    <p className="mt-1 text-display tabular-nums" data-testid="probability">
      {price === 'loading' ? '—' : formatPercent(price)}
      <span className="ml-2 text-body-lg font-normal tracking-normal text-fg-secondary">chance YES</span>
    </p>
  )
}

function Countdown({ endTs }: { endTs: number }) {
  const runtime = useMarketRuntime()
  const now = useCallback(() => runtime.serverNow(), [runtime])
  const seconds = useCountdown(endTs, now)
  return (
    <p className="text-heading-lg tabular-nums">
      {formatCountdown(seconds)}
      <span className="ml-2 text-body font-normal tracking-normal text-muted">left</span>
    </p>
  )
}

function LastResolution() {
  const resolution = useMarket(selectLastResolution)
  if (resolution === 'none') return <p className="text-body text-muted">Resolves by coinflip</p>
  return (
    <p className="text-body text-muted">
      Round #{resolution.roundId} →{' '}
      <span className={resolution.outcome === 'yes' ? 'font-medium text-yes' : 'font-medium text-no'}>
        {SIDE_LABEL[resolution.outcome]}
      </span>
    </p>
  )
}
