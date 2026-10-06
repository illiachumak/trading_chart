// Market + transport constants shared by the mock backend (worker) and the client.

export const ROUND_MS = 60_000
export const BATCH_INTERVAL_MS = 100
export const MIN_BATCH_INTERVAL_MS = 16
export const MAX_BATCH_INTERVAL_MS = 1_000
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
/** Idempotency window: how many recent `clientOrderId` results the server remembers. */
export const ORDER_RESULT_CACHE_SIZE = 1_000

export const MAX_LATENCY_MS = 5_000
export const MAX_DROP_RATE = 0.9

// Client
/** CLAUDE.md §3: tick-driven UI updates a few times per second at most. */
export const UI_THROTTLE_MS = 250
export const CHART_BACKLOG_THRESHOLD = 30
export const RECONNECT_BASE_MS = 250
export const RECONNECT_MAX_MS = 5_000
export const RESYNC_TIMEOUT_MS = 1_000
/** Out-of-order backlog cap while waiting for a resync; beyond it the client asks for a snapshot. */
export const MAX_PENDING_MESSAGES = 5_000
export const CLOCK_SYNC_WINDOW = 20
export const PERF_SAMPLE_CAPACITY = 4_000

// UI
export const QUOTE_DEBOUNCE_MS = 150
export const QUOTE_REFRESH_MS = 1_000
/** Absolute slippage tolerance in price units (0.03 = 3¢). */
export const DEFAULT_MAX_SLIPPAGE = 0.03
export const MAX_SLIPPAGE = 0.1
export const SLIPPAGE_OPTIONS = [0.03, 0.05, 0.1] as const
export const BATCH_INTERVAL_OPTIONS = [16, 33, 50, 100, 250] as const
export const STRESS_TRADES_PER_SEC = 500
export const HUD_REFRESH_MS = 500
/** Dev panel slider ranges — narrower than the server limits (MAX_LATENCY_MS, MAX_DROP_RATE) for usable steps. */
export const DEV_RATE_RANGE = { min: 5, max: 100, step: 5 } as const
export const DEV_LATENCY_RANGE = { min: 0, max: 1_000, step: 50 } as const
export const DEV_DROP_PCT_RANGE = { min: 0, max: 50, step: 5 } as const
