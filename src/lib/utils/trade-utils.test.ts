import { describe, expect, it } from 'vitest'
import type { OrderResult } from '@/lib/realtime/protocol'
import { describeOrderResult } from '@/lib/utils/describe-order-result'
import { isAmountInProgress, parseAmount } from '@/lib/utils/parse-amount'

describe('parseAmount', () => {
  it('accepts plain dollar amounts', () => {
    expect(parseAmount('12')).toBe(12)
    expect(parseAmount('12.5')).toBe(12.5)
    expect(parseAmount(' 7 ')).toBe(7)
    expect(parseAmount('0.01')).toBe(0.01)
  })

  it.each(['', '0', '0.00', 'abc', '-5', '1e3', '10.123', '12.', '10000000', '1,000'])('rejects %j', (input) => {
    expect(parseAmount(input)).toBe('invalid')
  })
})

describe('isAmountInProgress', () => {
  it('treats a number with a trailing dot as mid-typing', () => {
    expect(isAmountInProgress('12.')).toBe(true)
    expect(isAmountInProgress(' 7. ')).toBe(true)
    expect(parseAmount('12.')).toBe('invalid')
  })

  it.each(['', '.', '12', '12.5', 'abc.', '12..', '-1.', '12345678.'])('is false for %j', (input) => {
    expect(isAmountInProgress(input)).toBe(false)
  })
})

const reject = (reason: Extract<OrderResult, { status: 'rejected' }>['reason']): OrderResult => ({
  status: 'rejected',
  clientOrderId: 'x',
  side: 'yes',
  reason,
  currentPrice: 0.62,
})

describe('describeOrderResult', () => {
  it('describes fills with the side tone', () => {
    expect(
      describeOrderResult({ status: 'filled', clientOrderId: 'x', side: 'no', shares: 20, avgPrice: 0.4, cost: 8, refund: 0 }),
    ).toEqual({ tone: 'no', text: 'Bought 20.00 NO @ 40.0¢' })
  })

  it('explains partial fills with the refund', () => {
    expect(
      describeOrderResult({ status: 'partial', clientOrderId: 'x', side: 'yes', shares: 100, avgPrice: 0.8, cost: 80, refund: 20 }),
    ).toEqual({ tone: 'warn', text: 'Partially filled 100.00 YES @ 80.0¢ — $20.00 refunded at the 85% limit' })
  })

  it('gives every rejection reason a distinct message', () => {
    const reasons = ['slippage', 'round_closed', 'insufficient_balance', 'invalid', 'price_limit'] as const
    const texts = reasons.map((r) => describeOrderResult(reject(r)).text)
    expect(new Set(texts).size).toBe(reasons.length)
    expect(describeOrderResult(reject('slippage'))).toEqual({
      tone: 'warn',
      text: 'YES price moved to 62.0¢ before your order filled — not executed',
    })
    expect(describeOrderResult(reject('round_closed')).text).toBe('Round closed before your order arrived')
  })
})
