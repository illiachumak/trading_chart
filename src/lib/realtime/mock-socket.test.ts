import { describe, expect, it } from 'vitest'
import type { MainToWorker, WorkerToMain } from '@/lib/realtime/bridge'
import { createWorkerSocketFactory, type WorkerLike, type WorkerMessageListener } from '@/lib/realtime/mock-socket'

function fakeWorker() {
  const listeners = new Set<WorkerMessageListener>()
  const posted: MainToWorker[] = []
  const worker: WorkerLike = {
    postMessage: (message) => posted.push(message),
    addEventListener: (_type, listener) => {
      listeners.add(listener)
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener)
    },
  }
  const emit = (message: WorkerToMain) => {
    for (const listener of [...listeners]) listener({ data: message })
  }
  return { worker, posted, emit, listenerCount: () => listeners.size }
}

function recorder() {
  const events: string[] = []
  return {
    events,
    handlers: {
      onOpen: () => events.push('open'),
      onMessage: (data: string) => events.push(`msg:${data}`),
      onClose: () => events.push('close'),
    },
  }
}

describe('createWorkerSocketFactory', () => {
  it('opens a new connection id per socket and routes events by id', () => {
    const fw = fakeWorker()
    const factory = createWorkerSocketFactory(fw.worker)
    const a = recorder()
    const b = recorder()
    factory(a.handlers)
    factory(b.handlers)
    expect(fw.posted).toEqual([
      { kind: 'connect', connId: 1 },
      { kind: 'connect', connId: 2 },
    ])
    fw.emit({ kind: 'open', connId: 2 })
    fw.emit({ kind: 'data', connId: 2, data: 'x' })
    expect(a.events).toEqual([])
    expect(b.events).toEqual(['open', 'msg:x'])
  })

  it('sends data with its connection id', () => {
    const fw = fakeWorker()
    const socket = createWorkerSocketFactory(fw.worker)(recorder().handlers)
    socket.send('hello')
    expect(fw.posted.at(-1)).toEqual({ kind: 'data', connId: 1, data: 'hello' })
  })

  it('reports a server-side close once and detaches', () => {
    const fw = fakeWorker()
    const r = recorder()
    createWorkerSocketFactory(fw.worker)(r.handlers)
    fw.emit({ kind: 'closed', connId: 1 })
    fw.emit({ kind: 'data', connId: 1, data: 'late' })
    expect(r.events).toEqual(['close'])
    expect(fw.listenerCount()).toBe(0)
  })

  it('close() notifies the worker, detaches, and ignores later sends', () => {
    const fw = fakeWorker()
    const r = recorder()
    const socket = createWorkerSocketFactory(fw.worker)(r.handlers)
    socket.close()
    socket.send('ignored')
    fw.emit({ kind: 'data', connId: 1, data: 'late' })
    expect(fw.posted).toEqual([
      { kind: 'connect', connId: 1 },
      { kind: 'close', connId: 1 },
    ])
    expect(r.events).toEqual([])
    expect(fw.listenerCount()).toBe(0)
  })
})
