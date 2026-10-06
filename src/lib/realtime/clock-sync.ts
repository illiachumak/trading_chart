/**
 * Estimates `serverTime - clientTime`. Each sample is (serverTs - receivedAt) = offset - latency,
 * so the max over a window is the best estimate (lowest-latency sample).
 */
export class ClockSync {
  private readonly windowSize: number
  private samples: number[] = []

  constructor(windowSize: number) {
    this.windowSize = windowSize
  }

  observe(serverTs: number, receivedAt: number): void {
    this.samples.push(serverTs - receivedAt)
    if (this.samples.length > this.windowSize) this.samples.shift()
  }

  get offsetMs(): number {
    return this.samples.length === 0 ? 0 : Math.max(...this.samples)
  }
}
