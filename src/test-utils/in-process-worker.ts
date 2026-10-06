// Test-only: runs MockServer in-process behind a Worker-shaped object.
// Messages cross with structuredClone + queueMicrotask, like a real worker boundary.

import { HEARTBEAT_INTERVAL_MS } from '@/config/market'
import type { WorkerHandle, WorkerMessageListener } from '@/lib/realtime/mock-socket'
import { MockServer, type ServerConfig } from '@/server/mock-server'
import { createRng } from '@/server/rng'

export function createInProcessWorker(
  config: ServerConfig,
  seed: number,
): { worker: WorkerHandle; server: MockServer; pause(): void } {
  const listeners = new Set<WorkerMessageListener>()
  const server = new MockServer(
    {
      post: (message) => {
        const copy = structuredClone(message)
        queueMicrotask(() => {
          for (const listener of [...listeners]) listener({ data: copy })
        })
      },
      now: () => Date.now(),
      rng: createRng(seed),
      schedule: (fn, ms) => {
        setTimeout(fn, ms)
      },
    },
    config,
  )
  let tickTimer: ReturnType<typeof setTimeout> | undefined
  const loop = (): void => {
    server.tick()
    tickTimer = setTimeout(loop, server.getBatchIntervalMs())
  }
  tickTimer = setTimeout(loop, server.getBatchIntervalMs())
  const heartbeat = setInterval(() => server.heartbeat(), HEARTBEAT_INTERVAL_MS)
  const pause = (): void => {
    clearTimeout(tickTimer)
    clearInterval(heartbeat)
  }
  const worker: WorkerHandle = {
    postMessage: (message) => {
      const copy = structuredClone(message)
      queueMicrotask(() => server.onBridgeMessage(copy))
    },
    addEventListener: (_type, listener) => {
      listeners.add(listener)
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener)
    },
    terminate: () => {
      pause()
      listeners.clear()
    },
  }
  return { worker, server, pause }
}
