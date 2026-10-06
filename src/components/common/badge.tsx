import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils/cn'

type BadgeTone = 'neutral' | 'brand'

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'h-8 gap-2 border-border bg-surface px-3 text-body text-fg-secondary',
  brand: 'border-brand-border bg-brand-surface px-1.5 text-caption text-brand-text',
}

type BadgeProps = ComponentProps<'span'> & { tone?: BadgeTone }

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return <span className={cn('inline-flex items-center rounded-pill border-hairline', TONE_CLASS[tone], className)} {...props} />
}
