// Minimal store compatible with React's useSyncExternalStore.

/** Read side handed to React. Only the owning class keeps the writable handle. */
export type ExternalStore<T> = {
  getState(): T
  subscribe(listener: () => void): () => void
}

export type WritableStore<T> = ExternalStore<T> & { setState(next: T): void }

export function createExternalStore<T>(initial: T): WritableStore<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    setState(next) {
      if (Object.is(next, state)) return
      state = next
      // Copy: a listener subscribing during notify must not be called for this change.
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
