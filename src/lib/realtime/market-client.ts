// Ordered, gap-free delivery of server messages across drops and reconnects.
// Every message is applied exactly once in `seq` order; gaps trigger a resync,
// and the server answers with a replay or a snapshot.

import {
  type ClientMessage,
  parseServerMessage,
  type PlaceOrder,
  type ServerMessage,
} from '@/lib/realtime/protocol'
import type { Socket, SocketFactory } from '@/lib/realtime/socket'

export type ConnectionStatus = 'idle' | 'connecting' | 'resyncing' | 'live' | 'reconnecting'

export type ClientStats = {
  messages: number
  trades: number
  gaps: number
  resyncs: number
  duplicates: number
  reconnects: number
}

export type MarketClientOptions = {
  createSocket: SocketFactory
  random: () => number
  backoffBaseMs: number
  backoffMaxMs: number
  resyncTimeoutMs: number
}

type Timer = ReturnType<typeof setTimeout>
type SnapshotMessage = Extract<ServerMessage, { type: 'snapshot' }>

export class MarketClient {
  readonly stats: ClientStats = { messages: 0, trades: 0, gaps: 0, resyncs: 0, duplicates: 0, reconnects: 0 }
  private readonly options: MarketClientOptions
  private status: ConnectionStatus = 'idle'
  private socket: Socket | 'none' = 'none'
  private socketOpen = false
  private connectionId = 0
  /** 0 = no baseline yet (waiting for the first snapshot). */
  private lastSeq = 0
  private readonly pending = new Map<number, ServerMessage>()
  private awaitingResync = false
  private readonly inflight = new Map<string, PlaceOrder>()
  private attempt = 0
  private reconnectTimer: Timer | 'none' = 'none'
  private resyncTimer: Timer | 'none' = 'none'
  private readonly messageListeners = new Set<(message: ServerMessage) => void>()
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>()

  constructor(options: MarketClientOptions) {
    this.options = options
  }

  getStatus(): ConnectionStatus {
    return this.status
  }

  getLastSeq(): number {
    return this.lastSeq
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.messageListeners.add(listener)
    return () => {
      this.messageListeners.delete(listener)
    }
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  start(): void {
    if (this.status !== 'idle') return
    this.connect('connecting')
  }

  stop(): void {
    this.clearReconnectTimer()
    this.clearResyncTimer()
    this.connectionId++
    if (this.socket !== 'none') this.socket.close()
    this.socket = 'none'
    this.socketOpen = false
    this.lastSeq = 0
    this.pending.clear()
    this.inflight.clear()
    this.awaitingResync = false
    this.attempt = 0
    this.setStatus('idle')
  }

  send(message: ClientMessage): void {
    if (message.type === 'place_order') {
      // Kept until an order_result arrives; re-sent after reconnects (server is idempotent).
      this.inflight.set(message.clientOrderId, message)
      if (this.status === 'live') this.rawSend(message)
      return
    }
    this.rawSend(message)
  }

  requestSnapshot(): void {
    this.rawSend({ type: 'resync', fromSeq: 0 })
  }

  private connect(status: 'connecting' | 'reconnecting'): void {
    this.setStatus(status)
    const id = ++this.connectionId
    this.socketOpen = false
    this.socket = this.options.createSocket({
      onOpen: () => {
        if (id === this.connectionId) this.handleOpen()
      },
      onMessage: (data) => {
        if (id === this.connectionId) this.handleData(data)
      },
      onClose: () => {
        if (id === this.connectionId) this.handleClose()
      },
    })
  }

  private handleOpen(): void {
    this.socketOpen = true
    this.attempt = 0
    this.setStatus('resyncing')
    this.requestResync()
  }

  private handleClose(): void {
    this.connectionId++
    this.socket = 'none'
    this.socketOpen = false
    this.clearResyncTimer()
    this.stats.reconnects++
    const ceiling = Math.min(this.options.backoffMaxMs, this.options.backoffBaseMs * 2 ** this.attempt)
    this.attempt++
    this.setStatus('reconnecting')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = 'none'
      this.connect('reconnecting')
    }, this.options.random() * ceiling)
  }

  private requestResync(): void {
    this.awaitingResync = true
    this.stats.resyncs++
    this.rawSend({ type: 'resync', fromSeq: this.lastSeq + 1 })
    this.clearResyncTimer()
    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = 'none'
      if (this.awaitingResync && this.socketOpen) this.requestResync()
    }, this.options.resyncTimeoutMs)
  }

  private handleData(data: string): void {
    const message = parseServerMessage(data)
    if (message === 'invalid') return
    this.stats.messages++
    if (message.type === 'snapshot') {
      this.acceptSnapshot(message)
      return
    }
    if (message.seq <= this.lastSeq) {
      this.stats.duplicates++
      return
    }
    if (this.lastSeq > 0 && message.seq === this.lastSeq + 1) {
      this.apply(message)
      this.drainPending()
      return
    }
    this.pending.set(message.seq, message)
    if (!this.awaitingResync) {
      this.stats.gaps++
      this.requestResync()
    }
  }

  private acceptSnapshot(snapshot: SnapshotMessage): void {
    if (snapshot.seq < this.lastSeq) {
      this.stats.duplicates++
      return
    }
    this.lastSeq = snapshot.seq
    for (const seq of this.pending.keys()) {
      if (seq <= snapshot.seq) this.pending.delete(seq)
    }
    this.deliver(snapshot)
    this.drainPending()
  }

  private drainPending(): void {
    let next = this.pending.get(this.lastSeq + 1)
    while (next !== undefined) {
      this.pending.delete(next.seq)
      this.apply(next)
      next = this.pending.get(this.lastSeq + 1)
    }
    if (this.awaitingResync && this.pending.size === 0) this.caughtUp()
  }

  private caughtUp(): void {
    const afterConnect = this.status === 'resyncing'
    this.awaitingResync = false
    this.clearResyncTimer()
    this.setStatus('live')
    if (afterConnect) {
      for (const order of this.inflight.values()) this.rawSend(order)
    }
  }

  private apply(message: ServerMessage): void {
    this.lastSeq = message.seq
    if (message.type === 'trades') this.stats.trades += message.items.length
    if (message.type === 'order_result') this.inflight.delete(message.result.clientOrderId)
    this.deliver(message)
  }

  private deliver(message: ServerMessage): void {
    for (const listener of this.messageListeners) listener(message)
  }

  private rawSend(message: ClientMessage): void {
    if (this.socketOpen && this.socket !== 'none') this.socket.send(JSON.stringify(message))
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this.status) return
    this.status = status
    for (const listener of this.statusListeners) listener(status)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== 'none') clearTimeout(this.reconnectTimer)
    this.reconnectTimer = 'none'
  }

  private clearResyncTimer(): void {
    if (this.resyncTimer !== 'none') clearTimeout(this.resyncTimer)
    this.resyncTimer = 'none'
  }
}
