import type { ChartPoint, Trade } from '@/lib/realtime/protocol'

export type DrainResult = { points: ChartPoint[]; ticks: number; newestTs: number }

/** Plain array buffer for incoming ticks. Never touches React. */
export class TickBuffer {
  private ticks: Trade[] = []

  get size(): number {
    return this.ticks.length
  }

  push(items: readonly Trade[]): void {
    for (const item of items) this.ticks.push(item)
  }

  /** Empties the buffer and collapses ticks to the last value per second (input is ts-ordered). */
  drain(): DrainResult {
    const ticks = this.ticks
    this.ticks = []
    const points: ChartPoint[] = []
    for (const tick of ticks) {
      const time = Math.floor(tick.ts / 1_000)
      const last = points.at(-1)
      if (last !== undefined && last.time === time) last.value = tick.priceAfter
      else points.push({ time, value: tick.priceAfter })
    }
    return { points, ticks: ticks.length, newestTs: ticks.at(-1)?.ts ?? 0 }
  }

  clear(): void {
    this.ticks = []
  }
}
