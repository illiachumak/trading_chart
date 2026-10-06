import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/common/button'

type Fallback = (error: Error, reset: () => void) => ReactNode

type ErrorBoundaryProps = { name: string; fallback?: Fallback; children: ReactNode }
type ErrorBoundaryState = { error: Error | 'none' }

function defaultFallback(name: string): Fallback {
  return (error, reset) => (
    <div role="alert" className="card border-no/40 p-4 text-body md:p-5">
      <p className="font-medium text-no">{name} crashed</p>
      <p className="mt-1 text-muted">{error.message}</p>
      <Button variant="subtle" className="mt-3" onClick={reset}>
        Retry
      </Button>
    </div>
  )
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: 'none' }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.name}] crashed`, error, info.componentStack)
  }

  private reset = (): void => this.setState({ error: 'none' })

  render(): ReactNode {
    if (this.state.error === 'none') return this.props.children
    const fallback = this.props.fallback ?? defaultFallback(this.props.name)
    return fallback(this.state.error, this.reset)
  }
}
