import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FlaskConical } from 'lucide-react'
import { useDataStore } from '@/store/useDataStore'
import { isDemoMode } from '@/lib/demo'
import { useTrackNavigation } from '@/hooks/useTrackNavigation'
import Navbar from '@/components/Navbar'
import FAB from '@/components/FAB'
import TransactionDrawer from '@/components/TransactionDrawer'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import type { Transaction } from '@/types'

export interface AppLayoutContext {
  openTransactionDrawer: (tx?: Transaction) => void
}

const NO_FAB_ROUTES = ['/settings']

export default function AppLayout() {
  const { t } = useTranslation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingTx, setEditingTx] = useState<Transaction | undefined>(undefined)
  const location = useLocation()

  useTrackNavigation()

  const data = useDataStore((s) => s.data)

  const showFAB = !NO_FAB_ROUTES.some((r) => location.pathname.startsWith(r))

  const initials = data?.user.name
    ? data.user.name
        .split(' ')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'U'

  function openTransactionDrawer(tx?: Transaction) {
    setEditingTx(tx)
    setDrawerOpen(true)
  }

  function handleDrawerClose() {
    setDrawerOpen(false)
    setEditingTx(undefined)
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      {/* Navbar: desktop top bar + mobile bottom nav.
          onNewTransaction wires the bottom nav + button to the same drawer. */}
      <Navbar initials={initials} onNewTransaction={() => openTransactionDrawer()} />

      {isDemoMode() && (
        <div className="fixed top-14 left-0 right-0 z-40 flex items-center justify-center gap-2 bg-amber-400 px-6 py-2.5 text-xs font-medium text-amber-950">
          <FlaskConical size={14} strokeWidth={2} className="shrink-0" />
          <span>{t('demo.banner')}</span>
        </div>
      )}

      {/* max-sm: compensate for the full nav height (h-16 = 4rem + device safe area).
          On desktop (sm+) the bottom nav is hidden, so no padding needed. */}
      <main
        className={`flex-1 max-sm:pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0 ${isDemoMode() ? 'pt-24' : 'pt-14'}`}
      >
        <ErrorBoundary fallback="card">
          <Outlet context={{ openTransactionDrawer } satisfies AppLayoutContext} />
        </ErrorBoundary>
      </main>

      {/* FAB: desktop only — mobile uses the + button in the bottom nav (MB-02) */}
      {showFAB && (
        <div className="hidden sm:block">
          <FAB onClick={() => openTransactionDrawer()} />
        </div>
      )}

      <TransactionDrawer open={drawerOpen} onClose={handleDrawerClose} transaction={editingTx} />
    </div>
  )
}
