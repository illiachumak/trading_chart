import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils/cn'

type ButtonVariant = 'primary' | 'outline' | 'subtle' | 'danger'
type ButtonSize = 'sm' | 'md'

const PILL = 'rounded-pill border-hairline px-3 transition-colors text-fg-secondary hover:text-fg aria-pressed:text-fg'

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  // On the page canvas
  outline: cn(PILL, 'border-border bg-surface'),
  // Inside a card
  subtle: cn(PILL, 'border-border bg-surface-raised'),
  danger: cn(PILL, 'border-no/40 bg-no-strong text-no hover:text-no'),
}

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'h-7 text-caption',
  md: 'h-8 text-body',
}

type ButtonProps = Omit<ComponentProps<'button'>, 'type'> & {
  variant?: ButtonVariant
  /** Ignored by `primary`, which has a fixed CTA height. */
  size?: ButtonSize
}

export function Button({ variant = 'outline', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium tabular-nums disabled:cursor-not-allowed disabled:opacity-40',
        variant !== 'primary' && SIZE_CLASS[size],
        VARIANT_CLASS[variant],
        className,
      )}
      {...props}
    />
  )
}
