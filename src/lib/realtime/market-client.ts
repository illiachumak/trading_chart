// Ordered, gap-free delivery of server messages across drops and reconnects.
// Every message is applied exactly once in `seq` order; gaps trigger a resync,
// and the server answers with a replay or a snapshot. Exception: `quote_result` is an
// unsequenced reply and is delivered as soon as it arrives.

import {
  type ClientMessage,
  parseServerMessage,
  type PlaceOrder,
  type ServerMessage,
} from '@/lib/realtime/protocol'
import type { Socket, SocketFactory } from '@/lib/realtime/socket'
import { isRecord } from '@/lib/utils/is-record'

export type ConnectionStatus = 'idle' | 'connecting' | 'resyncing' | 'live' | 'reconnecting'

export type ClientStats = {
  messages: number
  /** Trades the server reported: shipped items plus those summarised in `aggregated`. */
  trades: number
  /** Trades actually shipped as `items` (equals `trades` in full aggregation mode). */
  tradeItems: number
  /** Sum of raw message string lengths, including duplicates and unparsable data (~bytes for ASCII JSON). */
  bytes: number
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
  /** Out-of-order messages kept while waiting for a resync; beyond this, fall back to a snapshot. */
  maxPendingMessages: number
}

type Timer = ReturnType<typeof setTimeout>

/** The server-message guard checks only the envelope, so a missing or malformed aggregate counts as none. */
function aggregatedCount(aggregated: unknown): number {
  return isRecord(aggregated) && typeof aggregated.count === 'number' ? aggregated.count : 0
}
type SnapshotMessage = Extract<ServerMessage, { type: 'snapshot' }>

export class MarketClient {
  readonly stats: ClientStats = {
    messages: 0,
    trades: 0,
    tradeItems: 0,
    bytes: 0,
    gaps: 0,
    resyncs: 0,
    duplicates: 0,
    reconnects: 0,
  }
  private readonly options: MarketClientOptions
  private status: ConnectionStatus = 'idle'
  private socket: Socket | 'none' = 'none'
  private socketOpen = false
  private connectionId = 0
  /** 0 = no baseline yet (waiting for the first snapshot). */
  private lastSeq = 0
  private readonly pending = new Map<number, ServerMessage>()
  private awaitingResync = false
  /** A full snapshot was requested while the socket was not open (or not yet answered). */
  private snapshotWanted = false
  /** Consecutive unanswered resync retries; drives the exponential retry timeout. */
  private retries = 0
  /** True once a socket has closed since start(); the next open then counts as a reconnect. */
  private hasClosed = false
  private readonly inflight = new Map<string, PlaceOrder>()
  /** Re-send in-flight orders once caught up: after a reconnect, or after a snapshot that may hide their results. */
  private resendOrders = false
  /** Consecutive connections that closed before going live; drives the reconnect backoff. */
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
    this.snapshotWanted = false
    this.retries = 0
    this.hasClosed = false
    this.resendOrders = false
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

  /** Asks for a full snapshot; retried like any resync. A closed socket asks on the next open. */
  requestSnapshot(): void {
    this.snapshotWanted = true
    if (this.socketOpen) this.requestResync(false)
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
    this.retries = 0
    this.resendOrders = true
    if (this.hasClosed) this.stats.reconnects++
    this.setStatus('resyncing')
    this.requestResync(false)
  }

  private handleClose(): void {
    this.connectionId++
    this.socket = 'none'
    this.socketOpen = false
    this.clearResyncTimer()
    this.hasClosed = true
    const ceiling = Math.min(this.options.backoffMaxMs, this.options.backoffBaseMs * 2 ** this.attempt)
    this.attempt++
    this.setStatus('reconnecting')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = 'none'
      this.connect('reconnecting')
    }, this.options.random() * ceiling)
  }

  /** `counted` is false for the handshake resync sent on open. */
  private requestResync(counted: boolean): void {
    this.awaitingResync = true
    if (counted) this.stats.resyncs++
    this.rawSend({ type: 'resync', fromSeq: this.snapshotWanted ? 0 : this.lastSeq + 1 })
    this.clearResyncTimer()
    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = 'none'
      if (this.awaitingResync && this.socketOpen) {
        this.retries++
        this.requestResync(true)
      }
    }, this.options.resyncTimeoutMs * Math.min(8, 2 ** this.retries))
  }

  private handleData(data: string): void {
    this.stats.bytes += data.length
    const message = parseServerMessage(data)
    if (message === 'invalid') return
    this.stats.messages++
    // Quote answers are per-connection replies outside the sequenced stream (their seq is just
    // the server's lastSeq at answer time), so they skip ordering, gap and duplicate handling.
    if (message.type === 'quote_result') {
      this.deliver(message)
      return
    }
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
    if (this.pending.size >= this.options.maxPendingMessages) {
      // The gap is not closing; drop the backlog and rebuild from a snapshot instead.
      this.pending.clear()
      this.requestSnapshot()
      return
    }
    this.pending.set(message.seq, message)
    if (!this.awaitingResync) {
      this.stats.gaps++
      this.requestResync(true)
    }
  }

  private acceptSnapshot(snapshot: SnapshotMessage): void {
    // An equal seq is applied only when a snapshot was explicitly requested (e.g. a chart remount).
    if (snapshot.seq < this.lastSeq || (snapshot.seq === this.lastSeq && !this.snapshotWanted)) {
      this.stats.duplicates++
      return
    }
    this.lastSeq = snapshot.seq
    this.snapshotWanted = false
    // order_results up to this seq will never arrive; re-sending makes the server repeat them.
    if (this.inflight.size > 0) this.resendOrders = true
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
    this.awaitingResync = false
    this.retries = 0
    this.attempt = 0
    this.clearResyncTimer()
    this.setStatus('live')
    if (this.resendOrders) {
      this.resendOrders = false
      for (const order of this.inflight.values()) this.rawSend(order)
    }
  }

  private apply(message: ServerMessage): void {
    this.lastSeq = message.seq
    if (message.type === 'trades') {
      this.stats.tradeItems += message.items.length
      this.stats.trades += message.items.length + aggregatedCount(message.aggregated)
    }
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
