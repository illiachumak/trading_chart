import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type BenchDeps,
  type BenchPhase,
  type BenchPhaseResult,
  type BenchTarget,
  type ProbeQuote,
  DEEP_SCENARIO,
  MATRIX_SCENARIO,
  QUICK_SCENARIO,
  readHeapMb,
  runBench,
} from '@/lib/perf/bench'
import { PerfMetrics } from '@/lib/perf/perf-metrics'
import type { ClientStats, ConnectionStatus } from '@/lib/realtime/market-client'
import type { DevCommand, OrderResult, Side } from '@/lib/realtime/protocol'

const QUOTE_PRICE = 0.5
const REPLY_MS = 50

type OrderScript = (index: number, side: Side) => OrderResult | 'timeout'

const fill = (side: Side, avgPrice: number): OrderResult => ({
  status: 'filled',
  clientOrderId: 'x',
  side,
  shares: 10,
  avgPrice,
  cost: 5,
  refund: 0,
})

const defaultScript: OrderScript = (_index, side) => fill(side, QUOTE_PRICE + 0.02)

/** A fake backend on vitest fake timers: counters grow with (fake) time at the configured rate and batch. */
function fakeBench(options: { script?: OrderScript; isCancelled?: () => boolean; roundAt?: (ms: number) => number } = {}) {
  const roundAt = options.roundAt ?? (() => 1)
  const startedAt = Date.now()
  const currentRound = (): number => roundAt(Date.now() - startedAt)
  const script = options.script ?? defaultScript
  const commands: DevCommand[] = []
  const windows: { phase: string; edge: 'start' | 'end'; at: number }[] = []
  const quotes: { side: Side; at: number }[] = []
  const orders: { side: Side; expectedPrice: number; maxSlippage: number; roundId: number; at: number }[] = []
  const stats: ClientStats = { messages: 0, trades: 0, gaps: 0, resyncs: 0, duplicates: 0, reconnects: 0 }
  let rate = 30
  let batchMs = 100
  let integratedAt = Date.now()
  let status: ConnectionStatus = 'live'

  const integrate = (): void => {
    const now = Date.now()
    const seconds = (now - integratedAt) / 1_000
    stats.trades += rate * seconds
    stats.messages += (1_000 / batchMs) * seconds
    integratedAt = now
  }

  const metrics = new PerfMetrics(1_000)
  // 10 chart commits per second, independent of the bench.
  const commitTimer = setInterval(() => metrics.recordCommit('chart'), 100)

  const target: BenchTarget = {
    sendDev: (command) => {
      integrate()
      commands.push(command)
      if (command.kind === 'set_rate') rate = command.tradesPerSec
      if (command.kind === 'set_batch_interval') batchMs = command.ms
      if (command.kind === 'force_disconnect') stats.reconnects++
    },
    stats: () => {
      integrate()
      return stats
    },
    status: () => status,
    roundId: currentRound,
    quote: (side, amountUsd) => {
      const roundId = currentRound()
      return new Promise<ProbeQuote | 'timeout'>((resolve) =>
        setTimeout(() => {
          quotes.push({ side, at: Date.now() })
          resolve({
            roundId,
            quote: {
              status: 'ok',
              requestId: quotes.length,
              side,
              amountUsd,
              shares: amountUsd / QUOTE_PRICE,
              avgPrice: QUOTE_PRICE,
              cost: amountUsd,
              potentialPayout: amountUsd / QUOTE_PRICE,
              potentialProfit: amountUsd,
              clipped: false,
            },
          })
        }, REPLY_MS),
      )
    },
    placeOrder: (request) => {
      const index = orders.length
      orders.push({ side: request.side, expectedPrice: request.expectedPrice, maxSlippage: request.maxSlippage, roundId: request.roundId, at: Date.now() })
      return new Promise((resolve) => setTimeout(() => resolve(script(index, request.side)), REPLY_MS))
    },
  }

  const deps: BenchDeps = {
    target,
    metrics,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    wallNow: () => Date.now() + 5_000_000,
    heapMb: () => 42,
    isCancelled: options.isCancelled ?? (() => false),
    onPhase: () => {},
    onWindow: (p, edge) => windows.push({ phase: p.name, edge, at: Date.now() }),
  }

  return {
    deps,
    commands,
    windows,
    quotes,
    orders,
    setStatus: (next: ConnectionStatus) => {
      status = next
    },
    dispose: () => clearInterval(commitTimer),
  }
}

async function run(
  scenario: readonly BenchPhase[],
  fake: ReturnType<typeof fakeBench>,
  warmupMs = 1_000,
): Promise<BenchPhaseResult[] | 'cancelled'> {
  const promise = runBench({ phases: scenario, warmupMs }, fake.deps)
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  fake.dispose()
  return promise
}

async function runOk(scenario: readonly BenchPhase[], fake: ReturnType<typeof fakeBench>): Promise<BenchPhaseResult[]> {
  const results = await run(scenario, fake)
  if (results === 'cancelled') throw new Error('unexpected cancel')
  return results
}

const BASE: BenchPhase = {
  name: 'base',
  group: 'load',
  tradesPerSec: 100,
  batchMs: 100,
  durationMs: 10_000,
  disconnects: 0,
  latencyMs: 0,
  dropRate: 0,
  probe: 'off',
}

const PROBE = { slippage: 0.03, amountUsd: 5, everyMs: 1_000, quoteAgeMs: 0 } as const

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('runBench', () => {
  it('sends phase settings in order, resets latency/drop after the phase and restores defaults at the end', async () => {
    const fake = fakeBench()
    await runOk([{ ...BASE, name: 'faulty', group: 'faults', batchMs: 33, latencyMs: 200, dropRate: 0.1 }], fake)
    expect(fake.commands).toEqual([
      { kind: 'set_rate', tradesPerSec: 100 },
      { kind: 'set_batch_interval', ms: 33 },
      { kind: 'set_latency', ms: 200 },
      { kind: 'set_drop_rate', rate: 0.1 },
      { kind: 'set_latency', ms: 0 },
      { kind: 'set_drop_rate', rate: 0 },
      { kind: 'set_rate', tradesPerSec: 30 },
      { kind: 'set_batch_interval', ms: 100 },
      { kind: 'set_latency', ms: 0 },
      { kind: 'set_drop_rate', rate: 0 },
    ])
  })

  it('computes rates over the measured window only (warm-up excluded)', async () => {
    const fake = fakeBench()
    const [result] = await runOk([{ ...BASE, batchMs: 50 }], fake)
    expect(result.durationSec).toBe(10)
    expect(result.receivedTradesPerSec).toBe(100)
    expect(result.receivedMessagesPerSec).toBe(20)
    expect(result.commitsPerSec).toEqual({ chart: 10 })
    expect(result.commitsPerSecTotal).toBe(10)
    expect(result.group).toBe('load')
    expect(result.batchMs).toBe(50)
    expect(result.heapMb).toBe(42)
    expect(result.probe).toBe('off')
    expect(fake.quotes).toHaveLength(0)
  })

  it('spreads disconnects across the phase and reports reconnects', async () => {
    const fake = fakeBench()
    const [result] = await runOk([{ ...BASE, disconnects: 3, group: 'faults' }], fake)
    expect(fake.commands.filter((c) => c.kind === 'force_disconnect')).toHaveLength(3)
    expect(result.reconnects).toBe(3)
    expect(result.endedLive).toBe(true)
  })

  it('reports endedLive=false when the connection never recovers', async () => {
    const fake = fakeBench()
    fake.setStatus('reconnecting')
    const [result] = await runOk([BASE], fake)
    expect(result.endedLive).toBe(false)
  })

  it('probe alternates sides, counts fills and rejects and measures realized slippage in cents', async () => {
    // Every third order is rejected for slippage, the others fill 2¢ worse than quoted.
    const fake = fakeBench({
      script: (index, side) =>
        index % 3 === 2
          ? { status: 'rejected', clientOrderId: 'x', side, reason: 'slippage', currentPrice: 0.6 }
          : fill(side, QUOTE_PRICE + 0.02),
    })
    const [result] = await runOk([{ ...BASE, group: 'slippage', durationMs: 6_000, probe: PROBE }], fake)
    if (result.probe === 'off') throw new Error('probe expected')
    expect(result.probe.orders).toBe(6)
    expect(result.probe.filled).toBe(4)
    expect(result.probe.rejected).toEqual({
      slippage: 2,
      round_closed: 0,
      insufficient_balance: 0,
      invalid: 0,
      price_limit: 0,
    })
    expect(result.probe.timeouts).toBe(0)
    expect(result.probe.n).toBe(6)
    expect(result.probe.fillRate).toBeCloseTo(4 / 6)
    expect(result.probe.realizedSlippageCents).toEqual({ p50: 2, p95: 2, max: 2 })
    expect(fake.orders.map((o) => o.side)).toEqual(['yes', 'no', 'yes', 'no', 'yes', 'no'])
    expect(fake.orders.every((o) => o.expectedPrice === QUOTE_PRICE && o.maxSlippage === 0.03)).toBe(true)
    expect(result.probeConfig).toEqual(PROBE)
  })

  it('fill rate counts only fills vs slippage rejects; other outcomes are reported separately', async () => {
    const fake = fakeBench({
      script: (index, side) => {
        if (index === 0) return { status: 'rejected', clientOrderId: 'x', side, reason: 'round_closed', currentPrice: 0.5 }
        if (index === 1) return { status: 'rejected', clientOrderId: 'x', side, reason: 'slippage', currentPrice: 0.6 }
        if (index === 2) return 'timeout'
        return fill(side, QUOTE_PRICE)
      },
    })
    const [result] = await runOk([{ ...BASE, group: 'slippage', durationMs: 5_000, probe: PROBE }], fake)
    if (result.probe === 'off') throw new Error('probe expected')
    expect(result.probe.orders).toBe(5)
    expect(result.probe.filled).toBe(2)
    expect(result.probe.rejected.round_closed).toBe(1)
    expect(result.probe.rejected.slippage).toBe(1)
    expect(result.probe.timeouts).toBe(1)
    expect(result.probe.n).toBe(3)
    expect(result.probe.fillRate).toBeCloseTo(2 / 3)
  })

  it('fill rate is 0 when nothing filled or slipped', async () => {
    const fake = fakeBench({
      script: (_index, side) => ({ status: 'rejected', clientOrderId: 'x', side, reason: 'round_closed', currentPrice: 0.5 }),
    })
    const [result] = await runOk([{ ...BASE, group: 'slippage', durationMs: 2_000, probe: PROBE }], fake)
    if (result.probe === 'off') throw new Error('probe expected')
    expect(result.probe.n).toBe(0)
    expect(result.probe.fillRate).toBe(0)
  })

  it('marks exactly the measured window and reports its timestamps', async () => {
    const fake = fakeBench()
    const t0 = Date.now()
    const [first, second] = await runOk([BASE, { ...BASE, name: 'second', durationMs: 4_000 }], fake)
    expect(fake.windows).toEqual([
      { phase: 'base', edge: 'start', at: t0 + 1_000 },
      { phase: 'base', edge: 'end', at: t0 + 11_000 },
      { phase: 'second', edge: 'start', at: t0 + 12_000 },
      { phase: 'second', edge: 'end', at: t0 + 16_000 },
    ])
    expect([first.windowStartMs, first.windowEndMs]).toEqual([t0 + 1_000, t0 + 11_000])
    expect(first.wallClockStartMs).toBe(t0 + 1_000 + 5_000_000)
    expect(second.windowEndMs - second.windowStartMs).toBe(4_000)
  })

  it('reports the longest long task of the measured window only', async () => {
    const fake = fakeBench()
    const t0 = Date.now()
    // 500 ms during warm-up (excluded), 40 and 70 ms inside the window.
    setTimeout(() => fake.deps.metrics.recordLongTask(500), 500)
    setTimeout(() => fake.deps.metrics.recordLongTask(40), 3_000)
    setTimeout(() => fake.deps.metrics.recordLongTask(70), 6_000)
    const [result] = await runOk([BASE], fake)
    expect(Date.now()).toBeGreaterThan(t0)
    expect(result.longTasks).toBe(2)
    expect(result.longTaskMaxMs).toBe(70)
  })

  it('probe waits quoteAgeMs between the quote and the order', async () => {
    const fake = fakeBench()
    await runOk([{ ...BASE, group: 'slippage', durationMs: 4_000, probe: { ...PROBE, quoteAgeMs: 1_000 } }], fake)
    expect(fake.orders.length).toBeGreaterThan(0)
    fake.orders.forEach((order, i) => expect(order.at - fake.quotes[i].at).toBe(1_000))
  })

  it('probe counts order timeouts separately from rejects', async () => {
    const fake = fakeBench({ script: () => 'timeout' })
    const [result] = await runOk([{ ...BASE, group: 'slippage', durationMs: 3_000, probe: PROBE }], fake)
    if (result.probe === 'off') throw new Error('probe expected')
    expect(result.probe.timeouts).toBe(result.probe.orders)
    expect(result.probe.filled).toBe(0)
    expect(result.probe.realizedSlippageCents).toEqual({ p50: 0, p95: 0, max: 0 })
  })

  it('stops when cancelled and sends no further commands', async () => {
    let cancelled = false
    const fake = fakeBench({ isCancelled: () => cancelled })
    fake.deps.onPhase = () => {
      setTimeout(() => {
        cancelled = true
      }, 500)
    }
    const results = await run([{ ...BASE, probe: PROBE }, BASE], fake)
    expect(results).toBe('cancelled')
    expect(fake.commands.map((c) => c.kind)).toEqual([
      'set_rate', 'set_batch_interval', 'set_latency', 'set_drop_rate', 'set_balance',
      // finally: restore server defaults
      'set_rate', 'set_batch_interval', 'set_latency', 'set_drop_rate',
    ])
    expect(fake.commands.slice(-4)).toEqual([
      { kind: 'set_rate', tradesPerSec: 30 },
      { kind: 'set_batch_interval', ms: 100 },
      { kind: 'set_latency', ms: 0 },
      { kind: 'set_drop_rate', rate: 0 },
    ])
    expect(fake.orders).toHaveLength(0)
  })

  it('restores defaults even when a phase throws', async () => {
    const fake = fakeBench()
    fake.deps.onPhase = () => {
      throw new Error('boom')
    }
    const promise = runBench({ phases: [BASE], warmupMs: 1_000 }, fake.deps)
    const settled = promise.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(1_000)
    fake.dispose()
    expect(await settled).toBeInstanceOf(Error)
    expect(fake.commands.at(-1)).toEqual({ kind: 'set_drop_rate', rate: 0 })
    expect(fake.commands.filter((c) => c.kind === 'set_rate')).toEqual([{ kind: 'set_rate', tradesPerSec: 30 }])
  })

  it('skips the order (counts skipped) when the round changed after the quote', async () => {
    // Warm-up 1 s, then quotes at t=1 s/2 s/3 s that order 0.55 s later. The round flips at t=2.3 s,
    // so the t=2 s quote (round 1) would be ordered in round 2 and must be skipped.
    const fake = fakeBench({ roundAt: (ms) => (ms < 2_300 ? 1 : 2) })
    const [result] = await runOk(
      [{ ...BASE, group: 'slippage', durationMs: 3_000, probe: { ...PROBE, quoteAgeMs: 500 } }],
      fake,
    )
    if (result.probe === 'off') throw new Error('probe expected')
    expect(result.probe.skipped).toBe(1)
    expect(result.probe.orders).toBe(2)
    expect(fake.orders.map((o) => o.roundId)).toEqual([1, 2])
  })
})

describe('scenarios', () => {
  it('matrix follows the experiment design', () => {
    const byGroup = (group: BenchPhase['group']) => MATRIX_SCENARIO.phases.filter((p) => p.group === group)
    expect(byGroup('load').map((p) => p.tradesPerSec)).toEqual([5, 30, 100, 300, 500, 1_000])
    expect(byGroup('load').every((p) => p.batchMs === 100 && p.probe === 'off')).toBe(true)
    expect(byGroup('batch').map((p) => [p.tradesPerSec, p.batchMs])).toEqual([
      [100, 16], [100, 33], [100, 50], [100, 100], [100, 250],
      [500, 16], [500, 33], [500, 50], [500, 100], [500, 250],
    ])
    const slippage = byGroup('slippage')
    expect(slippage).toHaveLength(16)
    expect(
      slippage.map((p) => (p.probe === 'off' ? 'off' : [p.tradesPerSec, p.probe.slippage, p.probe.quoteAgeMs])),
    ).toEqual(
      [100, 500].flatMap((rate) =>
        [0.01, 0.03, 0.05, 0.1].flatMap((slip) => [[rate, slip, 0], [rate, slip, 1_000]]),
      ),
    )
    expect(slippage.every((p) => p.batchMs === 100 && p.probe !== 'off' && p.probe.amountUsd === 5 && p.probe.everyMs === 1_000)).toBe(true)
    expect(byGroup('faults').map((p) => [p.tradesPerSec, p.disconnects, p.dropRate, p.latencyMs])).toEqual([
      [100, 3, 0, 0],
      [100, 0, 0.1, 200],
    ])
    expect(MATRIX_SCENARIO.phases).toHaveLength(34)
    expect(MATRIX_SCENARIO.phases.every((p) => p.durationMs === 12_000)).toBe(true)
    expect(new Set(MATRIX_SCENARIO.phases.map((p) => p.name)).size).toBe(34)
  })

  it('quick has the same phases at 4 s', () => {
    expect(QUICK_SCENARIO.phases.map((p) => ({ ...p, durationMs: 12_000 }))).toEqual(MATRIX_SCENARIO.phases)
    expect(QUICK_SCENARIO.phases.every((p) => p.durationMs === 4_000)).toBe(true)
  })
})

describe('readHeapMb', () => {
  it('returns n/a when performance.memory is unavailable', () => {
    expect(readHeapMb({})).toBe('n/a')
    expect(readHeapMb({ memory: { usedJSHeapSize: 'x' } })).toBe('n/a')
  })

  it('converts usedJSHeapSize to MB', () => {
    expect(readHeapMb({ memory: { usedJSHeapSize: 52_428_800 } })).toBe(50)
  })
})

describe('set_balance and deep scenario', () => {
  it('sends set_balance 1000 at the start of probe phases only', async () => {
    const fake = fakeBench()
    await runOk([{ ...BASE, durationMs: 2_000 }, { ...BASE, name: 'probed', group: 'slippage', durationMs: 2_000, probe: PROBE }], fake)
    const balances = fake.commands.flatMap((c, i) => (c.kind === 'set_balance' ? [{ i, usd: c.usd }] : []))
    expect(balances).toHaveLength(1)
    expect(balances[0].usd).toBe(1_000)
    expect(fake.commands.slice(balances[0].i - 4, balances[0].i).map((c) => c.kind)).toEqual([
      'set_rate',
      'set_batch_interval',
      'set_latency',
      'set_drop_rate',
    ])
  })

  it('defines the deep scenario shape', () => {
    const slip = DEEP_SCENARIO.phases.filter((p) => p.group === 'slippage')
    const batch = DEEP_SCENARIO.phases.filter((p) => p.group === 'batch')
    expect(slip).toHaveLength(36)
    expect(batch.map((p) => p.batchMs)).toEqual([16, 33, 50, 100, 250])
    expect(slip.every((p) => p.durationMs === 20_000 && p.batchMs === 100 && p.probe !== 'off' && p.probe.everyMs === 300)).toBe(true)
    expect(batch.every((p) => p.durationMs === 15_000 && p.tradesPerSec === 500 && p.probe === 'off')).toBe(true)
    expect(slip[0].name).toBe('slip 1¢ age 0ms @100/s')
    expect(slip.some((p) => p.name === 'slip 3¢ age 250ms @500/s')).toBe(true)
  })
})
