import { Component, type ReactNode } from 'react'
import { trackError } from '@/lib/telemetry'
import BugReportDialog from '@/components/BugReportDialog'

interface Props {
  children: ReactNode
  fallback: 'full-page' | 'card'
}

interface State {
  error: Error | null
  bugReportOpen: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, bugReportOpen: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack)
    trackError(error)
  }

  reset = () => {
    this.setState({ error: null, bugReportOpen: false })
  }

  openBugReport = () => {
    this.setState({ bugReportOpen: true })
  }

  closeBugReport = () => {
    this.setState({ bugReportOpen: false })
  }

  render() {
    const { error, bugReportOpen } = this.state
    if (!error) return this.props.children

    if (this.props.fallback === 'full-page') {
      return (
        <>
          <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface p-8 text-center">
            <p className="text-sm font-semibold text-on-surface">Algo deu errado</p>
            <p className="max-w-sm text-xs text-on-surface/50">{error.message}</p>
            <div className="flex gap-3">
              <button
                onClick={this.reset}
                className="rounded-xl bg-gradient-to-br from-primary to-primary-container px-4 py-2 text-sm font-semibold text-white hover:brightness-110 active:scale-[0.97]"
              >
                Recarregar
              </button>
              <button
                onClick={this.openBugReport}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-on-surface hover:bg-surface-container-low"
              >
                Reportar problema
              </button>
            </div>
          </div>
          <BugReportDialog
            isOpen={bugReportOpen}
            onClose={this.closeBugReport}
            prefillTitle={error.message}
          />
        </>
      )
    }

    return (
      <>
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface-container-low p-8 text-center">
          <p className="text-sm font-semibold text-on-surface">Esta seção não pôde ser carregada</p>
          <p className="text-xs text-on-surface/50">{error.message}</p>
          <div className="flex gap-2">
            <button
              onClick={this.reset}
              className="rounded-xl bg-gradient-to-br from-primary to-primary-container px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 active:scale-[0.97]"
            >
              Tentar novamente
            </button>
            <button
              onClick={this.openBugReport}
              className="rounded-xl px-3 py-1.5 text-xs font-semibold text-on-surface hover:bg-surface-container-high"
            >
              Reportar
            </button>
          </div>
        </div>
        <BugReportDialog
          isOpen={bugReportOpen}
          onClose={this.closeBugReport}
          prefillTitle={error.message}
        />
      </>
    )
  }
}
