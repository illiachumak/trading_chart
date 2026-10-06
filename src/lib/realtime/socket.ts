// Minimal WebSocket-shaped transport. A real `WebSocket` adapter can implement this later
// without touching MarketClient.

export type SocketHandlers = {
  onOpen(): void
  onMessage(data: string): void
  /** Connection lost (not called when the caller closed it). */
  onClose(): void
}

export type Socket = {
  send(data: string): void
  close(): void
}

/** Contract: handlers must never be invoked synchronously from inside the factory call. */
export type SocketFactory = (handlers: SocketHandlers) => Socket
