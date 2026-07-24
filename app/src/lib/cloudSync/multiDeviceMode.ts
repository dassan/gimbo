// F-28 Nível 2, Fase 1 — CS-16: on/off switch for multi-device mode. A device-local UI
// preference, not financial data, so it lives in localStorage rather than the DataFile (mirrors
// how the backup-dir handle itself is stored outside the synced data in lib/backupDir.ts).

const KEY = 'gimbo_multi_device_enabled'

export function isMultiDeviceEnabled(): boolean {
  return localStorage.getItem(KEY) === '1'
}

export function setMultiDeviceEnabled(enabled: boolean): void {
  if (enabled) {
    localStorage.setItem(KEY, '1')
  } else {
    localStorage.removeItem(KEY)
  }
}

// Background polling cadence (usability follow-up, 2026-07-24): there is no way to be notified
// when a peer's file changes on disk, so periodic polling is the only available mechanism while
// the app is open. Default 1h balances "two machines with open sessions" (common) against
// needless wake-ups; the user can tighten or loosen it in Settings.
export const SYNC_POLL_INTERVAL_OPTIONS_MINUTES = [10, 30, 60, 120, 480] as const
export type SyncPollIntervalMinutes = (typeof SYNC_POLL_INTERVAL_OPTIONS_MINUTES)[number]

const POLL_INTERVAL_KEY = 'gimbo_sync_poll_interval_minutes'
const DEFAULT_POLL_INTERVAL_MINUTES: SyncPollIntervalMinutes = 60

export function getSyncPollIntervalMinutes(): SyncPollIntervalMinutes {
  const raw = localStorage.getItem(POLL_INTERVAL_KEY)
  const parsed = raw ? Number(raw) : NaN
  return (SYNC_POLL_INTERVAL_OPTIONS_MINUTES as readonly number[]).includes(parsed)
    ? (parsed as SyncPollIntervalMinutes)
    : DEFAULT_POLL_INTERVAL_MINUTES
}

export function setSyncPollIntervalMinutes(minutes: SyncPollIntervalMinutes): void {
  localStorage.setItem(POLL_INTERVAL_KEY, String(minutes))
}
