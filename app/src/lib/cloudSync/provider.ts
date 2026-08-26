// F-28 Nível 2 — CS-19 (TASK-CS-01): transport interface for multi-device sync.
//
// Deliberately thin: pure I/O, no domain logic. `folderProvider.ts` (Fase 1), `googleDrive.ts`
// (Fase 2) and `dropboxDrive.ts` (Fase 3) all implement this same shape — the merge engine
// (`merge.ts`) and any orchestration layer must only ever depend on `CloudProvider`, never on a
// concrete transport.

import type { DataFile } from '@/types'

export interface CloudProvider {
  upload(blob: Blob): Promise<void>
  download(): Promise<ArrayBuffer>
  getMetadata(): Promise<{ modifiedTime: string }>
  isConnected(): boolean
}

export type SyncResult =
  | { status: 'synced' } // nothing to do
  // CS-35: carries the merged DataFile the sync module already computed and persisted — the
  // caller (useDataStore's runPeerSync) used to throw this away and pay for a full
  // storage.loadDataFile() (whole-vault re-read) just to get an equivalent copy back.
  | { status: 'merged'; peersMerged: number; data: DataFile }
  | { status: 'skipped'; reason: 'unreadable' | 'newer-schema' }
  | { status: 'offline' }
  | { status: 'error'; message: string }
