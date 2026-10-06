import { describe, expect, it } from 'vitest'
import { ChartFeeder, type ChartSink, type FlushStats } from '@/lib/realtime/chart-feeder'
import type { ChartPoint, ServerMessage, Trade } from '@/lib/realtime/protocol'
import { TickBuffer } from '@/lib/realtime/tick-buffer'

const trade = (id: number, ts: number, priceAfter: number): Trade => ({
  id,
  ts,
  side: 'yes',
  shares: 1,
  priceAfter,
  source: 'mock',
})

const tradesMessage = (seq: number, items: Trade[]): ServerMessage => ({ type: 'trades', seq, ts: 0, items, aggregated: 'none' })

const snapshotMessage = (seq: number, history: ChartPoint[]): ServerMessage => ({
  type: 'snapshot',
  seq,
  ts: 0,
  round: { id: 1, startTs: 0, endTs: 60_000 },
  price: 0.5,
  history,
  recentTrades: [],
  userTrades: [],
  account: {
    balance: 1_000,
    roundId: 1,
    position: { yesShares: 0, noShares: 0, spent: 0, payoutIfYes: 0, payoutIfNo: 0 },
    history: [],
  },
})

type SinkCall = { kind: 'update'; point: ChartPoint } | { kind: 'setData'; points: ChartPoint[] }

function setup(backlogThreshold = 30) {
  const calls: SinkCall[] = []
  const sink: ChartSink = {
    update: (point) => calls.push({ kind: 'update', point }),
    setData: (points) => calls.push({ kind: 'setData', points: [...points] }),
  }
  let nextHandle = 0
  const frames = new Map<number, () => void>()
  const stats: FlushStats[] = []
  const feeder = new ChartFeeder(sink, {
    scheduler: {
      request: (callback) => {
        const handle = ++nextHandle
        frames.set(handle, callback)
        return () => {
          frames.delete(handle)
        }
      },
    },
    perfNow: () => 0,
    serverNow: () => 10_000,
    backlogThreshold,
    onFlush: (s) => stats.push(s),
  })
  const runFrame = () => {
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) callback()
  }
  return { feeder, calls, stats, frames, runFrame }
}

describe('TickBuffer', () => {
  it('keeps only the last tick per second', () => {
    const buffer = new TickBuffer()
    buffer.push([trade(1, 1_000, 0.5), trade(2, 1_400, 0.52), trade(3, 1_999, 0.51)])
    buffer.push([trade(4, 2_050, 0.55)])
    expect(buffer.size).toBe(4)
    expect(buffer.drain()).toEqual({
      points: [
        { time: 1, value: 0.51 },
        { time: 2, value: 0.55 },
      ],
      ticks: 4,
      newestTs: 2_050,
    })
    expect(buffer.drain()).toEqual({ points: [], ticks: 0, newestTs: 0 })
  })
})

describe('ChartFeeder', () => {
  it('replaces the series on snapshot immediately', () => {
    const { feeder, calls } = setup()
    feeder.handle(snapshotMessage(1, [{ time: 0, value: 0.5 }]))
    expect(calls).toEqual([{ kind: 'setData', points: [{ time: 0, value: 0.5 }] }])
  })

  it('coalesces many batches into one frame and one update per second', () => {
    const { feeder, calls, stats, frames, runFrame } = setup()
    feeder.handle(snapshotMessage(1, [{ time: 0, value: 0.5 }]))
    calls.length = 0
    feeder.handle(tradesMessage(2, [trade(1, 1_100, 0.51), trade(2, 1_200, 0.52)]))
    feeder.handle(tradesMessage(3, [trade(3, 1_300, 0.53), trade(4, 2_100, 0.54)]))
    expect(frames.size).toBe(1)
    expect(calls).toEqual([])
    runFrame()
    expect(calls).toEqual([
      { kind: 'update', point: { time: 1, value: 0.53 } },
      { kind: 'update', point: { time: 2, value: 0.54 } },
    ])
    expect(stats).toEqual([{ mode: 'update', durationMs: 0, ticks: 4, points: 2, latencyMs: 10_000 - 2_100 }])
    expect(feeder.getHistory()).toEqual([
      { time: 0, value: 0.5 },
      { time: 1, value: 0.53 },
      { time: 2, value: 0.54 },
    ])
  })

  it('moves the open second on Y across frames', () => {
    const { feeder, calls, runFrame } = setup()
    feeder.handle(snapshotMessage(1, [{ time: 0, value: 0.5 }]))
    feeder.handle(tradesMessage(2, [trade(1, 1_100, 0.51)]))
    runFrame()
    feeder.handle(tradesMessage(3, [trade(2, 1_600, 0.49)]))
    runFrame()
    expect(calls.slice(1)).toEqual([
      { kind: 'update', point: { time: 1, value: 0.51 } },
      { kind: 'update', point: { time: 1, value: 0.49 } },
    ])
    expect(feeder.getHistory()).toHaveLength(2)
  })

  it('resets on round_started and drops ticks buffered from the previous round', () => {
    const { feeder, calls, frames, runFrame } = setup()
    feeder.handle(snapshotMessage(1, [{ time: 0, value: 0.5 }]))
    feeder.handle(tradesMessage(2, [trade(1, 59_900, 0.6)]))
    feeder.handle({ type: 'round_started', seq: 3, ts: 60_000, round: { id: 2, startTs: 60_000, endTs: 120_000 }, price: 0.5 })
    expect(frames.size).toBe(0)
    runFrame()
    expect(calls.at(-1)).toEqual({ kind: 'setData', points: [{ time: 60, value: 0.5 }] })
    expect(feeder.getHistory()).toEqual([{ time: 60, value: 0.5 }])
  })

  it('ignores points older than the last chart point', () => {
    const { feeder, calls, runFrame } = setup()
    feeder.handle(snapshotMessage(1, [{ time: 100, value: 0.5 }]))
    calls.length = 0
    feeder.handle(tradesMessage(2, [trade(1, 99_500, 0.7), trade(2, 100_200, 0.52)]))
    runFrame()
    expect(calls).toEqual([{ kind: 'update', point: { time: 100, value: 0.52 } }])
  })

  it('turns a large backlog into a single setData', () => {
    const { feeder, calls, stats, runFrame } = setup(3)
    feeder.handle(snapshotMessage(1, [{ time: 0, value: 0.5 }]))
    calls.length = 0
    const items = Array.from({ length: 10 }, (_, i) => trade(i, (i + 1) * 1_000, 0.5 + i / 100))
    feeder.handle(tradesMessage(2, items))
    runFrame()
    expect(calls).toHaveLength(1)
    expect(calls[0].kind).toBe('setData')
    expect(feeder.getHistory()).toHaveLength(11)
    expect(stats[0].mode).toBe('setData')
  })

  it('dispose cancels a pending frame', () => {
    const { feeder, frames } = setup()
    feeder.handle(snapshotMessage(1, [{ time: 0, value: 0.5 }]))
    feeder.handle(tradesMessage(2, [trade(1, 1_000, 0.5)]))
    feeder.dispose()
    expect(frames.size).toBe(0)
  })
})
