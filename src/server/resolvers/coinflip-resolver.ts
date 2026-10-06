import type { Resolver } from '@/server/resolvers/types'
import type { Rng } from '@/server/rng'

/** Fair 50/50, independent of the market price. */
export function createCoinflipResolver(rng: Rng): Resolver {
  return {
    onRoundStart() {},
    resolve: () => (rng() < 0.5 ? 'yes' : 'no'),
  }
}
