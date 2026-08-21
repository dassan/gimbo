import { trackPerformance } from '@/lib/telemetry'

/**
 * Camada dev-only sobre trackPerformance() — telemetry.ts fica sempre ativo (alimenta o Bug
 * Report System em produção) e não pode depender deste toggle. Ver plan/MONITORING.md.
 */

const STORAGE_KEY = 'gimbo:perfMonitor'

export function isPerfMonitorEnabled(): boolean {
  if (!import.meta.env.DEV) return false
  return localStorage.getItem(STORAGE_KEY) === '1'
}

export function setPerfMonitorEnabled(enabled: boolean): void {
  if (!import.meta.env.DEV) return
  if (enabled) localStorage.setItem(STORAGE_KEY, '1')
  else localStorage.removeItem(STORAGE_KEY)
}

export function measure<T>(name: string, fn: () => T): T {
  if (!import.meta.env.DEV || !isPerfMonitorEnabled()) return fn()
  const start = performance.now()
  const result = fn()
  trackPerformance(name, performance.now() - start)
  return result
}

export async function measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!import.meta.env.DEV || !isPerfMonitorEnabled()) return fn()
  const start = performance.now()
  try {
    return await fn()
  } finally {
    trackPerformance(name, performance.now() - start)
  }
}
