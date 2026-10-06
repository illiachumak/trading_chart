import { useCallback } from 'react'
import { Skeleton } from '@/components/common/skeleton'
import { LivePrice } from '@/components/features/market/live-price'
import { SideLabel } from '@/components/features/market/side-label'
import { useCountdown } from '@/hooks/use-countdown'
import { useMarket } from '@/hooks/use-market'
import { useMarketRuntime } from '@/hooks/use-market-runtime'
import { selectLastResolution, selectRound } from '@/lib/realtime/market-store'
import { formatCountdown } from '@/lib/utils/format'

export function RoundHeader() {
  const round = useMarket(selectRound)
  if (round === 'loading') return <Skeleton className="h-20" />
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="eyebrow">Round #{round.id}</h2>
        <p className="mt-1 text-display tabular-nums" data-testid="probability">
          <LivePrice side="yes" format="percent" />
          <span className="ml-2 text-body-lg font-normal tracking-normal text-fg-secondary">chance YES</span>
        </p>
      </div>
      <div className="text-right">
        <Countdown endTs={round.endTs} />
        <LastResolution />
      </div>
    </div>
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
      Round #{resolution.roundId} → <SideLabel side={resolution.outcome} />
    </p>
  )
}
