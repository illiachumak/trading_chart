import type { OrderStatus } from '@/lib/realtime/account-store'
import type { OrderResult, QuoteResult, RejectReason } from '@/lib/realtime/protocol'
import { PRICE_BOUND } from '@/config/market'
import { formatCents, formatPercent, formatShares, formatUsd, PLACEHOLDER } from '@/lib/utils/format'
import { SIDE_LABEL } from '@/lib/utils/side'

export type OrderMessage = { tone: 'yes' | 'no' | 'warn'; text: string }

export const PRICE_LIMIT_TEXT = `Price is at the ${formatPercent(PRICE_BOUND)} limit — no shares available`

const REJECTION_TEXT: Record<Exclude<RejectReason, 'slippage'>, string> = {
  round_closed: 'Round closed before your order arrived',
  insufficient_balance: 'Insufficient balance',
  invalid: 'Invalid order',
  price_limit: PRICE_LIMIT_TEXT,
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
          text: `${SIDE_LABEL[result.side]} price moved to ${formatCents(result.currentPrice)} before your order filled — not executed. Try a higher max slippage.`,
        }
      }
      return { tone: 'warn', text: REJECTION_TEXT[result.reason] }
  }
}

/** Worst-case line for a quote; every number comes from the server quote, this only formats. */
export function describeQuoteProtection(quote: Extract<QuoteResult, { status: 'ok' }> | 'none'): string {
  const pay = quote === 'none' ? PLACEHOLDER : formatUsd(quote.cost)
  const shares = quote === 'none' ? PLACEHOLDER : formatShares(quote.minShares)
  const worst = quote === 'none' ? PLACEHOLDER : formatCents(quote.worstAvgPrice)
  return `You pay ${pay} · at least ${shares} shares · worst avg ${worst}`
}

/**
 * Price a retry would be placed at: the latest fillable quote's average, offered only while the
 * last order's result is a slippage rejection. 'none' hides the retry.
 */
export function retryPriceFor(order: OrderStatus, quote: QuoteResult | 'none'): number | 'none' {
  if (order.kind !== 'done' || order.result.status !== 'rejected' || order.result.reason !== 'slippage') return 'none'
  if (quote === 'none' || quote.status !== 'ok') return 'none'
  return quote.avgPrice
}

export function describeRetry(price: number): { label: string; ariaLabel: string } {
  const cents = (price * 100).toFixed(1)
  return { label: `Retry at ${formatCents(price)}`, ariaLabel: `Retry order at ${cents} cents` }
}
