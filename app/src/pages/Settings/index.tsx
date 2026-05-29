import { useState, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import BugReportDialog from '@/components/BugReportDialog'
import {
  Landmark,
  Tag as TagIcon,
  FolderTree,
  User,
  Sliders,
  Database,
  Plus,
  Upload,
  Download,
  ShieldCheck,
  History,
  PlusCircle,
  Pencil,
  Trash2,
  AlertTriangle,
  X,
  PiggyBank,
  CreditCard,
  Bitcoin,
  ArrowLeftRight,
  Briefcase,
  TrendingUp,
  MoreHorizontal,
  Utensils,
  ShoppingCart,
  Car,
  Home,
  Heart,
  Plane,
  GraduationCap,
  Tv,
  Wrench,
  Gift,
} from 'lucide-react'
import { useDataStore } from '@/store/useDataStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { formatCurrency, cn, uuid, now, getCurrentInvoiceBalance } from '@/lib/utils'
import { AUDIT_RETENTION_DEFAULT } from '@/lib/storage/schema'
import { storage } from '@/services/storage'
import Toast from '@/components/Toast'
import type {
  Account,
  AccountType,
  Category,
  CategoryType,
  CreditMetadata,
  Tag,
  Locale,
  Theme,
  AuditAction,
} from '@/types'

type Section = 'accounts' | 'categories' | 'tags' | 'profile' | 'preferences' | 'data' | 'history'

// ─── Credit issuer config ─────────────────────────────────────────────────────

const CREDIT_ISSUERS: { key: string; label: string; color: string }[] = [
  { key: 'nubank', label: 'Nubank', color: '#820AD1' },
  { key: 'itau', label: 'Itaú', color: '#EC7000' },
  { key: 'bradesco', label: 'Bradesco', color: '#CC092F' },
  { key: 'inter', label: 'Inter', color: '#FF7A00' },
  { key: 'santander', label: 'Santander', color: '#EC0000' },
  { key: 'caixa', label: 'Caixa', color: '#006CB4' },
  { key: 'generic', label: '', color: '#1F2937' }, // label resolved via t('accounts.issuerGeneric')
]

// ─── Account type config ──────────────────────────────────────────────────────

const ACCOUNT_TYPES: { type: AccountType; icon: React.ReactNode }[] = [
  { type: 'RETAIL', icon: <Landmark size={20} strokeWidth={1.5} /> },
  { type: 'SAVINGS', icon: <PiggyBank size={20} strokeWidth={1.5} /> },
  { type: 'CREDIT', icon: <CreditCard size={20} strokeWidth={1.5} /> },
  { type: 'CRYPTO', icon: <Bitcoin size={20} strokeWidth={1.5} /> },
  { type: 'FOREX', icon: <ArrowLeftRight size={20} strokeWidth={1.5} /> },
  { type: 'ASSET', icon: <Briefcase size={20} strokeWidth={1.5} /> },
  { type: 'STOCKS', icon: <TrendingUp size={20} strokeWidth={1.5} /> },
  { type: 'OTHER', icon: <MoreHorizontal size={20} strokeWidth={1.5} /> },
]

// ─── Category icon config ─────────────────────────────────────────────────────

const CATEGORY_ICONS: { name: string; icon: React.ReactNode }[] = [
  { name: 'utensils', icon: <Utensils size={18} strokeWidth={1.5} /> },
  { name: 'shopping-cart', icon: <ShoppingCart size={18} strokeWidth={1.5} /> },
  { name: 'car', icon: <Car size={18} strokeWidth={1.5} /> },
  { name: 'home', icon: <Home size={18} strokeWidth={1.5} /> },
  { name: 'heart', icon: <Heart size={18} strokeWidth={1.5} /> },
  { name: 'plane', icon: <Plane size={18} strokeWidth={1.5} /> },
  { name: 'graduation-cap', icon: <GraduationCap size={18} strokeWidth={1.5} /> },
  { name: 'tv', icon: <Tv size={18} strokeWidth={1.5} /> },
  { name: 'wrench', icon: <Wrench size={18} strokeWidth={1.5} /> },
  { name: 'briefcase', icon: <Briefcase size={18} strokeWidth={1.5} /> },
  { name: 'gift', icon: <Gift size={18} strokeWidth={1.5} /> },
  { name: 'tag', icon: <TagIcon size={18} strokeWidth={1.5} /> },
]

// ─── Tag color palette ────────────────────────────────────────────────────────

const TAG_COLORS = [
  '#22c55e',
  '#3b82f6',
  '#f97316',
  '#a855f7',
  '#ef4444',
  '#06b6d4',
  '#6b7280',
  '#1f2937',
]

function categoryIcon(name: string): React.ReactNode {
  return (
    CATEGORY_ICONS.find((i) => i.name === name)?.icon ?? <TagIcon size={18} strokeWidth={1.5} />
  )
}

function accountTypeIcon(type: AccountType): React.ReactNode {
  return (
    ACCOUNT_TYPES.find((t) => t.type === type)?.icon ?? <Landmark size={18} strokeWidth={1.5} />
  )
}

// ─── Modal state ──────────────────────────────────────────────────────────────

type ModalState =
  | { open: false }
  | { open: true; account: Account | null; defaultType?: AccountType }
type CategoryModalState = { open: false } | { open: true; category: Category | null }
type TagModalState = { open: false } | { open: true; tag: Tag | null }

type ImportResult =
  | { status: 'success' }
  | { status: 'error'; message: string; code: string }
  | null

const IMPORT_ERROR_CODES = {
  CORRUPT: 'ERR_RESTORE_004',
} as const

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora mesmo'
  if (mins < 60) return `há ${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `há ${hrs}h`
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

const DATA_SECTIONS: { key: Section; icon: React.ReactNode; labelKey: string }[] = [
  {
    key: 'accounts',
    icon: <Landmark size={16} strokeWidth={1.5} />,
    labelKey: 'settings.accountsAndCards',
  },
  {
    key: 'categories',
    icon: <FolderTree size={16} strokeWidth={1.5} />,
    labelKey: 'settings.categories',
  },
  { key: 'tags', icon: <TagIcon size={16} strokeWidth={1.5} />, labelKey: 'settings.tags' },
]
const APP_SECTIONS: { key: Section; icon: React.ReactNode; labelKey: string }[] = [
  { key: 'profile', icon: <User size={16} strokeWidth={1.5} />, labelKey: 'settings.profile' },
  {
    key: 'preferences',
    icon: <Sliders size={16} strokeWidth={1.5} />,
    labelKey: 'settings.preferences',
  },
  { key: 'data', icon: <Database size={16} strokeWidth={1.5} />, labelKey: 'settings.dataFile' },
  { key: 'history', icon: <History size={16} strokeWidth={1.5} />, labelKey: 'audit.title' },
]

const ACTION_ICON: Record<AuditAction, React.ReactNode> = {
  CREATE: <PlusCircle size={14} className="text-primary" strokeWidth={2} />,
  UPDATE: <Pencil size={14} className="text-on-surface/40" strokeWidth={2} />,
  DELETE: <Trash2 size={14} className="text-tertiary" strokeWidth={2} />,
}

export default function Settings() {
  const { t, i18n } = useTranslation()
  const data = useDataStore((s) => s.data)
  const {
    addAccount,
    updateAccount,
    deleteAccount,
    addCategory,
    updateCategory,
    deleteCategory,
    addTag,
    updateTag,
    deleteTag,
    updateUser,
    setRetentionLimit,
  } = useDataStore()
  const loadData = useDataStore((s) => s.loadData)
  const { workspace, setTheme, setLocale, setAmbientShadows } = useWorkspaceStore()

  const [activeSection, setActiveSection] = useState<Section>('accounts')
  const [bugReportOpen, setBugReportOpen] = useState(false)
  const [profileName, setProfileName] = useState(data?.user.name ?? '')
  const [profileEmail, setProfileEmail] = useState(data?.user.email ?? '')
  const [modal, setModal] = useState<ModalState>({ open: false })
  const [categoryModal, setCategoryModal] = useState<CategoryModalState>({ open: false })
  const [tagModal, setTagModal] = useState<TagModalState>({ open: false })
  const [importResult, setImportResult] = useState<ImportResult>(null)
  const importDbInputRef = useRef<HTMLInputElement>(null)

  function handleSaveProfile() {
    if (!data) return
    updateUser({ name: profileName, email: profileEmail })
  }

  function handleLocaleChange(locale: Locale) {
    setLocale(locale)
    void i18n.changeLanguage(locale)
  }

  async function handleExportDb() {
    const blob = await storage.exportBlob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'gimbo-backup.db'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImportDb(file: File) {
    setImportResult(null)
    try {
      await storage.importBlob(file)
      const imported = await storage.loadDataFile()
      if (imported) loadData(imported)
      setImportResult({ status: 'success' })
    } catch {
      setImportResult({
        status: 'error',
        message: t('settings.importErrorCorrupt'),
        code: IMPORT_ERROR_CODES.CORRUPT,
      })
    }
  }

  function handleSaveAccount(
    name: string,
    type: AccountType,
    includeInBalance: boolean,
    initialBalance: number,
    creditMetadata?: CreditMetadata,
    issuerIcon?: string
  ) {
    if (modal.open && modal.account) {
      updateAccount({
        ...modal.account,
        name,
        type,
        balance: initialBalance,
        includeInBalance,
        creditMetadata,
        issuerIcon,
      })
    } else {
      addAccount({
        id: uuid(),
        name,
        type,
        balance: initialBalance,
        includeInBalance,
        creditMetadata,
        issuerIcon,
      })
    }
    setModal({ open: false })
  }

  function handleDeleteAccount(id: string) {
    deleteAccount(id)
    setModal({ open: false })
  }

  function handleSaveCategory(
    name: string,
    icon: string,
    parentId: string | null,
    type: CategoryType
  ) {
    if (categoryModal.open && categoryModal.category) {
      updateCategory({ ...categoryModal.category, name, icon, parentId, type })
    } else {
      addCategory({ id: uuid(), name, icon, parentId, type, color: '#22c55e' })
    }
    setCategoryModal({ open: false })
  }

  function handleDeleteCategory(id: string) {
    deleteCategory(id)
    setCategoryModal({ open: false })
  }

  function handleSaveTag(name: string, color: string) {
    if (tagModal.open && tagModal.tag) {
      updateTag({ ...tagModal.tag, name, color })
    } else {
      addTag({ id: uuid(), name, color })
    }
    setTagModal({ open: false })
  }

  function handleDeleteTag(id: string) {
    deleteTag(id)
    setTagModal({ open: false })
  }

  // ── Computed account balances from transactions ───────────────────────────
  // For CREDIT accounts with creditMetadata: available limit = limit − current invoice balance.
  // For CREDIT accounts without creditMetadata: 0.
  // For all other account types: standard flow (INCOME+, EXPENSE−, TRANSFER−).
  const accountBalances = useMemo<Record<string, number>>(() => {
    if (!data) return {}
    const map: Record<string, number> = {}

    // Standard flow for non-CREDIT accounts: seed with initialBalance (account.balance),
    // then apply transactions. This lets users set a starting balance at account creation.
    data.accounts
      .filter((a) => a.type !== 'CREDIT')
      .forEach((a) => {
        map[a.id] = a.balance
      })

    data.transactions.forEach((tx) => {
      const account = data.accounts.find((a) => a.id === tx.accountId)
      if (!account || account.type === 'CREDIT') return
      if (tx.type === 'INCOME') map[tx.accountId] = (map[tx.accountId] ?? 0) + tx.amount
      if (tx.type === 'EXPENSE') map[tx.accountId] = (map[tx.accountId] ?? 0) - tx.amount
      if (tx.type === 'TRANSFER') {
        map[tx.accountId] = (map[tx.accountId] ?? 0) - tx.amount
        if (tx.transferAccountId) {
          const dest = data.accounts.find((a) => a.id === tx.transferAccountId)
          if (dest && dest.type !== 'CREDIT') {
            map[tx.transferAccountId] = (map[tx.transferAccountId] ?? 0) + tx.amount
          }
        }
      }
    })

    // CREDIT accounts: available limit = creditMetadata.limit − current invoice balance
    data.accounts
      .filter((a) => a.type === 'CREDIT')
      .forEach((account) => {
        if (!account.creditMetadata) {
          map[account.id] = 0
          return
        }
        const invoiceBalance = getCurrentInvoiceBalance(data.transactions, account)
        map[account.id] = account.creditMetadata.limit - invoiceBalance
      })

    return map
  }, [data])

  const isUnlimited = data?.settings.auditLogRetentionLimit === null

  function handleRetentionToggle() {
    setRetentionLimit(isUnlimited ? AUDIT_RETENTION_DEFAULT : null)
  }

  if (!data) return null

  // Audit log in reverse chronological order
  const auditLog = [...data.auditLog].reverse()

  // Group audit entries by date
  const auditGroups = auditLog.reduce<Map<string, typeof auditLog>>((map, entry) => {
    const key = entry.timestamp.slice(0, 10)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(entry)
    return map
  }, new Map())

  function dateGroupLabel(dateKey: string) {
    const d = new Date(dateKey + 'T12:00:00')
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    if (d.toDateString() === today.toDateString()) return t('audit.today')
    if (d.toDateString() === yesterday.toDateString()) return t('audit.yesterday')
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
  }

  return (
    <>
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8">
        <h1 className="text-2xl font-bold text-on-surface mb-1">{t('settings.title')}</h1>

        {/* ── Mobile: horizontal scrollable tab bar ──────────────────────────── */}
        <div className="sm:hidden overflow-x-auto -mx-4 px-4 mt-4 pb-1">
          <div className="flex gap-2 min-w-max pb-1">
            {[...DATA_SECTIONS, ...APP_SECTIONS].map((s) => (
              <button
                key={s.key}
                onClick={() => setActiveSection(s.key)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                  activeSection === s.key
                    ? 'bg-primary text-white'
                    : 'bg-surface-container text-on-surface/60 hover:bg-surface-container-high'
                )}
              >
                {s.icon}
                {t(s.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 sm:mt-6 sm:flex sm:gap-6">
          {/* ── Sidebar — desktop only ───────────────────────────────────────── */}
          <aside className="hidden sm:block w-52 shrink-0">
            <SidebarGroup label={t('settings.dataManagement')}>
              {DATA_SECTIONS.map((s) => (
                <SidebarItem
                  key={s.key}
                  icon={s.icon}
                  label={t(s.labelKey)}
                  active={activeSection === s.key}
                  onClick={() => setActiveSection(s.key)}
                />
              ))}
            </SidebarGroup>

            <SidebarGroup label={t('settings.appSettings')} className="mt-4">
              {APP_SECTIONS.map((s) => (
                <SidebarItem
                  key={s.key}
                  icon={s.icon}
                  label={t(s.labelKey)}
                  active={activeSection === s.key}
                  onClick={() => setActiveSection(s.key)}
                />
              ))}
            </SidebarGroup>
          </aside>

          {/* ── Content ─────────────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 mt-4 sm:mt-0">
            {/* Accounts & Cards */}
            {activeSection === 'accounts' &&
              (() => {
                const nonCreditAccounts = data.accounts.filter((a) => a.type !== 'CREDIT')
                const creditAccounts = data.accounts.filter((a) => a.type === 'CREDIT')
                return (
                  <Section title={t('settings.accountsAndCards')}>
                    {/* ── Regular accounts (non-CREDIT) ──────────────────── */}
                    <div className="mb-8">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-on-surface/40 mb-3">
                        {t('settings.accounts')}
                      </p>
                      <div className="space-y-2 mb-4">
                        {nonCreditAccounts.length === 0 && (
                          <p className="py-4 text-center text-sm text-on-surface/40">
                            {t('common.noData')}
                          </p>
                        )}
                        {nonCreditAccounts.map((acc) => (
                          <button
                            key={acc.id}
                            onClick={() => setModal({ open: true, account: acc })}
                            className="flex w-full items-center gap-4 rounded-2xl bg-surface-container px-5 py-4 text-left hover:bg-surface-container-high transition-colors"
                          >
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                              <span className="text-primary">{accountTypeIcon(acc.type)}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-on-surface">{acc.name}</p>
                              <p className="text-xs text-on-surface/40">
                                {t(`accounts.${acc.type.toLowerCase()}`)}
                              </p>
                            </div>
                            <div className="text-right">
                              <span className="text-sm font-bold tabular-nums text-on-surface">
                                {formatCurrency(accountBalances[acc.id] ?? 0)}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => setModal({ open: true, account: null })}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-semibold text-white hover:brightness-110 transition-all active:scale-[0.97]"
                      >
                        <Plus size={16} strokeWidth={2.5} />
                        {t('settings.newAccount')}
                      </button>
                    </div>

                    {/* ── Credit cards (CREDIT) ────────────────────────────── */}
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-on-surface/40 mb-3">
                        {t('settings.creditCards')}
                      </p>
                      <div className="space-y-2 mb-4">
                        {creditAccounts.length === 0 && (
                          <p className="py-4 text-center text-sm text-on-surface/40">
                            {t('common.noData')}
                          </p>
                        )}
                        {creditAccounts.map((acc) => {
                          const issuerColor =
                            (acc.issuerIcon && acc.issuerIcon !== 'generic'
                              ? CREDIT_ISSUERS.find((i) => i.key === acc.issuerIcon)?.color
                              : undefined) ?? '#1F2937'
                          return (
                            <button
                              key={acc.id}
                              onClick={() => setModal({ open: true, account: acc })}
                              className="flex w-full items-center gap-4 rounded-2xl bg-surface-container px-5 py-4 text-left hover:bg-surface-container-high transition-colors"
                            >
                              <div
                                className="flex h-10 w-10 items-center justify-center rounded-xl text-white"
                                style={{ backgroundColor: issuerColor }}
                              >
                                <CreditCard size={20} strokeWidth={1.5} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-on-surface">{acc.name}</p>
                                <p className="text-xs text-on-surface/40">
                                  {t(`accounts.${acc.type.toLowerCase()}`)}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-[10px] text-on-surface/40 uppercase tracking-wide">
                                  {t('accounts.availableLimit')}
                                </p>
                                <span className="text-sm font-bold text-on-surface">
                                  {formatCurrency(accountBalances[acc.id] ?? 0)}
                                </span>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                      <button
                        onClick={() =>
                          setModal({ open: true, account: null, defaultType: 'CREDIT' })
                        }
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-semibold text-white hover:brightness-110 transition-all active:scale-[0.97]"
                      >
                        <Plus size={16} strokeWidth={2.5} />
                        {t('settings.newCreditCard')}
                      </button>
                    </div>
                  </Section>
                )
              })()}

            {/* Categories */}
            {activeSection === 'categories' && (
              <Section title={t('settings.categories')}>
                <div className="mb-4 rounded-2xl bg-primary px-5 py-4 text-white">
                  <p className="text-xs font-bold uppercase tracking-widest opacity-70">
                    {t('settings.subcategoriesTip')}
                  </p>
                  <p className="mt-1 text-sm">{t('settings.subcategoriesTipDesc')}</p>
                </div>
                <div className="space-y-2 mb-4">
                  {data.categories.length === 0 && (
                    <p className="py-4 text-center text-sm text-on-surface/40">
                      {t('common.noData')}
                    </p>
                  )}
                  {data.categories
                    .filter((c) => !c.parentId)
                    .map((parent) => (
                      <div key={parent.id}>
                        <button
                          onClick={() => setCategoryModal({ open: true, category: parent })}
                          className="flex w-full items-center gap-3 rounded-2xl bg-surface-container px-5 py-4 text-left hover:bg-surface-container-high transition-colors"
                        >
                          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                            <span className="text-primary">{categoryIcon(parent.icon)}</span>
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-on-surface">{parent.name}</p>
                            <p className="text-xs text-on-surface/40">
                              {parent.type === 'INCOME'
                                ? t('settings.categoryTypeIncome')
                                : t('settings.categoryTypeExpense')}
                            </p>
                          </div>
                        </button>
                        {data.categories
                          .filter((c) => c.parentId === parent.id)
                          .map((child) => (
                            <button
                              key={child.id}
                              onClick={() => setCategoryModal({ open: true, category: child })}
                              className="ml-6 mt-1 flex w-full items-center gap-3 rounded-xl bg-surface-container-low px-4 py-3 text-left hover:bg-surface-container-high transition-colors"
                            >
                              <div className="h-1.5 w-1.5 rounded-full bg-on-surface/20" />
                              <p className="text-sm text-on-surface/70">{child.name}</p>
                            </button>
                          ))}
                      </div>
                    ))}
                </div>
                <button
                  onClick={() => setCategoryModal({ open: true, category: null })}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-semibold text-white hover:brightness-110 transition-all active:scale-[0.97]"
                >
                  <Plus size={16} strokeWidth={2.5} />
                  {t('settings.newCategory')}
                </button>
              </Section>
            )}

            {/* Tags */}
            {activeSection === 'tags' && (
              <Section title={t('settings.tags')}>
                <div className="flex flex-wrap gap-2 mb-6">
                  {data.tags.length === 0 && (
                    <p className="text-sm text-on-surface/40">{t('common.noData')}</p>
                  )}
                  {data.tags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => setTagModal({ open: true, tag })}
                      className="rounded-full px-4 py-1.5 text-sm font-medium text-white hover:brightness-90 transition-all"
                      style={{ backgroundColor: tag.color }}
                    >
                      #{tag.name}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setTagModal({ open: true, tag: null })}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-semibold text-white hover:brightness-110 transition-all active:scale-[0.97]"
                >
                  <Plus size={16} strokeWidth={2.5} />
                  {t('settings.newTag')}
                </button>
              </Section>
            )}

            {/* Profile */}
            {activeSection === 'profile' && (
              <Section title={t('settings.profile')}>
                <div className="space-y-4">
                  <div>
                    <label className="label text-on-surface/40 block mb-1.5">
                      {t('onboarding.name')}
                    </label>
                    <input
                      type="text"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      className="w-full rounded-xl bg-surface-container-high px-4 py-3 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <div>
                    <label className="label text-on-surface/40 block mb-1.5">
                      {t('onboarding.email')}
                    </label>
                    <input
                      type="email"
                      value={profileEmail}
                      onChange={(e) => setProfileEmail(e.target.value)}
                      className="w-full rounded-xl bg-surface-container-high px-4 py-3 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <button
                    onClick={handleSaveProfile}
                    className="rounded-2xl bg-on-surface px-6 py-3 text-sm font-semibold text-white hover:brightness-110 transition-all"
                  >
                    {t('settings.saveProfile')}
                  </button>
                </div>
              </Section>
            )}

            {/* Preferences */}
            {activeSection === 'preferences' && (
              <Section title={t('settings.preferences')}>
                <div className="space-y-3">
                  <SettingRow label={t('settings.language')}>
                    <select
                      value={workspace.locale}
                      onChange={(e) => handleLocaleChange(e.target.value as Locale)}
                      className="appearance-none rounded-xl bg-surface-container-high px-4 py-2.5 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <option value="pt-BR">Português (Brasil)</option>
                      <option value="en-US">English (US)</option>
                    </select>
                  </SettingRow>

                  <SettingRow label={t('settings.theme')}>
                    <select
                      value={workspace.theme}
                      onChange={(e) => setTheme(e.target.value as Theme)}
                      className="appearance-none rounded-xl bg-surface-container-high px-4 py-2.5 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <option value="system">{t('settings.themeSystem')}</option>
                      <option value="light">{t('settings.themeLight')}</option>
                      <option value="dark">{t('settings.themeDark')}</option>
                    </select>
                  </SettingRow>

                  {/* Ambient shadows toggle (R-06) */}
                  <div className="rounded-2xl bg-surface-container px-5 py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-on-surface">{t('settings.ambientShadows')}</p>
                        <p className="text-xs text-on-surface/40 mt-0.5">
                          {t('settings.ambientShadowsDesc')}
                        </p>
                      </div>
                      <button
                        onClick={() => setAmbientShadows(!workspace.useAmbientShadows)}
                        className={cn(
                          'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
                          workspace.useAmbientShadows ? 'bg-primary' : 'bg-surface-container-high'
                        )}
                      >
                        <span
                          className={cn(
                            'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 mt-0.5',
                            workspace.useAmbientShadows ? 'translate-x-5' : 'translate-x-0.5'
                          )}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Audit log retention toggle */}
                  <div className="rounded-2xl bg-surface-container px-5 py-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-on-surface">{t('audit.retentionLabel')}</p>
                        <p className="text-xs text-on-surface/40 mt-0.5">
                          {t('audit.retentionDefault')}
                        </p>
                      </div>
                      <button
                        onClick={handleRetentionToggle}
                        className={cn(
                          'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
                          isUnlimited ? 'bg-primary' : 'bg-surface-container-high'
                        )}
                      >
                        <span
                          className={cn(
                            'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 mt-0.5',
                            isUnlimited ? 'translate-x-5' : 'translate-x-0.5'
                          )}
                        />
                      </button>
                    </div>
                    {isUnlimited && (
                      <div className="flex items-start gap-2 rounded-xl bg-tertiary/8 px-3 py-2.5">
                        <AlertTriangle
                          size={14}
                          className="text-tertiary shrink-0 mt-0.5"
                          strokeWidth={2}
                        />
                        <p className="text-xs text-tertiary">{t('audit.retentionHint')}</p>
                      </div>
                    )}
                  </div>

                  {/* Bug report */}
                  <div className="rounded-2xl bg-surface-container px-5 py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-on-surface">{t('bugReport.title')}</p>
                        <p className="mt-0.5 text-xs text-on-surface/40">
                          {t('bugReport.settingsHint')}
                        </p>
                      </div>
                      <button
                        onClick={() => setBugReportOpen(true)}
                        className="rounded-xl px-3 py-1.5 text-xs font-semibold text-on-surface hover:bg-surface-container-high"
                      >
                        {t('bugReport.openButton')}
                      </button>
                    </div>
                  </div>
                </div>
              </Section>
            )}

            {/* Data file */}
            {activeSection === 'data' && (
              <Section title={t('settings.dataFile')}>
                <div className="mb-6 rounded-2xl bg-surface-container-low p-5">
                  <p className="text-sm text-on-surface/60">{t('settings.localFirst')}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <ShieldCheck size={14} className="text-primary" strokeWidth={2} />
                    <span className="text-xs font-semibold text-primary">
                      {t('settings.privacyGuarantee')}
                    </span>
                  </div>
                </div>

                {/* Backup SQLite */}
                <div className="mb-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-on-surface/40">
                    {t('settings.backupRestore')}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => void handleExportDb()}
                      className="flex flex-col items-center gap-2 rounded-2xl bg-surface-container py-6 hover:bg-surface-container-high transition-colors"
                    >
                      <Download size={22} className="text-on-surface/60" strokeWidth={1.5} />
                      <span className="text-sm font-medium text-on-surface">
                        {t('settings.exportDb')}
                      </span>
                      <span className="text-xs text-on-surface/40">.db</span>
                    </button>
                    <button
                      onClick={() => importDbInputRef.current?.click()}
                      className="flex flex-col items-center gap-2 rounded-2xl bg-surface-container py-6 hover:bg-surface-container-high transition-colors"
                    >
                      <Upload size={22} className="text-on-surface/60" strokeWidth={1.5} />
                      <span className="text-sm font-medium text-on-surface">
                        {t('settings.importDb')}
                      </span>
                      <span className="text-xs text-on-surface/40">.db</span>
                    </button>
                    <input
                      ref={importDbInputRef}
                      type="file"
                      accept=".db"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.[0]) void handleImportDb(e.target.files[0])
                        e.target.value = ''
                      }}
                    />
                  </div>
                </div>

                {importResult?.status === 'error' && (
                  <div className="mt-3 rounded-xl border border-tertiary/20 bg-tertiary/5 p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-tertiary">{importResult.message}</p>
                      <span className="shrink-0 font-mono text-[10px] text-tertiary/70 bg-tertiary/10 rounded px-1.5 py-0.5">
                        {importResult.code}
                      </span>
                    </div>
                    <p className="text-xs text-on-surface/40">
                      {t('settings.exportLocalDataHint')}
                    </p>
                    <button
                      onClick={() => void handleExportDb()}
                      className="flex items-center gap-1.5 rounded-lg bg-surface-container px-3 py-1.5 text-xs font-medium text-on-surface hover:bg-surface-container-high transition-colors"
                    >
                      <Download size={12} strokeWidth={2} />
                      {t('settings.exportLocalData')}
                    </button>
                  </div>
                )}

                {importResult?.status === 'success' && (
                  <Toast
                    message={t('settings.importSuccess')}
                    onDismiss={() => setImportResult(null)}
                  />
                )}
              </Section>
            )}

            {/* Modification history */}
            {activeSection === 'history' && (
              <Section title={t('audit.title')} subtitle={t('audit.subtitle')}>
                {auditLog.length === 0 ? (
                  <div className="rounded-2xl bg-surface-container py-12 text-center">
                    <History
                      size={32}
                      className="mx-auto text-on-surface/20 mb-3"
                      strokeWidth={1}
                    />
                    <p className="text-sm text-on-surface/40">{t('audit.noEntries')}</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {Array.from(auditGroups.entries()).map(([dateKey, entries]) => (
                      <div key={dateKey}>
                        <p className="label text-xs font-semibold text-on-surface/40 uppercase mb-2">
                          {dateGroupLabel(dateKey)}
                        </p>
                        <div className="rounded-2xl bg-surface-container overflow-hidden">
                          {entries.map((entry, i) => (
                            <div
                              key={entry.id}
                              className={cn(
                                'flex items-center gap-3 px-5 py-3.5',
                                i < entries.length - 1 && 'border-b border-surface-container-low'
                              )}
                            >
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-container-low">
                                {ACTION_ICON[entry.action]}
                              </div>
                              <p className="flex-1 text-sm text-on-surface truncate">
                                {entry.summary}
                              </p>
                              <span className="text-xs text-on-surface/30 shrink-0">
                                {relativeTime(entry.timestamp)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            )}
          </div>
        </div>
      </div>

      {/* ── Add / Edit Account Modal ─────────────────────────────────────────── */}
      {modal.open && (
        <AddAccountModal
          account={modal.account}
          defaultType={modal.defaultType}
          onSave={handleSaveAccount}
          onDelete={handleDeleteAccount}
          onClose={() => setModal({ open: false })}
        />
      )}

      {/* ── Add / Edit Category Modal ────────────────────────────────────────── */}
      {categoryModal.open && (
        <AddCategoryModal
          category={categoryModal.category}
          topLevelCategories={data.categories.filter((c) => !c.parentId)}
          onSave={handleSaveCategory}
          onDelete={handleDeleteCategory}
          onClose={() => setCategoryModal({ open: false })}
        />
      )}

      {/* ── Add / Edit Tag Modal ─────────────────────────────────────────────── */}
      {tagModal.open && (
        <AddTagModal
          tag={tagModal.tag}
          onSave={handleSaveTag}
          onDelete={handleDeleteTag}
          onClose={() => setTagModal({ open: false })}
        />
      )}

      {/* ── Bug Report Dialog ────────────────────────────────────────────────── */}
      <BugReportDialog isOpen={bugReportOpen} onClose={() => setBugReportOpen(false)} />
    </>
  )
}

// ─── AddAccountModal ──────────────────────────────────────────────────────────

function AddAccountModal({
  account,
  defaultType = 'RETAIL',
  onSave,
  onDelete,
  onClose,
}: {
  account: Account | null
  defaultType?: AccountType
  onSave: (
    name: string,
    type: AccountType,
    includeInBalance: boolean,
    initialBalance: number,
    creditMetadata?: CreditMetadata,
    issuerIcon?: string
  ) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const isEdit = account !== null

  const [name, setName] = useState(account?.name ?? '')
  const [type, setType] = useState<AccountType>(account?.type ?? defaultType)
  // CC-11: CREDIT accounts default to excluded from balance; respect saved value in edit mode
  const [includeInBalance, setIncludeInBalance] = useState(
    account?.includeInBalance ?? (defaultType === 'CREDIT' ? false : true)
  )
  const [confirmDelete, setConfirmDelete] = useState(false)
  // M-23: issuer icon for CREDIT accounts — defaults to 'generic' (no visual branding)
  const [issuerIcon, setIssuerIcon] = useState<string>(account?.issuerIcon ?? 'generic')
  // M-33: initial balance — only for non-CREDIT accounts; pre-filled from account.balance in edit mode
  const [initialBalance, setInitialBalance] = useState<string>(
    account && account.type !== 'CREDIT' && account.balance !== 0 ? String(account.balance) : ''
  )

  // ── Credit metadata state ──────────────────────────────────────────────────
  const [creditLimit, setCreditLimit] = useState<string>(
    account?.creditMetadata?.limit !== undefined ? String(account.creditMetadata.limit) : ''
  )
  const [closingDay, setClosingDay] = useState<string>(
    account?.creditMetadata?.closingDay !== undefined
      ? String(account.creditMetadata.closingDay)
      : ''
  )
  const [dueDay, setDueDay] = useState<string>(
    account?.creditMetadata?.dueDay !== undefined ? String(account.creditMetadata.dueDay) : ''
  )

  function handleTypeSelect(selected: AccountType) {
    setType(selected)
    // CC-11: auto-deselect "include in balance" for CREDIT accounts
    if (selected === 'CREDIT') {
      setIncludeInBalance(false)
    } else {
      // Restore default for non-CREDIT types when switching (only on create)
      if (!isEdit) setIncludeInBalance(true)
      // Reset issuer icon when switching away from CREDIT
      setIssuerIcon('generic')
    }
  }

  function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) return

    // M-33: parse initial balance; CREDIT accounts always use 0 (limit is tracked separately)
    const resolvedInitialBalance = type !== 'CREDIT' ? parseFloat(initialBalance) || 0 : 0

    let creditMetadata: CreditMetadata | undefined
    let resolvedIssuerIcon: string | undefined
    if (type === 'CREDIT') {
      const limit = parseFloat(creditLimit) || 0
      const closing = parseInt(closingDay, 10)
      const due = parseInt(dueDay, 10)
      if (
        !Number.isNaN(closing) &&
        closing >= 1 &&
        closing <= 31 &&
        !Number.isNaN(due) &&
        due >= 1 &&
        due <= 31
      ) {
        creditMetadata = { limit, closingDay: closing, dueDay: due }
      }
      resolvedIssuerIcon = issuerIcon
    }

    onSave(
      trimmed,
      type,
      includeInBalance,
      resolvedInitialBalance,
      creditMetadata,
      resolvedIssuerIcon
    )
  }

  function handleDelete() {
    if (!account) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    onDelete(account.id)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-sm rounded-3xl bg-surface-container-low p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-on-surface">
            {isEdit ? t('settings.editAccount') : t('settings.addAccount')}
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-container-low transition-colors text-on-surface/40"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Account Name */}
        <div className="mb-5">
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface/40 mb-2">
            {t('settings.accountName')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
            }}
            placeholder={t('settings.accountNamePlaceholder')}
            className="w-full rounded-xl bg-surface-container-high px-4 py-3 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
            autoFocus
          />
        </div>

        {/* Bank / Institution grid */}
        <div className="mb-5">
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface/40 mb-3">
            {t('settings.bankInstitution')}
          </label>
          <div className="grid grid-cols-4 gap-2">
            {ACCOUNT_TYPES.map(({ type: t_, icon }) => (
              <button
                key={t_}
                onClick={() => handleTypeSelect(t_)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-2xl border-2 py-3 px-1 transition-all',
                  type === t_
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-transparent bg-surface-container-low text-on-surface/50 hover:border-outline-variant'
                )}
              >
                {icon}
                <span className="text-[9px] font-semibold uppercase tracking-wide leading-none">
                  {t(`accounts.${t_.toLowerCase()}`)}
                </span>
              </button>
            ))}
          </div>

          {/* M-33: Initial balance — shown only for non-CREDIT accounts */}
          {type !== 'CREDIT' && (
            <div className="mt-4">
              <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface/40 mb-2">
                {t('accounts.initialBalance')}
              </label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={initialBalance}
                onChange={(e) => setInitialBalance(e.target.value)}
                placeholder="0,00"
                className="w-full rounded-xl bg-surface-container-high px-4 py-3 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}

          {/* Credit metadata fields — shown only when type === CREDIT */}
          {type === 'CREDIT' && (
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface/40 mb-2">
                  {t('accounts.creditLimit')}
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value)}
                  placeholder="0,00"
                  className="w-full rounded-xl bg-surface-container-high px-4 py-3 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface/40 mb-2">
                    {t('accounts.closingDay')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    step={1}
                    value={closingDay}
                    onChange={(e) => setClosingDay(e.target.value)}
                    placeholder="1–31"
                    className="w-full rounded-xl bg-surface-container-high px-4 py-3 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface/40 mb-2">
                    {t('accounts.dueDay')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    step={1}
                    value={dueDay}
                    onChange={(e) => setDueDay(e.target.value)}
                    placeholder="1–31"
                    className="w-full rounded-xl bg-surface-container-high px-4 py-3 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>

              {/* M-23: Issuer icon picker */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface/40 mb-3">
                  {t('accounts.issuer')}
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {CREDIT_ISSUERS.map(({ key, label, color }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setIssuerIcon(key)}
                      className={cn(
                        'flex flex-col items-center gap-1.5 rounded-2xl border-2 py-2.5 px-1 transition-all',
                        issuerIcon === key
                          ? 'border-primary bg-primary/5'
                          : 'border-transparent bg-surface-container-low hover:border-outline-variant'
                      )}
                    >
                      <div className="h-5 w-5 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-[9px] font-semibold uppercase tracking-wide leading-none text-on-surface/60 text-center">
                        {key === 'generic' ? t('accounts.issuerGeneric') : label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Include in balance toggle */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <span className="text-sm text-on-surface/70">{t('settings.includeInBalance')}</span>
          </div>
          <button
            onClick={() => setIncludeInBalance((v) => !v)}
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
              includeInBalance ? 'bg-primary' : 'bg-surface-container-high'
            )}
          >
            <span
              className={cn(
                'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 mt-0.5',
                includeInBalance ? 'translate-x-5' : 'translate-x-0.5'
              )}
            />
          </button>
        </div>

        {/* Actions */}
        <button
          onClick={handleSave}
          disabled={!name.trim()}
          className="mb-2 flex w-full items-center justify-center rounded-2xl bg-primary py-3 text-sm font-semibold text-white hover:brightness-110 transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t('settings.saveAccount')}
        </button>
        <button
          onClick={onClose}
          className="flex w-full items-center justify-center rounded-2xl bg-surface-container-low py-3 text-sm font-semibold text-on-surface/70 hover:bg-surface-container-high transition-all"
        >
          {t('common.cancel')}
        </button>

        {/* Delete (edit mode only) */}
        {isEdit && (
          <button
            onClick={handleDelete}
            className={cn(
              'mt-4 flex w-full items-center justify-center text-sm font-semibold transition-colors',
              confirmDelete ? 'text-tertiary underline' : 'text-tertiary/60 hover:text-tertiary'
            )}
          >
            {confirmDelete
              ? `Confirmar exclusão de "${account.name}"`
              : t('settings.deleteAccount')}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── AddTagModal ──────────────────────────────────────────────────────────────

function AddTagModal({
  tag,
  onSave,
  onDelete,
  onClose,
}: {
  tag: Tag | null
  onSave: (name: string, color: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const isEdit = tag !== null

  const [name, setName] = useState(tag?.name ?? '')
  const [color, setColor] = useState(tag?.color ?? TAG_COLORS[0])
  const [confirmDelete, setConfirmDelete] = useState(false)

  function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) return
    onSave(trimmed, color)
  }

  function handleDelete() {
    if (!tag) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    onDelete(tag.id)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-sm rounded-3xl bg-surface-container-low p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-base font-semibold text-on-surface">
              {isEdit ? t('settings.editTag') : t('settings.addTag')}
            </h2>
            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/30 mt-0.5">
              {t('settings.newTag')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-container-low transition-colors text-on-surface/40"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Tag Name */}
        <div className="mb-5">
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface/40 mb-2">
            {t('settings.tagName')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
            }}
            placeholder={t('settings.tagNamePlaceholder')}
            className="w-full rounded-xl bg-surface-container-high px-4 py-3 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
            autoFocus
          />
        </div>

        {/* Accent Color */}
        <div className="mb-6">
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface/40 mb-3">
            {t('settings.accentColor')}
          </label>
          <div className="flex gap-3">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="h-8 w-8 rounded-full transition-transform hover:scale-110"
                style={{
                  backgroundColor: c,
                  outline: color === c ? `2px solid ${c}` : 'none',
                  outlineOffset: '3px',
                }}
              />
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {isEdit && (
            <button
              onClick={handleDelete}
              className={cn(
                'text-sm font-semibold transition-colors',
                confirmDelete ? 'text-tertiary underline' : 'text-tertiary/60 hover:text-tertiary'
              )}
            >
              {confirmDelete ? 'Confirmar?' : t('settings.deleteTag')}
            </button>
          )}
          <div className="flex flex-1 gap-2 justify-end">
            <button
              onClick={onClose}
              className="rounded-2xl bg-surface-container-low px-5 py-2.5 text-sm font-semibold text-on-surface/70 hover:bg-surface-container-high transition-all"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim()}
              className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110 transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('common.save')}
            </button>
          </div>
        </div>

        {/* Footer hint */}
        <div className="mt-4 flex items-start gap-2">
          <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
          <p className="text-[11px] text-on-surface/40">{t('settings.tagHint')}</p>
        </div>
      </div>
    </div>
  )
}

// ─── AddCategoryModal ─────────────────────────────────────────────────────────

function AddCategoryModal({
  category,
  topLevelCategories,
  onSave,
  onDelete,
  onClose,
}: {
  category: Category | null
  topLevelCategories: Category[]
  onSave: (name: string, icon: string, parentId: string | null, type: CategoryType) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const isEdit = category !== null

  const [name, setName] = useState(category?.name ?? '')
  const [icon, setIcon] = useState(category?.icon ?? 'tag')
  const [parentId, setParentId] = useState<string | null>(category?.parentId ?? null)
  const [type, setType] = useState<CategoryType>(category?.type ?? 'EXPENSE')
  const [confirmDelete, setConfirmDelete] = useState(false)

  function handleParentChange(value: string) {
    const pid = value === '' ? null : value
    setParentId(pid)
    if (pid) {
      const parent = topLevelCategories.find((c) => c.id === pid)
      if (parent) setType(parent.type)
    }
  }

  function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) return
    onSave(trimmed, icon, parentId, type)
  }

  function handleDelete() {
    if (!category) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    onDelete(category.id)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-sm rounded-3xl bg-surface-container-low p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-base font-semibold text-on-surface">
              {isEdit ? t('settings.editCategory') : t('settings.addCategory')}
            </h2>
            <p className="text-xs text-on-surface/40 mt-0.5">{t('settings.addCategorySub')}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-container-low transition-colors text-on-surface/40"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Category Name */}
        <div className="mb-5">
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface/40 mb-2">
            {t('settings.categoryName')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
            }}
            placeholder={t('settings.categoryNamePlaceholder')}
            className="w-full rounded-xl bg-surface-container-high px-4 py-3 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
            autoFocus
          />
        </div>

        {/* Icon Picker */}
        <div className="mb-5">
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface/40 mb-3">
            {t('settings.iconPicker')}
          </label>
          <div className="grid grid-cols-6 gap-2">
            {CATEGORY_ICONS.map(({ name: iconName, icon: iconEl }) => (
              <button
                key={iconName}
                onClick={() => setIcon(iconName)}
                className={cn(
                  'flex items-center justify-center rounded-2xl p-3 transition-all',
                  icon === iconName
                    ? 'bg-primary text-white'
                    : 'bg-surface-container-low text-on-surface/50 hover:bg-surface-container-high'
                )}
              >
                {iconEl}
              </button>
            ))}
          </div>
        </div>

        {/* Parent Category */}
        <div className="mb-5">
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface/40 mb-2">
            {t('settings.parentCategory')}
          </label>
          <select
            value={parentId ?? ''}
            onChange={(e) => handleParentChange(e.target.value)}
            className="w-full appearance-none rounded-xl bg-surface-container-high px-4 py-3 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">{t('settings.noneTopLevel')}</option>
            {topLevelCategories
              .filter((c) => !isEdit || c.id !== category?.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>

        {/* Type toggle (top-level only) */}
        {parentId === null && (
          <div className="mb-5">
            <div className="flex overflow-hidden rounded-xl">
              <button
                onClick={() => setType('EXPENSE')}
                className={cn(
                  'flex-1 py-2.5 text-sm font-medium transition-colors',
                  type === 'EXPENSE'
                    ? 'bg-primary text-white'
                    : 'bg-surface text-on-surface/50 hover:bg-surface-container-low'
                )}
              >
                {t('settings.categoryTypeExpense')}
              </button>
              <button
                onClick={() => setType('INCOME')}
                className={cn(
                  'flex-1 py-2.5 text-sm font-medium transition-colors',
                  type === 'INCOME'
                    ? 'bg-primary text-white'
                    : 'bg-surface text-on-surface/50 hover:bg-surface-container-low'
                )}
              >
                {t('settings.categoryTypeIncome')}
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        <button
          onClick={handleSave}
          disabled={!name.trim()}
          className="mb-2 flex w-full items-center justify-center rounded-2xl bg-primary py-3 text-sm font-semibold text-white hover:brightness-110 transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t('common.save')}
        </button>
        <button
          onClick={onClose}
          className="flex w-full items-center justify-center rounded-2xl bg-surface-container-low py-3 text-sm font-semibold text-on-surface/70 hover:bg-surface-container-high transition-all"
        >
          {t('common.cancel')}
        </button>

        {/* Delete (edit mode only) */}
        {isEdit && (
          <button
            onClick={handleDelete}
            className={cn(
              'mt-4 flex w-full items-center justify-center text-sm font-semibold transition-colors',
              confirmDelete ? 'text-tertiary underline' : 'text-tertiary/60 hover:text-tertiary'
            )}
          >
            {confirmDelete
              ? `Confirmar exclusão de "${category.name}"`
              : t('settings.deleteCategory')}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Page sub-components ──────────────────────────────────────────────────────

function SidebarGroup({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <p className="label mb-2 px-3 text-on-surface/40">{label}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function SidebarItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all text-left',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-on-surface/50 hover:bg-surface-container-low hover:text-on-surface/80'
      )}
    >
      <span className={active ? 'text-primary' : 'text-on-surface/40'}>{icon}</span>
      {label}
    </button>
  )
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h2 className="text-base font-semibold text-on-surface">{title}</h2>
      {subtitle && <p className="text-xs text-on-surface/40 mt-0.5 mb-4">{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}
      {children}
    </div>
  )
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-surface-container px-5 py-4">
      <span className="text-sm text-on-surface">{label}</span>
      {children}
    </div>
  )
}

void now
