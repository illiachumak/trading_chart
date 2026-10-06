import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils/cn'

describe('cn', () => {
  it('keeps a custom font size next to a text color', () => {
    expect(cn('text-body text-muted')).toBe('text-body text-muted')
  })

  it('lets a later text color override an earlier one', () => {
    expect(cn('text-body text-fg-secondary', 'text-no')).toBe('text-body text-no')
  })

  it('lets a later custom font size override an earlier one', () => {
    expect(cn('text-body text-muted', 'text-caption')).toBe('text-muted text-caption')
  })

  it('keeps hairline border width next to a border color', () => {
    expect(cn('border-hairline border-border', 'border-no/40')).toBe('border-hairline border-no/40')
  })

  it('keeps hairline dividers next to a divide color', () => {
    expect(cn('divide-hairline divide-border')).toBe('divide-hairline divide-border')
  })

  it('lets a later height override an earlier one', () => {
    expect(cn('h-8 px-3', 'h-7')).toBe('px-3 h-7')
  })
})
