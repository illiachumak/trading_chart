// Market + transport constants shared by the mock backend (worker) and the client.

export const ROUND_MS = 60_000
export const BATCH_INTERVAL_MS = 100
export const HEARTBEAT_INTERVAL_MS = 1_000

/** LMSR liquidity `b`. ~15 shares at 50% move the price by ~0.1¢. */
export const LMSR_LIQUIDITY = 3_000
/** Max price of either side; the other side is therefore floored at 1 - PRICE_BOUND. */
export const PRICE_BOUND = 0.85

export const START_BALANCE = 1_000
export const DEFAULT_TRADES_PER_SEC = 30
export const MIN_TRADES_PER_SEC = 1
export const MAX_TRADES_PER_SEC = 1_000

export const REPLAY_BUFFER_SIZE = 5_000
export const RECENT_TRADES_LIMIT = 20
export const ROUND_HISTORY_LIMIT = 20

export const MAX_LATENCY_MS = 5_000
export const MAX_DROP_RATE = 0.9
