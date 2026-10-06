import { useMarketRuntime } from '@/hooks/use-market-runtime'
import { useStoreSelector } from '@/hooks/use-store-selector'
import type { AccountStoreState } from '@/lib/realtime/account-store'
import type { MarketState } from '@/lib/realtime/market-store'

export function useMarket<S>(selector: (state: MarketState) => S): S {
  return useStoreSelector(useMarketRuntime().market.store, selector)
}

export function useAccount<S>(selector: (state: AccountStoreState) => S): S {
  return useStoreSelector(useMarketRuntime().account.store, selector)
}
