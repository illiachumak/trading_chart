import { createContext } from 'react'
import type { MarketRuntime } from '@/lib/realtime/market-runtime'

export const MarketRuntimeContext = createContext<MarketRuntime | 'none'>('none')
