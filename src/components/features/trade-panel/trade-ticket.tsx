import { AmountInput } from '@/components/features/trade-panel/amount-input'
import { OrderStatusLine } from '@/components/features/trade-panel/order-status-line'
import { QuoteSummary } from '@/components/features/trade-panel/quote-summary'
import { SideButton } from '@/components/features/trade-panel/side-button'
import { useTradeTicket } from '@/hooks/use-trade-ticket'
import { SIDE_LABEL } from '@/lib/utils/side-label'

export function TradeTicket() {
  const ticket = useTradeTicket()
  return (
    <section className="card flex flex-col gap-4 p-4 md:p-5">
      <h2 className="eyebrow">Trade</h2>
      <div className="grid grid-cols-2 gap-2">
        <SideButton side="yes" selected={ticket.side === 'yes'} onSelect={ticket.setSide} />
        <SideButton side="no" selected={ticket.side === 'no'} onSelect={ticket.setSide} />
      </div>
      <AmountInput value={ticket.amountInput} valid={ticket.amountValid} onChange={ticket.setAmountInput} />
      <div className="border-b-hairline border-border" />
      <QuoteSummary quote={ticket.quote} />
      <button
        type="button"
        disabled={!ticket.canSubmit}
        onClick={ticket.submit}
        className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-40"
      >
        {ticket.order.kind === 'pending' ? 'Placing…' : `Buy ${SIDE_LABEL[ticket.side]}`}
      </button>
      <OrderStatusLine order={ticket.order} />
    </section>
  )
}
