import type { OrderResult, RejectReason } from '@/lib/realtime/protocol'
import { PRICE_BOUND } from '@/config/market'
import { formatCents, formatPercent, formatShares, formatUsd } from '@/lib/utils/format'
import { SIDE_LABEL } from '@/lib/utils/side-label'

export type OrderMessage = { tone: 'yes' | 'no' | 'warn'; text: string }

const LIMIT_TEXT = `Price is at the ${formatPercent(PRICE_BOUND)} limit — no shares available`

const REJECTION_TEXT: Record<Exclude<RejectReason, 'slippage'>, string> = {
  round_closed: 'Round closed before your order arrived',
  insufficient_balance: 'Insufficient balance',
  invalid: 'Invalid order',
  price_limit: LIMIT_TEXT,
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
        text: `Partially filled ${formatShares(result.shares)} ${SIDE_LABEL[result.side]} @ ${formatCents(result.avgPrice)} — ${formatUsd(result.refund)} refunded at the ${formatPercent(PRICE_BOUND)} limit`,
      }
    case 'rejected':
      if (result.reason === 'slippage') {
        return {
          tone: 'warn',
          text: `${SIDE_LABEL[result.side]} price moved to ${formatCents(result.currentPrice)} before your order filled — not executed`,
        }
      }
      return { tone: 'warn', text: REJECTION_TEXT[result.reason] }
  }
}
