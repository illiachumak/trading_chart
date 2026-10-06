import { describe, expect, it } from 'vitest'
import { isMainToWorker, isWorkerToMain } from '@/lib/realtime/bridge'
import { parseClientMessage, parseServerMessage } from '@/lib/realtime/protocol'

describe('parseServerMessage', () => {
  it('accepts a known message with seq and ts', () => {
    const raw = JSON.stringify({ type: 'heartbeat', ts: 5, seq: 1 })
    expect(parseServerMessage(raw)).toEqual({ type: 'heartbeat', ts: 5, seq: 1 })
  })

  it('rejects unknown types, missing seq and broken JSON', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'nope', ts: 1, seq: 1 }))).toBe('invalid')
    expect(parseServerMessage(JSON.stringify({ type: 'heartbeat', ts: 1 }))).toBe('invalid')
    expect(parseServerMessage('{oops')).toBe('invalid')
  })
})

describe('parseClientMessage', () => {
  it('accepts known client messages', () => {
    const raw = JSON.stringify({ type: 'resync', fromSeq: 3 })
    expect(parseClientMessage(raw)).toEqual({ type: 'resync', fromSeq: 3 })
  })

  it('rejects unknown client messages', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'hack' }))).toBe('invalid')
    expect(parseClientMessage('null')).toBe('invalid')
  })

  it('rejects known types with a malformed body', () => {
    const order = {
      type: 'place_order',
      clientOrderId: 'a',
      roundId: 1,
      side: 'yes',
      amountUsd: 10,
      expectedPrice: 0.5,
      maxSlippage: 0.02,
    }
    expect(parseClientMessage(JSON.stringify(order))).toEqual(order)
    expect(parseClientMessage(JSON.stringify({ ...order, clientOrderId: undefined }))).toBe('invalid')
    expect(parseClientMessage(JSON.stringify({ ...order, clientOrderId: '' }))).toBe('invalid')
    expect(parseClientMessage(JSON.stringify({ ...order, side: 'YES' }))).toBe('invalid')
    expect(parseClientMessage(JSON.stringify({ ...order, amountUsd: Number.NaN }))).toBe('invalid')
    expect(parseClientMessage(JSON.stringify({ type: 'quote', requestId: 1, side: 'maybe', amountUsd: 5 }))).toBe(
      'invalid',
    )
    expect(parseClientMessage(JSON.stringify({ type: 'resync' }))).toBe('invalid')
    expect(parseClientMessage(JSON.stringify({ type: 'resync', fromSeq: 1.5 }))).toBe('invalid')
    expect(parseClientMessage(JSON.stringify({ type: 'dev' }))).toBe('invalid')
    expect(parseClientMessage(JSON.stringify({ type: 'dev', command: { kind: 'set_latency' } }))).toBe('invalid')
    expect(parseClientMessage(JSON.stringify({ type: 'dev', command: { kind: 'set_batch_interval' } }))).toBe('invalid')
    expect(parseClientMessage(JSON.stringify({ type: 'dev', command: { kind: 'set_batch_interval', ms: '33' } }))).toBe(
      'invalid',
    )
    expect(parseClientMessage(JSON.stringify({ type: 'dev', command: { kind: 'set_batch_interval', ms: 33 } }))).toEqual({
      type: 'dev',
      command: { kind: 'set_batch_interval', ms: 33 },
    })
    expect(parseClientMessage(JSON.stringify({ type: 'dev', command: { kind: 'force_disconnect' } }))).toEqual({
      type: 'dev',
      command: { kind: 'force_disconnect' },
    })
  })
})

describe('bridge guards', () => {
  it('validates main→worker envelopes', () => {
    expect(isMainToWorker({ kind: 'connect', connId: 1 })).toBe(true)
    expect(isMainToWorker({ kind: 'data', connId: 1, data: '{}' })).toBe(true)
    expect(isMainToWorker({ kind: 'data', connId: 1 })).toBe(false)
    expect(isMainToWorker({ kind: 'open', connId: 1 })).toBe(false)
  })

  it('validates worker→main envelopes', () => {
    expect(isWorkerToMain({ kind: 'open', connId: 2 })).toBe(true)
    expect(isWorkerToMain({ kind: 'closed', connId: 2 })).toBe(true)
    expect(isWorkerToMain({ kind: 'data', connId: 2, data: 'x' })).toBe(true)
    expect(isWorkerToMain({ kind: 'connect', connId: 2 })).toBe(false)
  })
})
