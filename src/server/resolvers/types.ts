import type { RoundInfo, Side } from '@/lib/realtime/protocol'

/**
 * Decides a round's outcome. Coinflip today; BTC mode will capture the strike
 * in `onRoundStart` and compare the BTC price in `resolve`.
 */
export type Resolver = {
  onRoundStart(round: RoundInfo): void
  resolve(round: RoundInfo): Side
}
