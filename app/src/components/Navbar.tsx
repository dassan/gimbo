import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Settings,
  Bell,
  Home,
  Receipt,
  Plus,
  BarChart2,
  Cloud,
  CloudOff,
  DatabaseBackup,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDataStore } from '@/store/useDataStore'
import { isMultiDeviceEnabled } from '@/lib/cloudSync/multiDeviceMode'
import { isGoogleConnected } from '@/lib/cloudSync/googleAuth'
import { loadBackupDirHandle } from '@/lib/backupDir'

const NAV_ITEMS = [
  { to: '/dashboard', key: 'nav.dashboard' },
  { to: '/transactions', key: 'nav.transactions' },
  { to: '/budgets', key: 'nav.budgets' },
  { to: '/analytics', key: 'nav.analytics' },
  { to: '/net-worth', key: 'nav.netWorth' },
  { to: '/health', key: 'nav.health' },
]

// Bottom navigation items for mobile (MB-02)
// Analytics shows a "coming soon" placeholder on mobile (MB-08).
const BOTTOM_NAV_ITEMS = [
  { to: '/dashboard', key: 'nav.dashboard', icon: Home },
  { to: '/transactions', key: 'nav.transactions', icon: Receipt },
  { to: '/analytics', key: 'nav.analytics', icon: BarChart2 },
]

interface NavbarProps {
  initials?: string
  onNewTransaction?: () => void
}

export default function Navbar({ initials = 'U', onNewTransaction }: NavbarProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // Usability follow-up (CS-16), generalized for CS-09: discreet sync status indicator, hidden
  // entirely when no transport is configured. syncStatus/lastSyncedAt are shared by both the
  // Fase 1 folder transport and the Fase 2 Google Drive syncService — same badge, no retrofit.
  const syncStatus = useDataStore((s) => s.syncStatus)
  const lastSyncedAt = useDataStore((s) => s.lastSyncedAt)
  const syncConfigured = isMultiDeviceEnabled() || isGoogleConnected()

  // Nível 1 (local-folder backup, no sync) has no entry in the sync badge above — it's a plain
  // presence indicator (no syncing/error states, unlike Nível 2's syncStatus), so it only shows
  // when Nível 2 isn't already occupying the slot.
  const [hasLocalBackupDir, setHasLocalBackupDir] = useState(false)
  useEffect(() => {
    void loadBackupDirHandle().then((handle) => setHasLocalBackupDir(handle !== null))
  }, [])
  const backupLastSaved = localStorage.getItem('gimbo_backup_last_saved')

  return (
    <>
      {/* ── Desktop / tablet top bar ────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 flex h-14 items-center justify-between bg-surface-container-low/80 px-6 backdrop-blur-[24px] border-b border-outline-variant/50">
        {/* Logo + nav */}
        <div className="flex items-center gap-8">
          <span className="text-xl font-semibold tracking-tight">
            <span className="text-primary">Gim</span>
            <span style={{ color: '#D4A017' }}>bo</span>
          </span>

          {/* Desktop nav links — hidden on mobile */}
          <nav className="hidden sm:flex items-center gap-1">
            {NAV_ITEMS.map(({ to, key }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'relative px-3 py-4 text-sm font-medium transition-colors',
                    isActive ? 'text-on-surface' : 'text-on-surface/40 hover:text-on-surface/70'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {t(key)}
                    {isActive && (
                      <span className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-primary" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {syncConfigured && (
            <div
              role="status"
              aria-label={t('settings.syncBadgeLabel')}
              title={
                syncStatus === 'error' || syncStatus === 'offline'
                  ? t('settings.syncStatusOfflineGeneric')
                  : lastSyncedAt
                    ? `${t('settings.multiDeviceLastSynced')} ${new Date(lastSyncedAt).toLocaleString()}`
                    : undefined
              }
              className="hidden sm:flex h-8 w-8 items-center justify-center rounded-full"
            >
              {syncStatus === 'syncing' ? (
                <RefreshCw size={16} strokeWidth={1.75} className="animate-spin text-primary" />
              ) : syncStatus === 'error' || syncStatus === 'offline' ? (
                <CloudOff size={16} strokeWidth={1.75} className="text-tertiary" />
              ) : (
                <Cloud
                  size={16}
                  strokeWidth={1.75}
                  className={lastSyncedAt ? 'text-primary' : 'text-on-surface/30'}
                />
              )}
            </div>
          )}

          {!syncConfigured && hasLocalBackupDir && (
            <div
              role="status"
              aria-label={t('settings.localBackupBadgeLabel')}
              title={
                backupLastSaved
                  ? `${t('settings.backupLastSaved')} ${new Date(backupLastSaved).toLocaleString()}`
                  : undefined
              }
              className="hidden sm:flex h-8 w-8 items-center justify-center rounded-full"
            >
              <DatabaseBackup size={16} strokeWidth={1.75} className="text-primary" />
            </div>
          )}

          <button
            aria-label="Notificações"
            className="hidden sm:flex h-8 w-8 items-center justify-center rounded-full text-on-surface/40 hover:bg-surface-container-low hover:text-on-surface/70 transition-colors"
          >
            <Bell size={18} strokeWidth={1.5} />
          </button>

          <button
            aria-label={t('nav.settings')}
            onClick={() => {
              void navigate('/settings')
            }}
            className="hidden sm:flex h-8 w-8 items-center justify-center rounded-full text-on-surface/40 hover:bg-surface-container-low hover:text-on-surface/70 transition-colors"
          >
            <Settings size={18} strokeWidth={1.5} />
          </button>

          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-white">
            {initials}
          </div>
        </div>
      </header>

      {/* ── Mobile bottom navigation bar (MB-02) ───────────────────────────── */}
      {/* hidden on sm+ — shown only on mobile viewports */}
      {/* flex-col: icon row (h-16) sits above the safe-area padding so icons
          are never compressed by env(safe-area-inset-bottom) */}
      <nav
        aria-label="Navegação principal"
        className="sm:hidden fixed bottom-0 left-0 right-0 z-50 flex flex-col bg-surface-container-low/95 backdrop-blur-[24px] border-t border-outline-variant/50"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex h-16 items-stretch">
          {/* Left items: Dashboard + Transactions */}
          {BOTTOM_NAV_ITEMS.slice(0, 2).map(({ to, key, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
                  isActive ? 'text-primary' : 'text-on-surface/40'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={22} strokeWidth={isActive ? 2 : 1.5} />
                  <span>{t(key)}</span>
                </>
              )}
            </NavLink>
          ))}

          {/* Center: + button (replaces FAB on mobile) */}
          <div className="flex flex-1 items-center justify-center">
            <button
              onClick={onNewTransaction}
              aria-label={t('transactions.new')}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-ambient transition-transform duration-150 active:scale-[0.97] hover:brightness-110"
            >
              <Plus size={22} strokeWidth={2.5} />
            </button>
          </div>

          {/* Right items: Analytics */}
          {BOTTOM_NAV_ITEMS.slice(2).map(({ to, key, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
                  isActive ? 'text-primary' : 'text-on-surface/40'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={22} strokeWidth={isActive ? 2 : 1.5} />
                  <span>{t(key)}</span>
                </>
              )}
            </NavLink>
          ))}

          {/* Settings */}
          <button
            onClick={() => {
              void navigate('/settings')
            }}
            aria-label={t('nav.settings')}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
              'text-on-surface/40'
            )}
          >
            <Settings size={22} strokeWidth={1.5} />
            <span>{t('nav.settings')}</span>
          </button>
        </div>
      </nav>
    </>
  )
}
