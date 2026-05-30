import { openDB } from 'idb'

// queryPermission/requestPermission are part of the File System Access API
// but not yet included in TypeScript's DOM lib typings.
declare global {
  interface FileSystemHandle {
    queryPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
    requestPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
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
  const handle = await db.get(STORE_NAME, BACKUP_DIR_KEY)
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
