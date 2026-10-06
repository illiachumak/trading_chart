import { useSyncExternalStore } from 'react'
import type { ExternalStore } from '@/lib/utils/external-store'

/** `selector` must return an existing reference or a primitive. */
export function useStoreSelector<T, S>(store: ExternalStore<T>, selector: (state: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()))
}
