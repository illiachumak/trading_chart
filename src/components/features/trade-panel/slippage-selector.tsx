import { useId } from 'react'
import { Button } from '@/components/common/button'
import { SLIPPAGE_OPTIONS } from '@/config/market'
import { formatSlippage } from '@/lib/utils/format'

type SlippageSelectorProps = { value: number; onChange: (value: number) => void }

export function SlippageSelector({ value, onChange }: SlippageSelectorProps) {
  const labelId = useId()
  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-caption text-muted">
        Max slippage
      </span>
      <div role="group" aria-labelledby={labelId} className="flex gap-2">
        {SLIPPAGE_OPTIONS.map((option) => (
          <Button
            key={option}
            variant="subtle"
            size="sm"
            className="font-normal"
            aria-pressed={option === value}
            onClick={() => onChange(option)}
          >
            {formatSlippage(option)}
          </Button>
        ))}
      </div>
    </div>
  )
}
