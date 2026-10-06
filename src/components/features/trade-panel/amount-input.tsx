const PRESETS = ['10', '50', '100'] as const

type AmountInputProps = { value: string; valid: boolean; onChange: (value: string) => void }

export function AmountInput({ value, valid, onChange }: AmountInputProps) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="order-amount" className="text-caption text-muted">
        Amount
      </label>
      <div
        className={`flex items-center rounded-control border-hairline bg-surface-raised px-3 transition-colors ${
          valid ? 'border-border focus-within:border-accent' : 'border-no'
        }`}
      >
        <span className="text-muted">$</span>
        <input
          id="order-amount"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          aria-invalid={!valid}
          onChange={(event) => onChange(event.target.value)}
          className="w-full bg-transparent px-2 py-2.5 text-body-lg tabular-nums outline-none"
        />
      </div>
      <div className="flex gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            className="inline-flex h-7 items-center rounded-pill border-hairline border-border bg-surface-raised px-3 text-caption text-fg-secondary tabular-nums transition-colors hover:text-fg"
          >
            ${preset}
          </button>
        ))}
      </div>
    </div>
  )
}
