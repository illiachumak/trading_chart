import { Panel } from '@/components/common/panel'
import { SideLabel } from '@/components/features/market/side-label'
import { useAccount } from '@/hooks/use-market'
import { selectRoundHistory } from '@/lib/realtime/account-store'
import type { RoundResult } from '@/lib/realtime/protocol'
import { formatSignedUsd, PLACEHOLDER } from '@/lib/utils/format'

function pnlClass(round: RoundResult): string {
  if (round.spent <= 0) return 'text-muted'
  return round.pnl >= 0 ? 'text-yes' : 'text-no'
}

export function RoundHistory() {
  const history = useAccount(selectRoundHistory)
  return (
    <Panel title="Round history">
      {history.length === 0 ? (
        <p className="text-body text-muted">No rounds resolved yet</p>
      ) : (
        <ul className="max-h-[20rem] divide-hairline divide-border overflow-y-auto text-body tabular-nums">
          {history.map((round) => (
            <li key={round.roundId} className="flex items-center justify-between py-1.5">
              <span className="font-mono text-caption text-muted">#{round.roundId}</span>
              <SideLabel side={round.outcome} />
              <span className={pnlClass(round)}>{round.spent > 0 ? formatSignedUsd(round.pnl) : PLACEHOLDER}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
