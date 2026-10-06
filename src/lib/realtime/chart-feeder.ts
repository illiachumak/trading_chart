// Applies ticks to the chart once per frame. 50 batches in a frame → 1 repaint.
// One point per second: the open second's point moves on Y until the next second starts.

import type { ChartPoint, ServerMessage } from '@/lib/realtime/protocol'
import { TickBuffer } from '@/lib/realtime/tick-buffer'

export type ChartSink = {
  update(point: ChartPoint): void
  setData(points: readonly ChartPoint[]): void
}

/** Returns a cancel function. Browser: requestAnimationFrame. */
export type FrameScheduler = { request(callback: () => void): () => void }

export type FlushStats = {
  mode: 'update' | 'setData'
  durationMs: number
  ticks: number
  points: number
  /** Server time of the newest tick → this flush. */
  latencyMs: number
}

export type ChartFeederOptions = {
  scheduler: FrameScheduler
  perfNow: () => number
  serverNow: () => number
  backlogThreshold: number
  onFlush: (stats: FlushStats) => void
}

export class ChartFeeder {
  private readonly sink: ChartSink
  private readonly options: ChartFeederOptions
  private readonly buffer = new TickBuffer()
  private history: ChartPoint[] = []
  private cancelFrame: (() => void) | 'none' = 'none'

  constructor(sink: ChartSink, options: ChartFeederOptions) {
    this.sink = sink
    this.options = options
  }

  handle(message: ServerMessage): void {
    switch (message.type) {
      case 'snapshot':
        this.reset(message.history)
        return
      case 'round_started':
        this.reset([{ time: Math.floor(message.round.startTs / 1_000), value: message.price }])
        return
      case 'trades':
        this.buffer.push(message.items)
        this.schedule()
        return
      default:
        return
    }
  }

  getHistory(): readonly ChartPoint[] {
    return this.history
  }

  dispose(): void {
    this.cancel()
    this.buffer.clear()
  }

  private reset(points: readonly ChartPoint[]): void {
    this.cancel()
    this.buffer.clear()
    this.history = points.map((p) => ({ time: p.time, value: p.value }))
    this.sink.setData(this.history)
  }

  private schedule(): void {
    if (this.cancelFrame !== 'none') return
    this.cancelFrame = this.options.scheduler.request(() => {
      this.cancelFrame = 'none'
      this.flush()
    })
  }

  private cancel(): void {
    if (this.cancelFrame !== 'none') this.cancelFrame()
    this.cancelFrame = 'none'
  }

  private flush(): void {
    const startedAt = this.options.perfNow()
    const { points, ticks, newestTs } = this.buffer.drain()
    const fresh: ChartPoint[] = []
    for (const point of points) {
      const last = this.history.at(-1)
      if (last !== undefined && point.time < last.time) continue
      if (last !== undefined && point.time === last.time) this.history[this.history.length - 1] = point
      else this.history.push(point)
      fresh.push(point)
    }
    if (fresh.length === 0) return
    const mode = fresh.length > this.options.backlogThreshold ? 'setData' : 'update'
    if (mode === 'setData') this.sink.setData(this.history)
    else for (const point of fresh) this.sink.update(point)
    this.options.onFlush({
      mode,
      durationMs: this.options.perfNow() - startedAt,
      ticks,
      points: fresh.length,
      latencyMs: this.options.serverNow() - newestTs,
    })
  }
}
