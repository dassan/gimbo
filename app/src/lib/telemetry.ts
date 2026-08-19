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

// ─── Redução de dados sensíveis (SEC-08) ─────────────────────────────────────

/** Quantos frames de stack sobrevivem ao snapshot. Os primeiros são os que localizam o erro. */
const MAX_STACK_FRAMES = 3

/**
 * Corta o stack trace nos primeiros frames.
 *
 * O snapshot vai para um issue público. Um stack completo desenha a árvore interna de módulos do
 * app inteiro; os três primeiros frames já dizem onde o erro aconteceu, que é o que serve para
 * depurar. O corte é sinalizado para quem lê o issue não achar que o stack terminou ali.
 */
export function truncateStack(stack: string): string {
  const lines = stack.split('\n')
  // A primeira linha costuma ser "Error: mensagem", não um frame — preservada à parte.
  const head = lines[0]?.trimStart().startsWith('at ') ? [] : lines.slice(0, 1)
  const frames = lines.slice(head.length).filter((l) => l.trim().length > 0)
  const kept = frames.slice(0, MAX_STACK_FRAMES)
  const omitted = frames.length - kept.length
  return [...head, ...kept, ...(omitted > 0 ? [`    … +${omitted} frames omitidos`] : [])].join(
    '\n'
  )
}

/**
 * Reduz o User-Agent a família + versão maior (ex.: "Chrome 120", "Safari 17").
 *
 * O UA cru é uma das componentes mais fortes de fingerprint de browser, e num issue público ele
 * fica associado a uma pessoa identificável pelo próprio autor do issue. Família e versão maior
 * é o que de fato importa para reproduzir um bug.
 */
export function summarizeUserAgent(ua: string): string {
  const patterns: ReadonlyArray<readonly [RegExp, string]> = [
    [/Edg\/(\d+)/, 'Edge'],
    [/OPR\/(\d+)/, 'Opera'],
    [/Firefox\/(\d+)/, 'Firefox'],
    [/Chrome\/(\d+)/, 'Chrome'], // depois de Edge/Opera: ambos também trazem "Chrome/" no UA
    [/Version\/(\d+).*Safari/, 'Safari'],
  ]
  for (const [re, name] of patterns) {
    const match = re.exec(ua)
    if (match) return `${name} ${match[1]}`
  }
  return 'desconhecido'
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
    browser: summarizeUserAgent(navigator.userAgent),
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
      ? events
          .filter((e): e is ErrorEvent => e.type === 'error')
          .map((e) => ({ ...e, stack: truncateStack(e.stack) }))
      : [],
    performance: options.includePerformance
      ? events.filter((e): e is PerfEvent => e.type === 'performance')
      : [],
    dataShape: options.includeDataShape ? (dataShape ?? null) : null,
  }
}
