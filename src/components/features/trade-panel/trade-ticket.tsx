import { Button } from '@/components/common/button'
import { Panel } from '@/components/common/panel'
import { AmountInput } from '@/components/features/trade-panel/amount-input'
import { OrderStatusLine } from '@/components/features/trade-panel/order-status-line'
import { QuoteSummary } from '@/components/features/trade-panel/quote-summary'
import { SideButton } from '@/components/features/trade-panel/side-button'
import { useTradeTicket } from '@/hooks/use-trade-ticket'
import { SIDE_LABEL } from '@/lib/utils/side'

export function TradeTicket() {
  const ticket = useTradeTicket()
  return (
    <Panel title="Trade" className="gap-4">
      <div className="grid grid-cols-2 gap-2">
        <SideButton side="yes" selected={ticket.side === 'yes'} onSelect={ticket.setSide} />
        <SideButton side="no" selected={ticket.side === 'no'} onSelect={ticket.setSide} />
      </div>
      <AmountInput value={ticket.amountInput} valid={ticket.amountValid} onChange={ticket.setAmountInput} />
      <div className="border-b-hairline border-border" />
      <QuoteSummary quote={ticket.quote} />
      <Button variant="primary" className="w-full" disabled={!ticket.canSubmit} onClick={ticket.submit}>
        {ticket.order.kind === 'pending' ? 'Placing…' : `Buy ${SIDE_LABEL[ticket.side]}`}
      </Button>
      <OrderStatusLine order={ticket.order} />
    </Panel>
  )
}
