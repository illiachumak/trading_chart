// Envelope between the main thread and the mock-backend worker.
// It emulates a WebSocket: one `connId` per simulated connection.

import { isRecord } from '@/lib/utils/is-record'

export type MainToWorker =
  | { kind: 'connect'; connId: number }
  | { kind: 'data'; connId: number; data: string }
  | { kind: 'close'; connId: number }

export type WorkerToMain =
  | { kind: 'open'; connId: number }
  | { kind: 'data'; connId: number; data: string }
  | { kind: 'closed'; connId: number }

export function isMainToWorker(value: unknown): value is MainToWorker {
  if (!isRecord(value) || typeof value.connId !== 'number') return false
  if (value.kind === 'data') return typeof value.data === 'string'
  return value.kind === 'connect' || value.kind === 'close'
}

export function isWorkerToMain(value: unknown): value is WorkerToMain {
  if (!isRecord(value) || typeof value.connId !== 'number') return false
  if (value.kind === 'data') return typeof value.data === 'string'
  return value.kind === 'open' || value.kind === 'closed'
}
