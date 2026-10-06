import { useCallback, useSyncExternalStore } from 'react'

const TICK_MS = 250

function subscribeTicker(onTick: () => void): () => void {
  const timer = setInterval(onTick, TICK_MS)
  return () => clearInterval(timer)
}

/** Seconds until `endTs` on the clock given by `now`. Re-renders only when the whole second changes. */
export function useCountdown(endTs: number, now: () => number): number {
  const getSnapshot = useCallback(() => Math.max(0, Math.ceil((endTs - now()) / 1_000)), [endTs, now])
  return useSyncExternalStore(subscribeTicker, getSnapshot)
}
