import { Button } from '@/components/common/button'
import { cn } from '@/lib/utils/cn'
import { isAmountInProgress } from '@/lib/utils/parse-amount'

const PRESETS = ['10', '50', '100'] as const

type AmountInputProps = { value: string; valid: boolean; onChange: (value: string) => void }

export function AmountInput({ value, valid, onChange }: AmountInputProps) {
  const inProgress = isAmountInProgress(value)
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="order-amount" className="text-caption text-muted">
        Amount
      </label>
      <div
        className={cn(
          'flex items-center rounded-control border-hairline bg-surface-raised px-3 transition-colors focus-within:ring-2 focus-within:ring-accent',
          inProgress || valid ? 'border-border focus-within:border-accent' : 'border-no',
        )}
      >
        <span className="text-muted">$</span>
        <input
          id="order-amount"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          aria-invalid={!valid && !inProgress}
          onChange={(event) => onChange(event.target.value)}
          className="w-full bg-transparent px-2 py-2.5 text-body-lg tabular-nums outline-none focus-visible:outline-none"
        />
      </div>
      <div className="flex gap-2">
        {PRESETS.map((preset) => (
          <Button
            key={preset}
            variant="subtle"
            size="sm"
            className="font-normal"
            data-testid={`ticket-amount-${preset}`}
            onClick={() => onChange(preset)}
          >
            ${preset}
          </Button>
        ))}
      </div>
    </div>
  )
}
