import type { Locale, WorkspaceFile } from '@/types'

const WORKSPACE_KEY = 'nexus_workspace'
const SUPPORTED_LOCALES: Locale[] = ['pt-BR', 'en-US']

// Only used to seed the default workspace before the user has made an explicit choice —
// once `setLocale` persists a value, that saved value always wins over the browser's.
export function detectBrowserLocale(): Locale {
  const candidates = navigator.languages ?? [navigator.language]
  for (const lang of candidates) {
    const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === lang.toLowerCase())
    if (exact) return exact
    const prefix = lang.split('-')[0].toLowerCase()
    const byPrefix = SUPPORTED_LOCALES.find((l) => l.split('-')[0].toLowerCase() === prefix)
    if (byPrefix) return byPrefix
  }
  return 'pt-BR'
}

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
