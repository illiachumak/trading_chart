import { useEffect, useState } from 'react'

const TICK_MS = 250

function secondsLeft(endTs: number, offsetMs: number): number {
  return Math.max(0, Math.ceil((endTs - (Date.now() + offsetMs)) / 1_000))
}

/** Seconds until `endTs` on the server clock. Re-renders only when the whole second changes. */
export function useCountdown(endTs: number, offsetMs: number): number {
  const [seconds, setSeconds] = useState(() => secondsLeft(endTs, offsetMs))
  useEffect(() => {
    setSeconds(secondsLeft(endTs, offsetMs))
    const timer = setInterval(() => setSeconds(secondsLeft(endTs, offsetMs)), TICK_MS)
    return () => clearInterval(timer)
  }, [endTs, offsetMs])
  return seconds
}
