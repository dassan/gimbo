// F-28 Nível 2 — usability follow-up (2026-07-24), extended for Fase 2 (Google Drive): periodic
// background sync.
//
// Neither transport can be notified when a peer/Drive file changes — with no push mechanism,
// two machines (or a desktop + the Drive web UI) that both stay "open" all day would otherwise
// only ever sync once, at boot. This module adds the only mechanism available: polling, at a
// user-configurable interval (multiDeviceMode.ts) shared by both transports.

import { useDataStore } from '@/store/useDataStore'
import { isGoogleConnected } from './googleAuth'
import { getSyncPollIntervalMinutes, isMultiDeviceEnabled } from './multiDeviceMode'

let timer: ReturnType<typeof setTimeout> | null = null

async function tick(): Promise<void> {
  // Skip a background/hidden tab — no point paying the I/O cost for a session the user isn't
  // looking at; it'll catch up next time it's foregrounded or on the next tick after that.
  const transportConfigured = isGoogleConnected() || isMultiDeviceEnabled()
  if (transportConfigured && document.visibilityState === 'visible') {
    await useDataStore.getState().runPeerSync()
  }
  scheduleNext()
}

function scheduleNext(): void {
  if (timer) clearTimeout(timer)
  const minutes = getSyncPollIntervalMinutes()
  timer = setTimeout(() => void tick(), minutes * 60_000)
}

/** Starts the background polling loop. Call once at app boot. */
export function startSyncPolling(): void {
  scheduleNext()
}

/**
 * Re-reads the configured interval and restarts the wait. Call right after the user changes it
 * in Settings so the new cadence applies immediately, instead of finishing out the old interval.
 */
export function rescheduleSyncPolling(): void {
  scheduleNext()
}

/** Test-only: stop the loop so a pending timer doesn't leak into the next test file. */
export function stopSyncPolling(): void {
  if (timer) clearTimeout(timer)
  timer = null
}
