// One market session: the backend worker, the ordered client and the stores fed by it.
// start()/stop() are idempotent so React StrictMode's double effects are safe.

import {
  CLOCK_SYNC_WINDOW,
  MAX_PENDING_MESSAGES,
  RECENT_TRADES_LIMIT,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  RESYNC_TIMEOUT_MS,
  UI_THROTTLE_MS,
} from '@/config/market'
import { AccountStore } from '@/lib/realtime/account-store'
import { MarketClient } from '@/lib/realtime/market-client'
import { MarketStore } from '@/lib/realtime/market-store'
import { createWorkerSocketFactory, type WorkerHandle } from '@/lib/realtime/mock-socket'
import type { ClientMessage } from '@/lib/realtime/protocol'
import type { SocketFactory } from '@/lib/realtime/socket'

export class MarketRuntime {
  readonly client: MarketClient
  readonly market: MarketStore
  readonly account: AccountStore
  private readonly createWorker: () => WorkerHandle
  private worker: WorkerHandle | 'none' = 'none'
  private socketFactory: SocketFactory | 'none' = 'none'

  constructor(createWorker: () => WorkerHandle) {
    this.createWorker = createWorker
    this.client = new MarketClient({
      createSocket: (handlers) => {
        if (this.socketFactory === 'none') throw new Error('MarketRuntime.start() must run before connecting')
        return this.socketFactory(handlers)
      },
      random: Math.random,
      backoffBaseMs: RECONNECT_BASE_MS,
      backoffMaxMs: RECONNECT_MAX_MS,
      resyncTimeoutMs: RESYNC_TIMEOUT_MS,
      maxPendingMessages: MAX_PENDING_MESSAGES,
    })
    this.market = new MarketStore({
      throttleMs: UI_THROTTLE_MS,
      recentTradesLimit: RECENT_TRADES_LIMIT,
      clockWindow: CLOCK_SYNC_WINDOW,
      now: () => Date.now(),
    })
    this.account = new AccountStore()
    this.market.attach(this.client)
    this.account.attach(this.client)
  }

  start(): void {
    if (this.worker !== 'none') return
    this.worker = this.createWorker()
    this.socketFactory = createWorkerSocketFactory(this.worker)
    this.client.start()
  }

  stop(): void {
    this.client.stop()
    if (this.worker !== 'none') this.worker.terminate()
    this.worker = 'none'
    this.socketFactory = 'none'
    this.market.reset()
    this.account.reset()
  }

  send(message: ClientMessage): void {
    this.client.send(message)
  }

  /**
   * Backend clock. The worker shares this machine's clock, so no offset is applied:
   * ClockSync cannot tell offset from constant transport latency and would hide injected latency.
   * A real-WebSocket transport should use `Date.now() + selectClockOffset(...)` instead.
   */
  serverNow(): number {
    return Date.now()
  }
}

export function createBrowserWorker(): WorkerHandle {
  const worker = new Worker(new URL('../../server/worker.ts', import.meta.url), { type: 'module' })
  return {
    postMessage: (message) => worker.postMessage(message),
    addEventListener: (type, listener) => worker.addEventListener(type, listener),
    removeEventListener: (type, listener) => worker.removeEventListener(type, listener),
    terminate: () => worker.terminate(),
  }
}
