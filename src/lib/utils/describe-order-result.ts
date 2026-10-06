import type { OrderResult, RejectReason } from '@/lib/realtime/protocol'
import { formatCents, formatShares, formatUsd } from '@/lib/utils/format'
import { SIDE_LABEL } from '@/lib/utils/side-label'

export type OrderMessage = { tone: 'yes' | 'no' | 'warn'; text: string }

const REJECTION_TEXT: Record<Exclude<RejectReason, 'slippage'>, string> = {
  round_closed: 'Round closed before your order arrived',
  insufficient_balance: 'Insufficient balance',
  invalid: 'Invalid order',
  price_limit: 'Price is at the 85% limit — no shares available',
}

export function describeOrderResult(result: OrderResult): OrderMessage {
  switch (result.status) {
    case 'filled':
      return {
        tone: result.side,
        text: `Bought ${formatShares(result.shares)} ${SIDE_LABEL[result.side]} @ ${formatCents(result.avgPrice)}`,
      }
    case 'partial':
      return {
        tone: 'warn',
        text: `Partially filled ${formatShares(result.shares)} ${SIDE_LABEL[result.side]} @ ${formatCents(result.avgPrice)} — ${formatUsd(result.refund)} refunded at the 85% limit`,
      }
    case 'rejected':
      if (result.reason === 'slippage') {
        return {
          tone: 'warn',
          text: `Price moved to ${formatCents(result.currentPrice)} before your order filled — not executed`,
        }
      }
      return { tone: 'warn', text: REJECTION_TEXT[result.reason] }
  }
}
