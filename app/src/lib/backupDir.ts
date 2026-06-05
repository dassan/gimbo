import { openDB } from 'idb'

// File System Access API methods not yet included in TypeScript's DOM lib typings.
declare global {
  interface FileSystemHandle {
    queryPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
    requestPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  }
  interface Window {
    showDirectoryPicker(options?: {
      id?: string
      mode?: 'read' | 'readwrite'
      startIn?:
        | FileSystemHandle
        | 'desktop'
        | 'documents'
        | 'downloads'
        | 'music'
        | 'pictures'
        | 'videos'
    }): Promise<FileSystemDirectoryHandle>
  }
}

const DB_NAME = 'gimbo-handles'
const STORE_NAME = 'handles'
const BACKUP_DIR_KEY = 'backupDir'

async function getDb() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE_NAME)
    },
  })
}

export async function saveBackupDirHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await getDb()
  await db.put(STORE_NAME, handle, BACKUP_DIR_KEY)
}

export async function loadBackupDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await getDb()
  const handle: unknown = await db.get(STORE_NAME, BACKUP_DIR_KEY)
  return (handle as FileSystemDirectoryHandle | undefined) ?? null
}

export async function clearBackupDirHandle(): Promise<void> {
  const db = await getDb()
  await db.delete(STORE_NAME, BACKUP_DIR_KEY)
}

export async function ensureBackupDirPermission(
  handle: FileSystemDirectoryHandle
): Promise<boolean> {
  const perm = await handle.queryPermission({ mode: 'readwrite' })
  if (perm === 'granted') return true
  const requested = await handle.requestPermission({ mode: 'readwrite' })
  return requested === 'granted'
}

export async function writeBackupToDir(
  handle: FileSystemDirectoryHandle,
  blob: Blob
): Promise<void> {
  const fileHandle = await handle.getFileHandle('gimbo-backup.db', { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(blob)
  await writable.close()
}

export async function readBackupFromDir(handle: FileSystemDirectoryHandle): Promise<File | null> {
  try {
    const fileHandle = await handle.getFileHandle('gimbo-backup.db')
    return await fileHandle.getFile()
  } catch {
    return null
  }
}
