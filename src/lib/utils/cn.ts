import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Teach tailwind-merge the custom @theme scales and @utility classes from globals.css.
// Without this, `text-body` is read as a text color and silently drops `text-muted`.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['caption', 'body', 'body-lg', 'heading', 'heading-lg', 'display'],
      radius: ['card', 'control', 'overlay', 'pill'],
      shadow: ['card', 'sticky', 'primary'],
    },
    classGroups: {
      'border-w': ['border-hairline'],
      'border-w-t': ['border-t-hairline'],
      'border-w-b': ['border-b-hairline'],
      'divide-y': ['divide-hairline'],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
