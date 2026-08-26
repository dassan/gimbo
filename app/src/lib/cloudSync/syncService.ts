// F-28 Nível 2, Fase 2 — CS-06: orchestrates pull+merge and push for the Google Drive transport.
// Staleness is judged the same way as Fase 1's folderSyncService (CS-15): a persisted "last
// remote version this device has already pulled" cache, not `settings.fileUpdatedAt`. A device
// with a freshly created (empty) local vault gets a brand-new `fileUpdatedAt` — comparing that
// against the Drive file's `modifiedTime` made a new device's empty vault look "newer" than a
// Drive file full of real data, silently skipping the pull it needed most (CS-22).

import { storage } from '@/services/storage'
import type { DataFile } from '@/types'
import { isGoogleConnected } from './googleAuth'
import { createGoogleDriveProvider } from './googleDrive'
import { mergeForSync } from './merge'
import type { SyncResult } from './provider'
import { measureSync, measureSyncCompute, trackSyncBytes } from './syncMetrics'
import { diffTransactions } from '@/lib/storage/transactionDiff'

const LAST_PULLED_KEY = 'gimbo_sync_drive_last_pulled_mtime'

function getLastPulledRemoteModifiedTime(): string {
  return localStorage.getItem(LAST_PULLED_KEY) ?? ''
}

function setLastPulledRemoteModifiedTime(modifiedTime: string): void {
  // Cache only — never financial data, safe in localStorage (same reasoning as
  // folderSyncService's LAST_MERGED_KEY_PREFIX): worst case on loss is one redundant re-pull of
  // an already-merged remote, harmless because mergeForSync is idempotent (CS-05).
  localStorage.setItem(LAST_PULLED_KEY, modifiedTime)
}

/**
 * Pulls the Drive file (if newer than local), merges it in, and pushes the result back. First
 * connection ever (no file on Drive yet) just uploads the local vault as-is.
 */
export async function pullAndMerge(local: DataFile): Promise<SyncResult> {
  if (!isGoogleConnected()) return { status: 'offline' }
  return measureSync('sync.pullAndMerge.total', () => pullAndMergeInner(local))
}

async function pullAndMergeInner(local: DataFile): Promise<SyncResult> {
  const provider = createGoogleDriveProvider()

  try {
    const exists = await provider.fileExists()
    if (!exists) {
      await provider.upload(await storage.exportBlob())
      return { status: 'synced' }
    }

    const meta = await provider.getMetadata()
    if (meta.modifiedTime <= getLastPulledRemoteModifiedTime()) {
      return { status: 'synced' } // this device already pulled this exact remote version
    }

    const buffer = await provider.download()
    const result = await measureSync('sync.readPeerBlob', () =>
      storage.readPeerBlob(new Blob([buffer]))
    )
    if (result.status === 'skipped') {
      return { status: 'skipped', reason: result.reason }
    }
    // CS-36: quantas partições o hash-skip (Fase 2b) de fato pulou nesta leitura, pra a próxima
    // rodada de dado real distinguir "hash bateu e pulou" de "primeiro sync, tudo diverge mesmo".
    trackSyncBytes('sync.readPeer.tablesSkipped', result.stats.tablesSkipped)
    trackSyncBytes('sync.readPeer.tablesTotal', result.stats.tablesTotal)
    trackSyncBytes('sync.readPeer.yearsSkipped', result.stats.yearsSkipped)
    trackSyncBytes('sync.readPeer.yearsTotal', result.stats.yearsTotal)

    const mergedData = measureSyncCompute('sync.merge', () => mergeForSync(local, result.data))
    // CS-30 (Fase 1): baseline lido do disco agora, não `local` — o pull acima pode ter levado
    // segundos a minutos (Drive/wifi lento), e uma edição concorrente pode já ter avançado o
    // disco além do snapshot recebido como parâmetro (mesmo cuidado do CS-24). applyMutation
    // (M-73) só reescreve as linhas de fato diferentes, em vez do cofre inteiro a cada sync.
    const baseline = await measureSync('sync.loadBaseline', () => storage.loadDataFile())
    const delta = baseline
      ? diffTransactions(baseline.transactions, mergedData.transactions)
      : { upserts: mergedData.transactions, deletedIds: [] }
    await measureSync('sync.applyMutation', () => storage.applyMutation(mergedData, delta))
    await provider.upload(await storage.exportBlob())
    setLastPulledRemoteModifiedTime(meta.modifiedTime)
    return { status: 'merged', peersMerged: 1, data: mergedData }
  } catch {
    // Network/API failure (offline, revoked access, Drive outage...) — never fatal, the app
    // keeps working off the local OPFS copy and retries on the next boot/poll tick/mutation.
    return { status: 'offline' }
  }
}

/**
 * Uploads the local vault to Drive if it changed since the last known Drive state.
 * Returns whether Drive is now confirmed in sync (true) or the attempt failed and will be
 * retried later (false, B-23) — callers use this to know whether "last synced" truly advanced,
 * since a network/API failure here is swallowed (non-fatal) rather than thrown.
 */
export async function pushIfNeeded(local: DataFile): Promise<boolean> {
  if (!isGoogleConnected()) return false
  const provider = createGoogleDriveProvider()

  try {
    const exists = await provider.fileExists()
    if (!exists) {
      await provider.upload(await storage.exportBlob())
      return true
    }
    const meta = await provider.getMetadata()
    if (local.settings.fileUpdatedAt > meta.modifiedTime) {
      await provider.upload(await storage.exportBlob())
    }
    return true
  } catch {
    // non-fatal — retried on the next mutation debounce or poll tick
    return false
  }
}
