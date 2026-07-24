// F-28 Nível 2, Fase 1 — usability follow-up (2026-07-24): periodic background sync.
//
// syncFromPeers() only ever runs at boot or on manual "Sincronizar agora" — with no way to be
// notified when a peer writes a new file, two machines that both stay open all day would
// otherwise never see each other's changes again after their first load. This module adds the
// only mechanism available: polling, at a user-configurable interval (multiDeviceMode.ts).

import { useDataStore } from '@/store/useDataStore'
import { getSyncPollIntervalMinutes, isMultiDeviceEnabled } from './multiDeviceMode'

let timer: ReturnType<typeof setTimeout> | null = null

async function tick(): Promise<void> {
  // Skip a background/hidden tab — no point paying the I/O cost for a session the user isn't
  // looking at; it'll catch up next time it's foregrounded or on the next tick after that.
  if (isMultiDeviceEnabled() && document.visibilityState === 'visible') {
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
