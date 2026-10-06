export function ModeTabs() {
  return (
    <div className="flex rounded-lg bg-surface-raised p-0.5 text-sm" role="tablist" aria-label="Market mode">
      <button type="button" role="tab" aria-selected className="rounded-md bg-surface px-3 py-1 font-medium">
        Coinflip
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={false}
        disabled
        className="cursor-not-allowed rounded-md px-3 py-1 text-muted"
        title="BTC up/down via Binance — coming soon"
      >
        BTC <span className="text-xs">soon</span>
      </button>
    </div>
  )
}
