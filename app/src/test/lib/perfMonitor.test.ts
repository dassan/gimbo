import { describe, it, expect, beforeEach } from 'vitest'
import {
  isPerfMonitorEnabled,
  setPerfMonitorEnabled,
  measure,
  measureAsync,
} from '@/lib/perfMonitor'
import { clearBuffer, getSnapshot, type PerfEvent } from '@/lib/telemetry'

function perfEvents(): PerfEvent[] {
  return getSnapshot().filter((e): e is PerfEvent => e.type === 'performance')
}

beforeEach(() => {
  clearBuffer()
  localStorage.clear()
})

// ─── toggle ───────────────────────────────────────────────────────────────────

describe('isPerfMonitorEnabled / setPerfMonitorEnabled', () => {
  it('defaults to disabled', () => {
    expect(isPerfMonitorEnabled()).toBe(false)
  })

  it('round-trips through localStorage', () => {
    setPerfMonitorEnabled(true)
    expect(isPerfMonitorEnabled()).toBe(true)
    setPerfMonitorEnabled(false)
    expect(isPerfMonitorEnabled()).toBe(false)
  })
})

// ─── measure ──────────────────────────────────────────────────────────────────

describe('measure', () => {
  it('records a performance event when enabled', () => {
    setPerfMonitorEnabled(true)
    measure('demo.sync', () => 1 + 1)
    const events = perfEvents()
    expect(events).toHaveLength(1)
    expect(events[0].metric).toBe('demo.sync')
    expect(events[0].ms).toBeGreaterThanOrEqual(0)
  })

  it('does not record anything when disabled', () => {
    measure('demo.sync', () => 1 + 1)
    expect(perfEvents()).toHaveLength(0)
  })

  it('returns fn() result regardless of the toggle', () => {
    expect(measure('demo.sync', () => 42)).toBe(42)
    setPerfMonitorEnabled(true)
    expect(measure('demo.sync', () => 42)).toBe(42)
  })
})

// ─── measureAsync ─────────────────────────────────────────────────────────────

describe('measureAsync', () => {
  it('records a performance event when enabled', async () => {
    setPerfMonitorEnabled(true)
    const result = await measureAsync('demo.async', () => Promise.resolve('ok'))
    expect(result).toBe('ok')
    const events = perfEvents()
    expect(events).toHaveLength(1)
    expect(events[0].metric).toBe('demo.async')
  })

  it('does not record anything when disabled', async () => {
    await measureAsync('demo.async', () => Promise.resolve('ok'))
    expect(perfEvents()).toHaveLength(0)
  })

  it('propagates a rejection and still records the metric', async () => {
    setPerfMonitorEnabled(true)
    await expect(
      measureAsync('demo.fails', () => Promise.reject(new Error('boom')))
    ).rejects.toThrow('boom')
    const events = perfEvents()
    expect(events).toHaveLength(1)
    expect(events[0].metric).toBe('demo.fails')
  })
})
