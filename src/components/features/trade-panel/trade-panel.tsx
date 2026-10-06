import { AccountSummary } from '@/components/features/trade-panel/account-summary'
import { LiveProbability } from '@/components/features/trade-panel/live-probability'
import { TradeTicket } from '@/components/features/trade-panel/trade-ticket'

export function TradePanel() {
  return (
    <div className="flex flex-col gap-4">
      <LiveProbability />
      <TradeTicket />
      <AccountSummary />
    </div>
  )
}
