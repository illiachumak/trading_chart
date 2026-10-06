const AMOUNT_PATTERN = /^\d{1,7}(\.\d{1,2})?$/

/** Parses the order amount input. Anything unusual is 'invalid' — no quote, no submit. */
export function parseAmount(input: string): number | 'invalid' {
  const trimmed = input.trim()
  if (!AMOUNT_PATTERN.test(trimmed)) return 'invalid'
  const value = Number(trimmed)
  return value > 0 ? value : 'invalid'
}
