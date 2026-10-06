import { Component, type ErrorInfo, type ReactNode } from 'react'

type ErrorBoundaryProps = { name: string; children: ReactNode }
type ErrorBoundaryState = { error: Error | 'none' }

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: 'none' }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.name}] crashed`, error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error === 'none') return this.props.children
    return (
      <div role="alert" className="card border-no/40 p-4 text-body md:p-5">
        <p className="font-medium text-no">{this.props.name} crashed</p>
        <p className="mt-1 text-muted">{this.state.error.message}</p>
        <button
          type="button"
          className="mt-3 inline-flex h-8 items-center rounded-pill border-hairline border-border bg-surface-raised px-3 font-medium text-fg-secondary hover:text-fg"
          onClick={() => this.setState({ error: 'none' })}
        >
          Retry
        </button>
      </div>
    )
  }
}
