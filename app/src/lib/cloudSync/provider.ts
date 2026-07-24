// F-28 Nível 2 — CS-19 (TASK-CS-01): transport interface for multi-device sync.
//
// Deliberately thin: pure I/O, no domain logic. `folderProvider.ts` (Fase 1), `googleDrive.ts`
// (Fase 2) and `dropboxDrive.ts` (Fase 3) all implement this same shape — the merge engine
// (`merge.ts`) and any orchestration layer must only ever depend on `CloudProvider`, never on a
// concrete transport.

export interface CloudProvider {
  upload(blob: Blob): Promise<void>
  download(): Promise<ArrayBuffer>
  getMetadata(): Promise<{ modifiedTime: string }>
  isConnected(): boolean
}

export type SyncResult =
  | { status: 'synced' } // nothing to do
  | { status: 'merged'; peersMerged: number } // a merge happened
  | { status: 'skipped'; reason: 'unreadable' | 'newer-schema' }
  | { status: 'offline' }
  | { status: 'error'; message: string }
