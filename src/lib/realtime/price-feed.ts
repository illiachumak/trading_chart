export type PriceTick = { price: number; ts: number }

/**
 * External reference price (BTC mode: Binance `btcusdt@trade`). Consumed by the BTC resolver,
 * the BTC-biased trader model and the right panel. No implementation in v1.
 */
export type PriceFeed = {
  subscribe(listener: (tick: PriceTick) => void): () => void
  latest(): PriceTick | 'none'
}
