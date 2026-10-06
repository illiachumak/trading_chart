import type { OrderStatus } from '@/lib/realtime/account-store'
import { describeOrderResult, type OrderMessage } from '@/lib/utils/describe-order-result'

const TONE_CLASS: Record<OrderMessage['tone'], string> = { yes: 'text-yes', no: 'text-no', warn: 'text-warn' }

export function OrderStatusLine({ order }: { order: OrderStatus }) {
  if (order.kind === 'idle') return null
  if (order.kind === 'pending') return <p className="text-body text-muted">Sending order…</p>
  const message = describeOrderResult(order.result)
  return (
    <p role="status" className={`text-body ${TONE_CLASS[message.tone]}`} data-testid="order-status">
      {message.text}
    </p>
  )
}
