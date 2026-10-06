import type { OrderStatus } from '@/lib/realtime/account-store'
import { cn } from '@/lib/utils/cn'
import { describeOrderResult, type OrderMessage } from '@/lib/utils/describe-order-result'
import { SIDE_TONE } from '@/lib/utils/side'

const TONE_CLASS: Record<OrderMessage['tone'], string> = {
  yes: SIDE_TONE.yes.text,
  no: SIDE_TONE.no.text,
  warn: 'text-warn',
}

type Line = { text: string; toneClass: string }

function lineFor(order: OrderStatus): Line {
  switch (order.kind) {
    case 'idle':
      return { text: '', toneClass: 'text-muted' }
    case 'pending':
      return { text: 'Sending order…', toneClass: 'text-muted' }
    case 'done': {
      const message = describeOrderResult(order.result)
      return { text: message.text, toneClass: TONE_CLASS[message.tone] }
    }
  }
}

/** One persistent live region: announcements work because the element exists before its text changes. */
export function OrderStatusLine({ order }: { order: OrderStatus }) {
  const line = lineFor(order)
  return (
    <p role="status" aria-live="polite" className={cn('min-h-5 text-body', line.toneClass)} data-testid="order-status">
      {line.text}
    </p>
  )
}
