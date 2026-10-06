import { useAccount } from '@/hooks/use-market'
import { selectAccount } from '@/lib/realtime/account-store'
import { formatShares, formatUsd } from '@/lib/utils/format'

export function AccountSummary() {
  const account = useAccount(selectAccount)
  if (account === 'loading') {
    return <section className="card h-32 animate-pulse" />
  }
  const { position } = account
  return (
    <section className="card flex flex-col gap-3 p-4 text-body md:p-5">
      <h2 className="eyebrow">Account</h2>
      <div className="flex items-baseline justify-between border-b-hairline border-border pb-3">
        <span className="text-fg-secondary">Balance</span>
        <span className="text-heading-lg tabular-nums" data-testid="balance">
          {formatUsd(account.balance)}
        </span>
      </div>
      {position.spent > 0 ? (
        <dl className="grid grid-cols-2 gap-y-1.5 tabular-nums">
          <dt className="text-muted">YES shares</dt>
          <dd className="text-right text-yes">{formatShares(position.yesShares)}</dd>
          <dt className="text-muted">NO shares</dt>
          <dd className="text-right text-no">{formatShares(position.noShares)}</dd>
          <dt className="text-muted">Spent</dt>
          <dd className="text-right">{formatUsd(position.spent)}</dd>
          <dt className="text-muted">If YES wins</dt>
          <dd className="text-right">{formatUsd(position.payoutIfYes)}</dd>
          <dt className="text-muted">If NO wins</dt>
          <dd className="text-right">{formatUsd(position.payoutIfNo)}</dd>
        </dl>
      ) : (
        <p className="text-muted">No position this round</p>
      )}
    </section>
  )
}
