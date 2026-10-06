import { FeatureBoundary } from '@/components/common/feature-boundary'
import { AccountSummary } from '@/components/features/trade-panel/account-summary'
import { LiveProbability } from '@/components/features/trade-panel/live-probability'
import { TradeTicket } from '@/components/features/trade-panel/trade-ticket'

/** Each card has its own boundary, so a crash in one leaves the ticket usable. */
export function TradePanel() {
  return (
    <div className="flex flex-col gap-4">
      <FeatureBoundary id="live-probability">
        <LiveProbability />
      </FeatureBoundary>
      <FeatureBoundary id="trade-ticket">
        <TradeTicket />
      </FeatureBoundary>
      <FeatureBoundary id="account">
        <AccountSummary />
      </FeatureBoundary>
    </div>
  )
}
