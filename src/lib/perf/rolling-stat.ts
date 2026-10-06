import { percentileOfSorted } from '@/lib/perf/metrics-math'

/** Fixed-size window of samples with nearest-rank percentiles. */
export class RollingStat {
  private readonly capacity: number
  private values: number[] = []
  private next = 0

  constructor(capacity: number) {
    this.capacity = capacity
  }

  get count(): number {
    return this.values.length
  }

  add(value: number): void {
    if (this.values.length < this.capacity) {
      this.values.push(value)
      return
    }
    this.values[this.next] = value
    this.next = (this.next + 1) % this.capacity
  }

  clear(): void {
    this.values = []
    this.next = 0
  }

  percentile(p: number): number {
    return percentileOfSorted(this.sorted(), p)
  }

  /** Ascending copy of the window (sort once when several percentiles are needed). */
  sorted(): number[] {
    return [...this.values].sort((a, b) => a - b)
  }

  max(): number {
    return this.values.length === 0 ? 0 : Math.max(...this.values)
  }
}
