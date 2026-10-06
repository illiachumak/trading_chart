import { describe, expect, it } from 'vitest'
import { Outbox } from '@/server/outbox'

function fill(outbox: Outbox, count: number): void {
  for (let i = 0; i < count; i++) outbox.publish({ type: 'heartbeat', ts: i })
}

describe('Outbox', () => {
  it('assigns increasing seq starting at 1', () => {
    const outbox = new Outbox(10)
    expect(outbox.publish({ type: 'heartbeat', ts: 0 }).seq).toBe(1)
    expect(outbox.publish({ type: 'heartbeat', ts: 1 }).seq).toBe(2)
    expect(outbox.lastSeq).toBe(2)
  })

  it('replays exactly the requested tail', () => {
    const outbox = new Outbox(10)
    fill(outbox, 6)
    const replay = outbox.replayFrom(4)
    if (replay === 'snapshot_required') throw new Error('expected replay')
    expect(replay.map((m) => m.seq)).toEqual([4, 5, 6])
    expect(outbox.replayFrom(7)).toEqual([])
  })

  it('requires a snapshot for fresh clients, evicted ranges and clients ahead of the server', () => {
    const outbox = new Outbox(3)
    fill(outbox, 6) // ring holds 4..6
    expect(outbox.replayFrom(1)).toBe('snapshot_required')
    expect(outbox.replayFrom(0)).toBe('snapshot_required')
    expect(outbox.replayFrom(3)).toBe('snapshot_required')
    expect(outbox.replayFrom(9)).toBe('snapshot_required')
    expect(outbox.replayFrom(Number.NaN)).toBe('snapshot_required')
    const replay = outbox.replayFrom(4)
    if (replay === 'snapshot_required') throw new Error('expected replay')
    expect(replay.map((m) => m.seq)).toEqual([4, 5, 6])
  })
})
