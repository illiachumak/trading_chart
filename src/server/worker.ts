// Module worker entry: the only place in the mock backend that touches real timers and postMessage.

import { HEARTBEAT_INTERVAL_MS } from '@/config/market'
import { isMainToWorker } from '@/lib/realtime/bridge'
import { DEFAULT_SERVER_CONFIG, MockServer } from '@/server/mock-server'
import { createRng } from '@/server/rng'

const server = new MockServer(
  {
    post: (message) => postMessage(message),
    now: () => Date.now(),
    rng: createRng(Date.now()),
    schedule: (fn, ms) => {
      setTimeout(fn, ms)
    },
  },
  DEFAULT_SERVER_CONFIG,
)

addEventListener('message', (event: MessageEvent<unknown>) => {
  if (isMainToWorker(event.data)) server.onBridgeMessage(event.data)
})

// Self-rescheduling so a runtime change of the batch interval takes effect on the next tick.
function loop(): void {
  server.tick()
  setTimeout(loop, server.getBatchIntervalMs())
}
setTimeout(loop, server.getBatchIntervalMs())
setInterval(() => server.heartbeat(), HEARTBEAT_INTERVAL_MS)
