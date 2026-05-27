import { describe, it, expect, beforeEach } from 'vitest'
import {
  trackNavigation,
  trackAction,
  trackError,
  trackPerformance,
  getSnapshot,
  getCurrentRoute,
  clearBuffer,
  buildBugReportSnapshot,
  type SafeEvent,
  type SnapshotOptions,
  type DataShape,
} from '@/lib/telemetry'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ALL_ON: SnapshotOptions = {
  includeNavigation: true,
  includeActions: true,
  includeErrors: true,
  includePerformance: true,
  includeDataShape: true,
}

const ALL_OFF: SnapshotOptions = {
  includeNavigation: false,
  includeActions: false,
  includeErrors: false,
  includePerformance: false,
  includeDataShape: false,
}

const SAMPLE_SHAPE: DataShape = {
  accountCount: 3,
  transactionCount: 42,
  categoryCount: 8,
  tagCount: 5,
  schemaVersion: 2,
  auditLogEntries: 100,
}

beforeEach(() => {
  clearBuffer()
})

// ─── Ring buffer ──────────────────────────────────────────────────────────────

describe('ring buffer', () => {
  it('starts empty', () => {
    expect(getSnapshot()).toHaveLength(0)
  })

  it('appends events in order', () => {
    trackAction('a')
    trackAction('b')
    expect(getSnapshot()).toHaveLength(2)
    expect((getSnapshot()[0] as { name: string }).name).toBe('a')
    expect((getSnapshot()[1] as { name: string }).name).toBe('b')
  })

  it('discards the oldest event when MAX_EVENTS is exceeded', () => {
    for (let i = 0; i < 100; i++) {
      trackAction(`action-${i}`)
    }
    expect(getSnapshot()).toHaveLength(100)
    // add one more — oldest should be evicted
    trackAction('overflow')
    const snapshot = getSnapshot()
    expect(snapshot).toHaveLength(100)
    expect((snapshot[0] as { name: string }).name).toBe('action-1')
    expect((snapshot[99] as { name: string }).name).toBe('overflow')
  })

  it('getSnapshot returns a copy, not a reference', () => {
    trackAction('x')
    const snap1 = getSnapshot()
    trackAction('y')
    const snap2 = getSnapshot()
    expect(snap1).toHaveLength(1)
    expect(snap2).toHaveLength(2)
  })

  it('clearBuffer resets to empty and resets current route', () => {
    trackNavigation('/dashboard')
    trackAction('something')
    clearBuffer()
    expect(getSnapshot()).toHaveLength(0)
    expect(getCurrentRoute()).toBe('/')
  })
})

// ─── trackNavigation ──────────────────────────────────────────────────────────

describe('trackNavigation', () => {
  it('adds a navigation event to the buffer', () => {
    trackNavigation('/transactions')
    const events = getSnapshot()
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('navigation')
    expect((events[0] as { route: string }).route).toBe('/transactions')
  })

  it('updates getCurrentRoute', () => {
    expect(getCurrentRoute()).toBe('/')
    trackNavigation('/settings')
    expect(getCurrentRoute()).toBe('/settings')
  })

  it('records a timestamp', () => {
    const before = Date.now()
    trackNavigation('/dashboard')
    const after = Date.now()
    const ts = (getSnapshot()[0] as { ts: number }).ts
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })
})

// ─── trackAction ──────────────────────────────────────────────────────────────

describe('trackAction', () => {
  it('adds an action event', () => {
    trackAction('transaction_created')
    const events = getSnapshot()
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('action')
    expect((events[0] as { name: string }).name).toBe('transaction_created')
  })
})

// ─── trackError ───────────────────────────────────────────────────────────────

describe('trackError', () => {
  it('adds an error event with message and stack', () => {
    const err = new Error('Something exploded')
    trackError(err)
    const events = getSnapshot()
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('error')
    expect((events[0] as { message: string }).message).toBe('Something exploded')
    expect((events[0] as { stack: string }).stack).toContain('Something exploded')
  })

  it('captures the current route at time of error', () => {
    trackNavigation('/credit-card/123')
    const err = new Error('crash')
    trackError(err)
    const errorEvents = getSnapshot().filter(
      (e): e is SafeEvent & { route: string } => e.type === 'error'
    )
    expect(errorEvents[0].route).toBe('/credit-card/123')
  })

  it('handles errors without a stack gracefully', () => {
    const err = new Error('no stack')
    err.stack = undefined
    trackError(err)
    const event = getSnapshot()[0] as { stack: string }
    expect(event.stack).toBe('')
  })
})

// ─── trackPerformance ─────────────────────────────────────────────────────────

describe('trackPerformance', () => {
  it('adds a performance event', () => {
    trackPerformance('page_load', 120)
    const events = getSnapshot()
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('performance')
    expect((events[0] as { metric: string }).metric).toBe('page_load')
    expect((events[0] as { ms: number }).ms).toBe(120)
  })
})

// ─── buildBugReportSnapshot ───────────────────────────────────────────────────

describe('buildBugReportSnapshot', () => {
  beforeEach(() => {
    trackNavigation('/dashboard')
    trackNavigation('/transactions')
    trackAction('transaction_created')
    trackAction('account_updated')
    trackError(new Error('test error'))
    trackPerformance('render', 50)
  })

  it('includes all categories when all options are true', () => {
    const snap = buildBugReportSnapshot(ALL_ON, SAMPLE_SHAPE)
    expect(snap.recentNavigation).toHaveLength(2)
    expect(snap.recentActions).toHaveLength(2)
    expect(snap.recentErrors).toHaveLength(1)
    expect(snap.performance).toHaveLength(1)
    expect(snap.dataShape).toEqual(SAMPLE_SHAPE)
  })

  it('excludes all categories when all options are false', () => {
    const snap = buildBugReportSnapshot(ALL_OFF, SAMPLE_SHAPE)
    expect(snap.recentNavigation).toHaveLength(0)
    expect(snap.recentActions).toHaveLength(0)
    expect(snap.recentErrors).toHaveLength(0)
    expect(snap.performance).toHaveLength(0)
    expect(snap.dataShape).toBeNull()
  })

  it('excludes only navigation when includeNavigation is false', () => {
    const snap = buildBugReportSnapshot({ ...ALL_ON, includeNavigation: false }, SAMPLE_SHAPE)
    expect(snap.recentNavigation).toHaveLength(0)
    expect(snap.recentActions).toHaveLength(2)
  })

  it('excludes only actions when includeActions is false', () => {
    const snap = buildBugReportSnapshot({ ...ALL_ON, includeActions: false }, SAMPLE_SHAPE)
    expect(snap.recentNavigation).toHaveLength(2)
    expect(snap.recentActions).toHaveLength(0)
  })

  it('excludes only errors when includeErrors is false', () => {
    const snap = buildBugReportSnapshot({ ...ALL_ON, includeErrors: false }, SAMPLE_SHAPE)
    expect(snap.recentErrors).toHaveLength(0)
    expect(snap.recentNavigation).toHaveLength(2)
  })

  it('returns null dataShape when includeDataShape is false', () => {
    const snap = buildBugReportSnapshot({ ...ALL_ON, includeDataShape: false }, SAMPLE_SHAPE)
    expect(snap.dataShape).toBeNull()
  })

  it('returns null dataShape when no dataShape is provided', () => {
    const snap = buildBugReportSnapshot(ALL_ON)
    expect(snap.dataShape).toBeNull()
  })

  it('always includes environment metadata regardless of options', () => {
    const snap = buildBugReportSnapshot(ALL_OFF)
    expect(snap.browser).toBeDefined()
    expect(snap.resolution).toBeDefined()
    expect(snap.locale).toBeDefined()
    expect(typeof snap.pwa).toBe('boolean')
    expect(snap.schemaVersion).toBe(2)
  })

  it('snapshot JSON contains no financial field names', () => {
    const snap = buildBugReportSnapshot(ALL_ON, SAMPLE_SHAPE)
    const json = JSON.stringify(snap)
    // These keys must never appear — they would indicate financial data leakage
    const forbidden = ['amount', 'balance', 'description', 'accountId', 'categoryId', 'email']
    for (const key of forbidden) {
      expect(json).not.toContain(`"${key}"`)
    }
  })

  it('limits recentNavigation to last 10 events', () => {
    clearBuffer()
    for (let i = 0; i < 15; i++) {
      trackNavigation(`/page-${i}`)
    }
    const snap = buildBugReportSnapshot(ALL_ON)
    expect(snap.recentNavigation).toHaveLength(10)
    expect(snap.recentNavigation[9].route).toBe('/page-14')
  })

  it('limits recentActions to last 20 events', () => {
    clearBuffer()
    for (let i = 0; i < 25; i++) {
      trackAction(`action_${i}`)
    }
    const snap = buildBugReportSnapshot(ALL_ON)
    expect(snap.recentActions).toHaveLength(20)
    expect((snap.recentActions[19] as { name: string }).name).toBe('action_24')
  })
})
