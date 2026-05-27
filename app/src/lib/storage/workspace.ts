import type { WorkspaceFile } from '@/types'

const WORKSPACE_KEY = 'nexus_workspace'

export function loadWorkspace(): WorkspaceFile | null {
  const raw = localStorage.getItem(WORKSPACE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as WorkspaceFile
  } catch {
    return null
  }
}

export function saveWorkspace(workspace: WorkspaceFile): void {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace))
}
