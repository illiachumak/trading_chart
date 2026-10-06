import { Panel } from '@/components/common/panel'
import { Skeleton } from '@/components/common/skeleton'
import { Stat, StatList } from '@/components/common/stat-list'
import { useAccount } from '@/hooks/use-market'
import { selectAccount } from '@/lib/realtime/account-store'
import { formatShares, formatUsd } from '@/lib/utils/format'

export function AccountSummary() {
  const account = useAccount(selectAccount)
  if (account === 'loading') return <Skeleton className="h-32 rounded-card" />
  const { position } = account
  return (
    <Panel title="Account" className="text-body">
      <div className="flex items-baseline justify-between border-b-hairline border-border pb-3">
        <span className="text-fg-secondary">Balance</span>
        <span className="text-heading-lg tabular-nums" data-testid="balance">
          {formatUsd(account.balance)}
        </span>
      </div>
      {position.spent > 0 ? (
        <StatList>
          <Stat label="YES shares" className="text-yes">
            {formatShares(position.yesShares)}
          </Stat>
          <Stat label="NO shares" className="text-no">
            {formatShares(position.noShares)}
          </Stat>
          <Stat label="Spent">{formatUsd(position.spent)}</Stat>
          <Stat label="If YES wins">{formatUsd(position.payoutIfYes)}</Stat>
          <Stat label="If NO wins">{formatUsd(position.payoutIfNo)}</Stat>
        </StatList>
      ) : (
        <p className="text-muted">No position this round</p>
      )}
    </Panel>
  )
}
