import type { ServerMessage, ServerPayload } from '@/lib/realtime/protocol'

/** Assigns `seq` to outgoing payloads and keeps the last `capacity` messages for replay. */
export class Outbox {
  private readonly capacity: number
  private readonly ring: ServerMessage[] = []
  private seq = 0

  constructor(capacity: number) {
    this.capacity = capacity
  }

  get lastSeq(): number {
    return this.seq
  }

  publish(payload: ServerPayload): ServerMessage {
    this.seq += 1
    const message: ServerMessage = { ...payload, seq: this.seq }
    this.ring.push(message)
    if (this.ring.length > this.capacity) this.ring.shift()
    return message
  }

  replayFrom(fromSeq: number): readonly ServerMessage[] | 'snapshot_required' {
    if (fromSeq <= 1 || fromSeq > this.seq + 1) return 'snapshot_required'
    const oldest = this.ring[0]?.seq ?? this.seq + 1
    if (fromSeq < oldest) return 'snapshot_required'
    return this.ring.slice(fromSeq - oldest)
  }
}
