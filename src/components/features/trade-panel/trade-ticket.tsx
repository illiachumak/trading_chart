import { Panel } from '@/components/common/panel'
import { AmountInput } from '@/components/features/trade-panel/amount-input'
import { OrderStatusLine } from '@/components/features/trade-panel/order-status-line'
import { QuoteSummary } from '@/components/features/trade-panel/quote-summary'
import { SlippageSelector } from '@/components/features/trade-panel/slippage-selector'
import { SubmitButton } from '@/components/features/trade-panel/submit-button'
import { SideButton } from '@/components/features/trade-panel/side-button'
import { useTradeTicket } from '@/hooks/use-trade-ticket'

export function TradeTicket() {
  const ticket = useTradeTicket()
  return (
    <Panel title="Trade" className="gap-4">
      <div className="grid grid-cols-2 gap-2">
        <SideButton side="yes" selected={ticket.side === 'yes'} onSelect={ticket.setSide} />
        <SideButton side="no" selected={ticket.side === 'no'} onSelect={ticket.setSide} />
      </div>
      <AmountInput value={ticket.amountInput} valid={ticket.amountValid} onChange={ticket.setAmountInput} />
      <SlippageSelector value={ticket.slippage} onChange={ticket.setSlippage} />
      <div className="border-b-hairline border-border" />
      <QuoteSummary side={ticket.side} amount={ticket.amount} slippage={ticket.slippage} />
      <SubmitButton
        side={ticket.side}
        amount={ticket.amount}
        marketReady={ticket.marketReady}
        pending={ticket.order.kind === 'pending'}
        onSubmit={ticket.submit}
      />
      <OrderStatusLine order={ticket.order} />
    </Panel>
  )
}
