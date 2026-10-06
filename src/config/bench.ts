/** The bench only exists in dev and the profiling build, so it tree-shakes out of the normal production bundle. */
export const BENCH_AVAILABLE = import.meta.env.DEV || import.meta.env.MODE === 'profiling'
