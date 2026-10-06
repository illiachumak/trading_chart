import { useAccount } from '@/hooks/use-market'
import { selectAccount } from '@/lib/realtime/account-store'
import type { RoundResult } from '@/lib/realtime/protocol'
import { formatSignedUsd } from '@/lib/utils/format'
import { SIDE_LABEL } from '@/lib/utils/side-label'

const EMPTY: readonly RoundResult[] = []

function pnlClass(round: RoundResult): string {
  if (round.spent <= 0) return 'text-muted'
  return round.pnl >= 0 ? 'text-yes' : 'text-no'
}

export function RoundHistory() {
  const account = useAccount(selectAccount)
  const history = account === 'loading' ? EMPTY : account.history
  return (
    <section className="card p-4 md:p-5">
      <h2 className="eyebrow mb-3">Round history</h2>
      {history.length === 0 ? (
        <p className="text-body text-muted">No rounds resolved yet</p>
      ) : (
        <ul className="text-body tabular-nums">
          {history.map((round) => (
            <li
              key={round.roundId}
              className="flex items-center justify-between border-b-hairline border-border py-1.5 last:border-b-0"
            >
              <span className="font-mono text-caption text-muted">#{round.roundId}</span>
              <span className={round.outcome === 'yes' ? 'font-medium text-yes' : 'font-medium text-no'}>
                {SIDE_LABEL[round.outcome]}
              </span>
              <span className={pnlClass(round)}>{round.spent > 0 ? formatSignedUsd(round.pnl) : '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
