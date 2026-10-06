import type { ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

type ContainerProps = { as?: 'div' | 'main'; className?: string; children: ReactNode }

/** Centered page column shared by header, main and footer. */
export function Container({ as: Tag = 'div', className, children }: ContainerProps) {
  return <Tag className={cn('mx-auto w-full max-w-7xl px-4 md:px-8', className)}>{children}</Tag>
}
