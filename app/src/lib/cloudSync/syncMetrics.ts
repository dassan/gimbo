// Always-on instrumentation for the sync pipeline (Google Drive Fase 2, folder Fase 1) — unlike
// lib/perfMonitor.ts's DEV+toggle gate (built for M-71's per-mutation local-compute investigation,
// far too frequent for telemetry.ts's shared 100-slot ring buffer to survive a session in
// production), sync events only fire on an actual sync attempt (boot, periodic poll, a mutation's
// debounced push, "Sincronizar agora"), and the whole point here is to see *production* Drive API
// network behavior — the thing a dev machine on localhost can't reproduce and the user's own
// device is the only place to capture, via the existing Bug Report System's "performance" category
// (already reviewed for scope under SEC-14). M-75 found dev/prod timing could diverge completely
// for local computation; the opposite conclusion applies here — Drive round-trip latency is the
// same in a dev and a prod build, so gating this behind DEV would hide it from the one place it
// actually needs to be seen.

import { trackPerformance } from '@/lib/telemetry'

export async function measureSync<T>(metric: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    return await fn()
  } finally {
    trackPerformance(metric, performance.now() - start)
  }
}

export function measureSyncCompute<T>(metric: string, fn: () => T): T {
  const start = performance.now()
  const result = fn()
  trackPerformance(metric, performance.now() - start)
  return result
}

// Reuses PerfEvent's `ms` field to carry a byte count instead of a duration — every call site
// names the metric with a `.bytes` suffix so a reader isn't misled; adding a dedicated field to
// PerfEvent/PerfPanel for this one producer isn't worth the churn.
export function trackSyncBytes(metric: string, bytes: number): void {
  trackPerformance(metric, bytes)
}
