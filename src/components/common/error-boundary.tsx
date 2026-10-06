import { Component, type ReactNode } from 'react'

type ErrorBoundaryProps = { name: string; children: ReactNode }
type ErrorBoundaryState = { error: Error | 'none' }

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: 'none' }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  render(): ReactNode {
    if (this.state.error === 'none') return this.props.children
    return (
      <div role="alert" className="rounded-xl border border-no/40 bg-no-soft p-4 text-sm">
        <p className="font-medium text-no">{this.props.name} crashed</p>
        <p className="mt-1 text-muted">{this.state.error.message}</p>
        <button type="button" className="mt-2 underline" onClick={() => this.setState({ error: 'none' })}>
          Retry
        </button>
      </div>
    )
  }
}
