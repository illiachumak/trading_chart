/** Reserved for BTC mode: live BTC/USDT price and the round's strike. */
export function BtcSlot() {
  return (
    <section aria-disabled className="rounded-card border-hairline border-dashed border-border p-4 text-body text-muted">
      <p className="font-medium text-fg-secondary">BTC / USDT</p>
      <p className="mt-1">Live BTC price and the round's strike appear here in BTC mode (coming soon).</p>
    </section>
  )
}
