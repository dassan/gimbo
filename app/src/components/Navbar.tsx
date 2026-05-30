import { NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Settings, Bell, Home, Receipt, Plus, BarChart2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/dashboard', key: 'nav.dashboard' },
  { to: '/transactions', key: 'nav.transactions' },
  { to: '/analytics', key: 'nav.analytics' },
  { to: '/net-worth', key: 'nav.netWorth' },
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

  return (
    <>
      {/* ── Desktop / tablet top bar ────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 flex h-14 items-center justify-between bg-surface-container-low/80 px-6 backdrop-blur-[24px] border-b border-outline-variant/50">
        {/* Logo + nav */}
        <div className="flex items-center gap-8">
          <span className="text-sm font-semibold tracking-tight">
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
