/**
 * The bench only runs in dev and the profiling build: in the normal production build `?bench=` is ignored and
 * the harness never starts. It does NOT fully tree-shake out — module-level scenario tables (phase lists,
 * seeds) still ship in the production bundle as dead data; only code behind `BENCH_AVAILABLE` is dropped.
 */
export const BENCH_AVAILABLE = import.meta.env.DEV || import.meta.env.MODE === 'profiling'
