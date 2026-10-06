// Minimal store compatible with React's useSyncExternalStore.

export type ExternalStore<T> = {
  getState(): T
  setState(next: T): void
  subscribe(listener: () => void): () => void
}

export function createExternalStore<T>(initial: T): ExternalStore<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    setState(next) {
      if (Object.is(next, state)) return
      state = next
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
