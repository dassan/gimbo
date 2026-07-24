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
