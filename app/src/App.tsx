import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { useDataStore } from '@/store/useDataStore'
import { loadFromIdb, loadFileHandle, clearIdb } from '@/lib/storage/indexedDb'
import { checkHandlePermission } from '@/lib/storage/fileSystem'
import { initTabGuard } from '@/lib/tabGuard'
import { storage } from '@/services/storage'
import AppLayout from '@/components/AppLayout'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import Onboarding from '@/pages/Onboarding'
import Dashboard from '@/pages/Dashboard'
import Transactions from '@/pages/Transactions'
import Analytics from '@/pages/Analytics'
import Settings from '@/pages/Settings'
import CreditCardPage from '@/pages/CreditCard'
import About from '@/pages/About'

export default function App() {
  const initWorkspace = useWorkspaceStore((s) => s.init)
  const theme = useWorkspaceStore((s) => s.workspace.theme)
  const loadData = useDataStore((s) => s.loadData)
  const data = useDataStore((s) => s.data)
  const [hydrated, setHydrated] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)

  useEffect(() => {
    const root = document.documentElement

    if (theme === 'dark') {
      root.classList.add('dark')
      return
    }

    if (theme === 'light') {
      root.classList.remove('dark')
      return
    }

    // system: follow prefers-color-scheme
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (matches: boolean) => root.classList.toggle('dark', matches)
    apply(mq.matches)
    mq.addEventListener('change', (e) => apply(e.matches))
    return () => mq.removeEventListener('change', (e) => apply(e.matches))
  }, [theme])

  useEffect(() => {
    async function init() {
      try {
        initWorkspace()

        // Primary store: SQLite (OPFS via wa-sqlite)
        let saved = await storage.loadDataFile()

        // Legacy migration: if SQLite is empty but IDB has data from the old
        // JSON-based storage, migrate once and clear IDB.
        if (!saved) {
          const legacyData = await loadFromIdb()
          if (legacyData) {
            await storage.replaceAll(legacyData)
            await clearIdb()
            saved = legacyData
          }
        }

        if (saved) loadData(saved)

        // Restore FSA file handle for disk-backup sync (kept as explicit action).
        const handle = await loadFileHandle()
        if (handle) {
          const state = await checkHandlePermission(handle)
          if (state === 'prompt') {
            useDataStore.setState({ permissionNeeded: true })
          } else if (state === 'denied') {
            useDataStore.setState({ fileHandleLost: true })
          }
          // 'granted' → handle injected into _dataHandle by checkHandlePermission
        }
      } catch (err) {
        setInitError(err instanceof Error ? err.message : 'Erro ao carregar dados locais')
      } finally {
        setHydrated(true)
      }
    }
    void init()
  }, [initWorkspace, loadData])

  useEffect(() => {
    return initTabGuard(
      () => useDataStore.setState({ isSecondaryTab: true }),
      () => useDataStore.setState({ isSecondaryTab: false })
    )
  }, [])

  // Avoid flash of onboarding while storage is loading
  if (!hydrated) return null

  if (initError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface p-8 text-center">
        <p className="text-sm font-semibold text-on-surface">
          Não foi possível carregar seus dados
        </p>
        <p className="max-w-sm text-xs text-on-surface/50">{initError}</p>
      </div>
    )
  }

  const isLoaded = data !== null

  return (
    <ErrorBoundary fallback="full-page">
      <BrowserRouter>
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />

          {isLoaded ? (
            <Route element={<AppLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/credit-card/:accountId" element={<CreditCardPage />} />
              <Route path="/gimbo" element={<About />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          ) : (
            <Route path="*" element={<Navigate to="/onboarding" replace />} />
          )}
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
