import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { useDataStore } from '@/store/useDataStore'
import { storage } from '@/services/storage'
import { validateDataFile } from '@/lib/storage/schema'
import { isDemoMode, loadDemoData } from '@/lib/demo'
import { clearBackupDirHandle } from '@/lib/backupDir'
import AppLayout from '@/components/AppLayout'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import Onboarding from '@/pages/Onboarding'
import Dashboard from '@/pages/Dashboard'
import Transactions from '@/pages/Transactions'
import Analytics from '@/pages/Analytics'
import Settings from '@/pages/Settings'
import CreditCardPage from '@/pages/CreditCard'
import About from '@/pages/About'
import NetWorth from '@/pages/NetWorth'
import Health from '@/pages/Health'
import WhyBrowserStorage from '@/pages/Docs/WhyBrowserStorage'
import BackupLocal from '@/pages/Docs/BackupLocal'
import CloudSync from '@/pages/Docs/CloudSync'
import PrivacyPolicy from '@/pages/Legal/PrivacyPolicy'
import TermsOfService from '@/pages/Legal/TermsOfService'

export default function App() {
  const initWorkspace = useWorkspaceStore((s) => s.init)
  const theme = useWorkspaceStore((s) => s.workspace.theme)
  const loadData = useDataStore((s) => s.loadData)
  const refreshRecurrenceHorizons = useDataStore((s) => s.refreshRecurrenceHorizons)
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

        if (isDemoMode()) {
          loadData(await loadDemoData())
          refreshRecurrenceHorizons()
          return
        }

        if (import.meta.env.DEV) {
          const params = new URLSearchParams(window.location.search)
          if (params.has('devSeed')) {
            const res = await fetch('/dev/seed.json')
            const data = validateDataFile((await res.json()) as unknown)
            await storage.replaceAll(data)
            window.history.replaceState(null, '', window.location.pathname)
            loadData(data)
            setHydrated(true)
            return
          }
          if (params.has('devReset')) {
            await storage.clearAll()
            await clearBackupDirHandle()
            localStorage.clear()
            window.history.replaceState(null, '', window.location.pathname)
            setHydrated(true)
            return
          }
        }

        const saved = await storage.loadDataFile()
        if (saved) {
          loadData(saved)
          refreshRecurrenceHorizons()
        }
      } catch (err) {
        setInitError(err instanceof Error ? err.message : 'Erro ao carregar dados locais')
      } finally {
        setHydrated(true)
      }
    }
    void init()
  }, [initWorkspace, loadData, refreshRecurrenceHorizons])

  if (!hydrated) return null

  if (initError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface p-8 text-center">
        <p className="text-sm font-semibold text-on-surface">
          Não foi possível carregar seus dados
        </p>
        <p className="max-w-xs text-xs text-on-surface/50">{initError}</p>
      </div>
    )
  }

  const isLoaded = data !== null

  return (
    <ErrorBoundary fallback="full-page">
      <BrowserRouter>
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />

          {isLoaded ? (
            <Route element={<AppLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/net-worth" element={<NetWorth />} />
              <Route path="/health" element={<Health />} />
              <Route path="/credit-card/:accountId" element={<CreditCardPage />} />
              <Route path="/gimbo" element={<About />} />
              <Route path="/docs/why-browser-storage" element={<WhyBrowserStorage />} />
              <Route path="/docs/backup-local" element={<BackupLocal />} />
              <Route path="/docs/cloud-sync" element={<CloudSync />} />
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
