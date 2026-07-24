// F-28 Nível 2, Fase 1 — CS-14: shared-folder transport, the first real implementation of
// `CloudProvider`. Writes exclusively to `<pasta>/gimbo/device-<id>.db` — the Gimbo never writes
// into another device's file. That's what eliminates the Nível 1 conflict-copy footgun by
// construction: no file ever has two writers, so the user's cloud client never sees a concurrent
// write to reconcile.

import { ensureBackupDirPermission, loadBackupDirHandle } from '@/lib/backupDir'
import type { CloudProvider } from './provider'

const SYNC_SUBDIR = 'gimbo'

export interface PeerFile {
  deviceId: string
  lastModified: number
  handle: FileSystemFileHandle
}

function fileName(deviceId: string): string {
  return `device-${deviceId}.db`
}

function peerDeviceIdFromFileName(name: string): string | null {
  const match = /^device-(.+)\.db$/.exec(name)
  return match ? match[1] : null
}

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  const handle = await loadBackupDirHandle()
  if (!handle) throw new Error('folderProvider: no shared folder configured')
  const granted = await ensureBackupDirPermission(handle)
  if (!granted) throw new Error('folderProvider: shared folder permission not granted')
  return handle
}

async function getSyncDir(create: boolean): Promise<FileSystemDirectoryHandle> {
  const root = await getRoot()
  return root.getDirectoryHandle(SYNC_SUBDIR, { create })
}

export function createFolderProvider(deviceId: string): CloudProvider & {
  listPeers(): Promise<PeerFile[]>
  removePeer(peerDeviceId: string): Promise<void>
} {
  let connected = false

  return {
    isConnected(): boolean {
      return connected
    },

    async upload(blob: Blob): Promise<void> {
      const dir = await getSyncDir(true)
      const fileHandle = await dir.getFileHandle(fileName(deviceId), { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(blob)
      await writable.close()
      connected = true
    },

    async download(): Promise<ArrayBuffer> {
      const dir = await getSyncDir(false)
      const fileHandle = await dir.getFileHandle(fileName(deviceId))
      const file = await fileHandle.getFile()
      connected = true
      return file.arrayBuffer()
    },

    async getMetadata(): Promise<{ modifiedTime: string }> {
      const dir = await getSyncDir(false)
      const fileHandle = await dir.getFileHandle(fileName(deviceId))
      const file = await fileHandle.getFile()
      connected = true
      return { modifiedTime: new Date(file.lastModified).toISOString() }
    },

    /** Every other device's file in the sync subfolder — never the caller's own. */
    async listPeers(): Promise<PeerFile[]> {
      let dir: FileSystemDirectoryHandle
      try {
        dir = await getSyncDir(false)
      } catch {
        // No shared folder configured yet, permission denied, or "gimbo/" doesn't exist yet
        // (first device to enable multi-device mode) — all equally "no peers to read".
        return []
      }

      const peers: PeerFile[] = []
      for await (const entry of dir.values()) {
        if (entry.kind !== 'file') continue
        const peerDeviceId = peerDeviceIdFromFileName(entry.name)
        if (!peerDeviceId || peerDeviceId === deviceId) continue
        const file = await entry.getFile()
        peers.push({ deviceId: peerDeviceId, lastModified: file.lastModified, handle: entry })
      }
      connected = true
      return peers
    },

    /** S-19: removing an orphaned device is always a deliberate user action, never automatic. */
    async removePeer(peerDeviceId: string): Promise<void> {
      const dir = await getSyncDir(false)
      await dir.removeEntry(fileName(peerDeviceId))
    },
  }
}
