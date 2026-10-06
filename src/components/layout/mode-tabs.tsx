export function ModeTabs() {
  return (
    <div
      className="inline-flex h-8 items-center rounded-pill border-hairline border-border bg-surface p-0.5 text-body"
      role="group"
      aria-label="Market mode"
    >
      <button type="button" aria-pressed className="h-full rounded-pill bg-surface-raised px-3 font-medium text-fg">
        Coinflip
      </button>
      <button
        type="button"
        aria-pressed={false}
        disabled
        className="h-full cursor-not-allowed rounded-pill px-3 font-medium text-subtle"
        title="BTC up/down via Binance — coming soon"
      >
        BTC <span className="text-caption">soon</span>
      </button>
    </div>
  )
}
