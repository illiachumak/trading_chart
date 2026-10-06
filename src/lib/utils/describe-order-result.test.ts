import { describe, expect, it } from 'vitest'
import type { OrderStatus } from '@/lib/realtime/account-store'
import type { OrderResult, QuoteResult } from '@/lib/realtime/protocol'
import {
  describeQuoteProtection,
  describeRetry,
  retryPriceFor,
} from '@/lib/utils/describe-order-result'

const OK_QUOTE: QuoteResult = {
  status: 'ok',
  requestId: 4,
  side: 'yes',
  amountUsd: 10,
  shares: 19.5,
  avgPrice: 0.5128,
  cost: 10,
  potentialPayout: 19.5,
  potentialProfit: 9.5,
  clipped: false,
  maxSlippage: 0.03,
  worstAvgPrice: 0.5428,
  minShares: 10 / 0.5428,
}

const SLIPPAGE_REJECT: OrderResult = {
  status: 'rejected',
  clientOrderId: 'a',
  side: 'yes',
  reason: 'slippage',
  currentPrice: 0.561,
}

describe('describeQuoteProtection', () => {
  it('states the spend, the minimum shares and the worst average price from the server quote', () => {
    expect(describeQuoteProtection(OK_QUOTE)).toBe('You pay $10.00 · at least 18.42 shares · worst avg 54.3¢')
  })

  it('drops the share guarantee for a clipped quote, which may fill even less at the bound', () => {
    const clipped: QuoteResult = { ...OK_QUOTE, amountUsd: 5_000, cost: 1_234.5, clipped: true, minShares: 2_000 }
    expect(describeQuoteProtection(clipped)).toBe('You pay $1,234.50 · near price limit — may partially fill · worst avg 54.3¢')
  })

  it('drops the share guarantee when the worst average is capped at the price bound', () => {
    const atBound: QuoteResult = { ...OK_QUOTE, avgPrice: 0.83, worstAvgPrice: 0.85, minShares: 10 / 0.85 }
    expect(describeQuoteProtection(atBound)).toBe('You pay $10.00 · near price limit — may partially fill · worst avg 85.0¢')
  })

  it('never overstates the guarantee when rounding', () => {
    const quote: QuoteResult = { ...OK_QUOTE, worstAvgPrice: 0.54211, minShares: 12.349 }
    expect(describeQuoteProtection(quote)).toBe('You pay $10.00 · at least 12.34 shares · worst avg 54.3¢')
  })

  it('uses placeholders until a quote arrives', () => {
    expect(describeQuoteProtection('none')).toBe('You pay — · at least — shares · worst avg —')
  })
})

describe('retryPriceFor', () => {
  const done = (result: OrderResult): OrderStatus => ({ kind: 'done', result })

  it('offers the latest quote price after a slippage rejection', () => {
    expect(retryPriceFor(done(SLIPPAGE_REJECT), OK_QUOTE)).toBe(0.5128)
  })

  it('offers nothing without a fillable quote', () => {
    expect(retryPriceFor(done(SLIPPAGE_REJECT), 'none')).toBe('none')
    const unavailable: QuoteResult = { status: 'unavailable', requestId: 5, side: 'yes', amountUsd: 10, maxSlippage: 0.03 }
    expect(retryPriceFor(done(SLIPPAGE_REJECT), unavailable)).toBe('none')
  })

  it('offers nothing for other outcomes or while an order is idle or pending', () => {
    expect(retryPriceFor({ kind: 'idle' }, OK_QUOTE)).toBe('none')
    expect(retryPriceFor({ kind: 'pending', clientOrderId: 'b' }, OK_QUOTE)).toBe('none')
    expect(retryPriceFor(done({ ...SLIPPAGE_REJECT, reason: 'insufficient_balance' }), OK_QUOTE)).toBe('none')
    const filled: OrderResult = {
      status: 'filled',
      clientOrderId: 'a',
      side: 'yes',
      shares: 10,
      avgPrice: 0.5,
      cost: 5,
      refund: 0,
    }
    expect(retryPriceFor(done(filled), OK_QUOTE)).toBe('none')
  })
})

describe('describeRetry', () => {
  it('labels the button and its accessible name with the retry price', () => {
    expect(describeRetry(0.5128)).toEqual({ label: 'Retry at 51.3¢', ariaLabel: 'Retry order at 51.3 cents' })
  })
})
