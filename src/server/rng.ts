export type Rng = () => number

/** mulberry32 — small, fast, seedable PRNG. Returns values in [0, 1). */
export function createRng(seed: number): Rng {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

export function exponential(rng: Rng, mean: number): number {
  return -mean * Math.log(1 - rng())
}
