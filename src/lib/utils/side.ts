import type { Side } from '@/lib/realtime/protocol'

export const SIDE_LABEL: Record<Side, 'YES' | 'NO'> = { yes: 'YES', no: 'NO' }

/** Tailwind classes per side: `text` for labels, `soft` for tinted tiles, `strong` for selected controls. */
export const SIDE_TONE: Record<Side, { text: string; soft: string; strong: string }> = {
  yes: { text: 'text-yes', soft: 'border-yes/40 bg-yes-soft', strong: 'border-yes/40 bg-yes-strong' },
  no: { text: 'text-no', soft: 'border-no/40 bg-no-soft', strong: 'border-no/40 bg-no-strong' },
}
