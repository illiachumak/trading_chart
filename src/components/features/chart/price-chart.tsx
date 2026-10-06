import { useRef } from 'react'
import { usePriceChart } from '@/hooks/use-price-chart'

export function PriceChart() {
  const container = useRef<HTMLDivElement>(null)
  usePriceChart(container)
  return <div ref={container} className="h-80 w-full md:h-[420px]" data-testid="price-chart" />
}
