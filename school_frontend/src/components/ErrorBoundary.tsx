import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/** After a new version is deployed, old pages ask for code files that no longer exist. */
const isStaleChunk = (e: Error) => /dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(e.message)

/**
 * Catches rendering crashes so one broken page shows a friendly message instead of a blank screen.
 * Remount it (change `key`) to reset — the layout keys it by route, so navigating away recovers.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; fullPage?: boolean }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const stale = isStaleChunk(error)
    return (
      <div className={this.props.fullPage ? 'flex min-h-full items-center justify-center p-6' : 'py-10'}>
        <div className="card mx-auto max-w-md p-8 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <AlertTriangle className="size-6" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-slate-900">{stale ? 'A new version is available' : 'Something went wrong on this page'}</h2>
          <p className="mt-1.5 text-sm text-slate-500">
            {stale ? 'The portal was updated. Reload to get the latest version.' : 'Your data is safe. Reload the page, or go back to the dashboard. If it keeps happening, tell your administrator.'}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <button onClick={() => window.location.reload()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              <RefreshCw className="size-4" /> Reload
            </button>
            {!stale && (
              <a href="/" className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Dashboard
              </a>
            )}
          </div>
        </div>
      </div>
    )
  }
}
