// ─── Types ────────────────────────────────────────────────────────────────────

export interface NavEvent {
  type: 'navigation'
  route: string
  ts: number
}

export interface ActionEvent {
  type: 'action'
  name: string
  ts: number
}

export interface ErrorEvent {
  type: 'error'
  message: string
  stack: string
  route: string
  ts: number
}

export interface PerfEvent {
  type: 'performance'
  metric: string
  ms: number
  ts: number
}

export type SafeEvent = NavEvent | ActionEvent | ErrorEvent | PerfEvent

export interface SnapshotOptions {
  includeNavigation: boolean
  includeActions: boolean
  includeErrors: boolean
  includePerformance: boolean
  includeDataShape: boolean
}

export interface DataShape {
  accountCount: number
  transactionCount: number
  categoryCount: number
  tagCount: number
  schemaVersion: number
  auditLogEntries: number
}

export interface BugSnapshot {
  appVersion: string
  schemaVersion: number
  browser: string
  pwa: boolean
  resolution: string
  locale: string
  recentNavigation: NavEvent[]
  recentActions: ActionEvent[]
  recentErrors: ErrorEvent[]
  performance: PerfEvent[]
  dataShape: DataShape | null
}

// ─── Ring buffer ──────────────────────────────────────────────────────────────

const MAX_EVENTS = 100

const _buffer: SafeEvent[] = []
let _currentRoute = '/'

// ─── Core tracking ────────────────────────────────────────────────────────────

export function track(event: SafeEvent): void {
  _buffer.push(event)
  if (_buffer.length > MAX_EVENTS) _buffer.shift()
}

export function trackNavigation(route: string): void {
  _currentRoute = route
  track({ type: 'navigation', route, ts: Date.now() })
}

export function trackAction(name: string): void {
  track({ type: 'action', name, ts: Date.now() })
}

export function trackError(error: Error): void {
  track({
    type: 'error',
    message: error.message,
    stack: error.stack ?? '',
    route: _currentRoute,
    ts: Date.now(),
  })
}

export function trackPerformance(metric: string, ms: number): void {
  track({ type: 'performance', metric, ms, ts: Date.now() })
}

// ─── Accessors ────────────────────────────────────────────────────────────────

export function getSnapshot(): SafeEvent[] {
  return [..._buffer]
}

export function getCurrentRoute(): string {
  return _currentRoute
}

/** Reset buffer — use in tests only. */
export function clearBuffer(): void {
  _buffer.length = 0
  _currentRoute = '/'
}

// ─── Snapshot builder ─────────────────────────────────────────────────────────

export function buildBugReportSnapshot(
  options: SnapshotOptions,
  dataShape?: DataShape
): BugSnapshot {
  const events = getSnapshot()

  return {
    appVersion: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'unknown',
    schemaVersion: 2,
    browser: navigator.userAgent,
    pwa: window.matchMedia('(display-mode: standalone)').matches,
    resolution: `${screen.width}×${screen.height}`,
    locale: navigator.language,
    recentNavigation: options.includeNavigation
      ? events.filter((e): e is NavEvent => e.type === 'navigation').slice(-10)
      : [],
    recentActions: options.includeActions
      ? events.filter((e): e is ActionEvent => e.type === 'action').slice(-20)
      : [],
    recentErrors: options.includeErrors
      ? events.filter((e): e is ErrorEvent => e.type === 'error')
      : [],
    performance: options.includePerformance
      ? events.filter((e): e is PerfEvent => e.type === 'performance')
      : [],
    dataShape: options.includeDataShape ? (dataShape ?? null) : null,
  }
}
