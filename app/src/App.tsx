import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import i18n from '@/lib/i18n'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { useDataStore } from '@/store/useDataStore'
import { storage } from '@/services/storage'
import { validateDataFile } from '@/lib/storage/schema'
import { isDemoMode, loadDemoData } from '@/lib/demo'
import { clearBackupDirHandle } from '@/lib/backupDir'
import { startSyncPolling } from '@/lib/cloudSync/syncScheduler'
import AppLayout from '@/components/AppLayout'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import UpdateToast from '@/components/UpdateToast'
import Landing from '@/pages/Landing'
import Onboarding from '@/pages/Onboarding'
import Dashboard from '@/pages/Dashboard'
import Transactions from '@/pages/Transactions'
import Budgets from '@/pages/Budgets'
import BudgetDetail from '@/pages/Budgets/BudgetDetail'
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
import NameOrigin from '@/pages/Legal/NameOrigin'
import WhyLocalStorage from '@/pages/Legal/WhyLocalStorage'

export default function App() {
  const initWorkspace = useWorkspaceStore((s) => s.init)
  const theme = useWorkspaceStore((s) => s.workspace.theme)
  const loadData = useDataStore((s) => s.loadData)
  const refreshRecurrenceHorizons = useDataStore((s) => s.refreshRecurrenceHorizons)
  const ensureQuadrantesBatch = useDataStore((s) => s.ensureQuadrantesBatch)
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
        void i18n.changeLanguage(useWorkspaceStore.getState().workspace.locale)

        if (isDemoMode()) {
          loadData(await loadDemoData())
          refreshRecurrenceHorizons()
          ensureQuadrantesBatch()
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
          ensureQuadrantesBatch()
          // CS-15: never blocks the boot — the app hydrates from local OPFS first, sync runs
          // after in the background (no-op when multi-device mode is off).
          void useDataStore.getState().runPeerSync()
          // Usability follow-up: keep polling for peer changes while the app stays open —
          // otherwise two machines with long-lived sessions would only ever sync once, at boot.
          startSyncPolling()
        }
      } catch (err) {
        setInitError(err instanceof Error ? err.message : 'Erro ao carregar dados locais')
      } finally {
        setHydrated(true)
      }
    }
    void init()
  }, [initWorkspace, loadData, refreshRecurrenceHorizons, ensureQuadrantesBatch])

  if (!hydrated) return <UpdateToast />

  if (initError) {
    return (
      <>
        <UpdateToast />
        <BootFailure message={initError} />
      </>
    )
  }

  const isLoaded = data !== null

  return (
    <>
      <UpdateToast />
      <ErrorBoundary fallback="full-page">
        <BrowserRouter>
          <Routes>
            <Route
              path="/"
              element={isLoaded ? <Navigate to="/dashboard" replace /> : <Landing />}
            />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsOfService />} />
            <Route path="/origin" element={<NameOrigin />} />
            <Route path="/why-local-storage" element={<WhyLocalStorage />} />

            {isLoaded ? (
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/budgets" element={<Budgets />} />
                <Route path="/budgets/:budgetId" element={<BudgetDetail />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/settings/:section" element={<Settings />} />
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
    </>
  )
}

/**
 * SEC-06 — tela de falha de boot, com resgate dos dados.
 *
 * Um cofre que não abre (schema de versão futura, migration que não aplicou, arquivo corrompido)
 * antes deixava os dados trancados no OPFS sem nenhuma superfície para tirá-los de lá — o usuário
 * via só uma mensagem de erro. O botão abaixo baixa os bytes crus do `gimbo.db` **antes** de
 * qualquer tentativa de reparo, que é a ordem que importa: reparar primeiro pode destruir a única
 * cópia existente.
 *
 * Usa `storage.exportRawBlob()`, que no worker é despachado fora da fila e não depende do `init()`
 * ter concluído — a fila encadeia a partir do `initPromise` e ficaria inutilizável aqui.
 *
 * Strings fixas em pt-BR de propósito, seguindo o que esta tela já fazia: a falha pode ocorrer
 * antes de o i18n inicializar, e um resgate que renderiza chaves cruas não ajuda ninguém.
 */
function BootFailure({ message }: { message: string }) {
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle')

  async function handleRescue() {
    setState('working')
    try {
      const blob = await storage.exportRawBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `gimbo-resgate-${new Date().toISOString().slice(0, 10)}.db`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setState('done')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface p-8 text-center">
      <p className="text-sm font-semibold text-on-surface">Não foi possível carregar seus dados</p>
      <p className="max-w-xs text-xs text-on-surface/50">{message}</p>
      <p className="max-w-sm text-xs text-on-surface/70">
        Seus dados continuam guardados neste navegador. Baixe uma cópia de segurança antes de tentar
        qualquer reparo — ela pode ser importada de volta depois.
      </p>
      <button
        onClick={() => void handleRescue()}
        disabled={state === 'working'}
        className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:brightness-110 active:scale-[0.97] disabled:opacity-60"
      >
        {state === 'working' ? 'Preparando…' : 'Baixar cópia de segurança'}
      </button>
      {state === 'done' && (
        <p className="text-xs text-on-surface/50">
          Cópia baixada. Guarde o arquivo antes de qualquer outra ação.
        </p>
      )}
      {state === 'error' && (
        <p className="text-xs text-tertiary">
          Não foi possível ler o arquivo do navegador. Se você tiver um backup em pasta ou na nuvem,
          use-o para restaurar.
        </p>
      )}
    </div>
  )
}
