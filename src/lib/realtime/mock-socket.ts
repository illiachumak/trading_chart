import { isWorkerToMain, type MainToWorker } from '@/lib/realtime/bridge'
import type { SocketFactory } from '@/lib/realtime/socket'

export type WorkerMessageListener = (event: { data: unknown }) => void

export type WorkerLike = {
  postMessage(message: MainToWorker): void
  addEventListener(type: 'message', listener: WorkerMessageListener): void
  removeEventListener(type: 'message', listener: WorkerMessageListener): void
}

/** Emulates WebSocket connections over a worker: one `connId` per socket. */
export function createWorkerSocketFactory(worker: WorkerLike): SocketFactory {
  let nextConnId = 1
  return (handlers) => {
    const connId = nextConnId++
    let closed = false

    const detach = (): void => {
      closed = true
      worker.removeEventListener('message', listener)
    }

    function listener(event: { data: unknown }): void {
      const message = event.data
      if (closed || !isWorkerToMain(message) || message.connId !== connId) return
      switch (message.kind) {
        case 'open':
          handlers.onOpen()
          return
        case 'data':
          handlers.onMessage(message.data)
          return
        case 'closed':
          detach()
          handlers.onClose()
          return
      }
    }

    worker.addEventListener('message', listener)
    worker.postMessage({ kind: 'connect', connId })

    return {
      send(data) {
        if (!closed) worker.postMessage({ kind: 'data', connId, data })
      },
      close() {
        if (closed) return
        detach()
        worker.postMessage({ kind: 'close', connId })
      },
    }
  }
}
