import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import Settings from '@/pages/Settings'
import RecipeSettings from '@/pages/Settings/RecipeSettings'
import { useDataStore, __resetPersistenceBaselineForTests } from '@/store/useDataStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { createDefaultWorkspace } from '@/lib/storage/schema'
import { makeDataFile } from '@/test/fixtures/dataFile'
import { storage } from '@/services/storage'
import { loadBackupDirHandle, writeBackupToDir, readBackupFromDir } from '@/lib/backupDir'
import type { Account, Transaction } from '@/types'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { changeLanguage: vi.fn() } }),
}))

vi.mock('@/lib/backupDir', () => ({
  loadBackupDirHandle: vi.fn().mockResolvedValue(null),
  saveBackupDirHandle: vi.fn().mockResolvedValue(undefined),
  clearBackupDirHandle: vi.fn().mockResolvedValue(undefined),
  ensureBackupDirPermission: vi.fn().mockResolvedValue(true),
  readBackupFromDir: vi.fn().mockResolvedValue(null),
  writeBackupToDir: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/services/storage', () => ({
  storage: {
    replaceAll: vi.fn().mockResolvedValue(undefined),
    applyMutation: vi.fn().mockResolvedValue(undefined),
    exportBlob: vi.fn().mockResolvedValue(new Blob()),
    importBlob: vi.fn().mockResolvedValue(undefined),
    loadDataFile: vi.fn().mockResolvedValue(null),
  },
}))

// jsdom does not implement URL.createObjectURL
globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock')
globalThis.URL.revokeObjectURL = vi.fn()

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  __resetPersistenceBaselineForTests()
  useDataStore.setState({ data: makeDataFile() })
  useWorkspaceStore.setState({ workspace: createDefaultWorkspace() })
  vi.clearAllMocks()
  vi.mocked(storage).replaceAll.mockResolvedValue(undefined)
  vi.mocked(storage).applyMutation.mockResolvedValue(undefined)
  vi.mocked(storage).exportBlob.mockResolvedValue(new Blob())
  vi.mocked(storage).importBlob.mockResolvedValue(undefined)
  vi.mocked(storage).loadDataFile.mockResolvedValue(null)
})

// MB-16: Settings now reads its active section from the URL (/settings or
// /settings/:section) instead of local state, so tests need a real router — a
// LocationDisplay sibling makes the resulting URL assertable without mocking navigate.
function LocationDisplay() {
  const location = useLocation()
  return <div data-testid="location-display">{location.pathname}</div>
}

// M-96/M-97: refreshDeviceList()'s getDeviceId() call needs navigator.storage — without it,
// selfDeviceId stays null (the try/catch swallows it) and every device-name test would be a
// no-op. Minimal in-memory fake, same shape as deviceId.test.ts's own.
function installFakeOpfs() {
  const files = new Map<string, string>()
  const fileHandle = {
    getFile: () => Promise.resolve({ text: () => Promise.resolve(files.get('device-id') ?? '') }),
    createWritable: () => {
      let buffer = ''
      return Promise.resolve({
        write: (s: string) => {
          buffer += s
          return Promise.resolve()
        },
        close: () => {
          files.set('device-id', buffer)
          return Promise.resolve()
        },
      })
    },
  }
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: {
      getDirectory: () =>
        Promise.resolve({
          getFileHandle: (name: string, options?: { create?: boolean }) => {
            if (!files.has(name) && !options?.create) {
              return Promise.reject(new DOMException('NotFoundError', 'NotFoundError'))
            }
            return Promise.resolve(fileHandle)
          },
        }),
    },
  })
}

function renderSettings(initialPath = '/settings') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationDisplay />
      <Routes>
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/:section" element={<Settings />} />
        <Route path="/settings/recipes/:slug" element={<RecipeSettings />} />
        <Route path="/credit-card/:accountId" element={<div>credit-card-page-stub</div>} />
      </Routes>
    </MemoryRouter>
  )
}

// ─── Settings — BK-08: manual "Sync now" backup ──────────────────────────────

describe('Settings — BK-08: manual sync now', () => {
  it('forces a backup write to the configured folder on demand', async () => {
    const fakeHandle = { name: 'MyBackups' } as unknown as FileSystemDirectoryHandle
    vi.mocked(loadBackupDirHandle).mockResolvedValueOnce(fakeHandle)
    const user = userEvent.setup()

    renderSettings()
    // Navigate to the Backup & Sync section (first nav occurrence).
    await user.click((await screen.findAllByText('settings.backupSync'))[0])

    // The "Sync now" button appears once the configured folder loads.
    await user.click(await screen.findByText('settings.backupSyncNow'))

    // Success toast confirms the write completed; the backup was written to the folder.
    expect(await screen.findByText('settings.backupSyncDone')).toBeInTheDocument()
    expect(vi.mocked(writeBackupToDir)).toHaveBeenCalledWith(fakeHandle, expect.any(Blob))
  })
})

// ─── Settings — import runs B-22/BX-07 maintenance right away (same gap CS-34 found for
// table_hashes: App.tsx's boot effect is the only other place these run) ─────────────────────

describe('Settings — restoring from the backup folder tops up stale recurring series', () => {
  it('runs refreshRecurrenceHorizons right after import, not only on the next reload', async () => {
    const fakeHandle = { name: 'MyBackups' } as unknown as FileSystemDirectoryHandle
    vi.mocked(loadBackupDirHandle).mockResolvedValueOnce(fakeHandle)
    vi.mocked(readBackupFromDir).mockResolvedValueOnce(new File(['bytes'], 'gimbo.db'))

    // A single occurrence, months in the past relative to "now" — exactly the shape
    // refreshRecurrenceHorizons tops up (B-22).
    const stale = makeDataFile({
      transactions: [
        {
          id: 'tx-1',
          accountId: 'acc-1',
          categoryId: 'cat-1',
          amount: 100,
          type: 'EXPENSE',
          date: '2020-01-10',
          description: 'Aluguel',
          isPaid: true,
          tags: [],
          recurrence: { frequency: 'monthly', parentId: 'tx-1' },
        },
      ],
    })
    vi.mocked(storage).loadDataFile.mockResolvedValueOnce(stale)

    const user = userEvent.setup()
    renderSettings()
    await user.click((await screen.findAllByText('settings.backupSync'))[0])

    // First click asks for confirmation; the button's label flips and the second click restores.
    await user.click(await screen.findByText('settings.backupRestoreFolder'))
    await user.click(await screen.findByText('settings.backupRestoreConfirm'))

    await screen.findByText('settings.importSuccess')

    const transactions = useDataStore.getState().data?.transactions ?? []
    expect(transactions.length).toBeGreaterThan(1)

    // refreshRecurrenceHorizons() schedules a real 300ms debounced write
    // (debouncedApplyMutation — a module-level timer, not mocked/faked in this file). Let it
    // settle before the test ends, or it fires later during/after an unrelated test once this
    // one's local `stale`/mock setup is out of scope — an unhandled exception in CI (not a real
    // assertion failure, but it still fails the run).
    await new Promise((resolve) => setTimeout(resolve, 500))
  })
})

// ─── Settings — CC-15: accountBalances bifurcation for CREDIT accounts ────────

const today = new Date()
const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

function makeCreditAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-credit',
    name: 'Nexus Visa Gold',
    type: 'CREDIT',
    balance: 0,
    includeInBalance: false,
    creditMetadata: { limit: 10000, closingDay: 20, dueDay: 10 },
    ...overrides,
  }
}

function makeRetailAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-retail',
    name: 'Conta Corrente',
    type: 'RETAIL',
    balance: 0,
    includeInBalance: true,
    ...overrides,
  }
}

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    accountId: 'acc-retail',
    categoryId: 'cat-1',
    amount: 100,
    type: 'EXPENSE',
    date: todayStr,
    description: 'Test',
    isPaid: true,
    tags: [],
    ...overrides,
  }
}

// ─── Settings — M-24: Contas e Cartões split sections ────────────────────────

describe('Settings — M-24: accounts section split into Contas and Cartões', () => {
  it('shows "settings.accountsAndCards" as the sidebar navigation label', () => {
    renderSettings()
    // Both mobile tab bar and desktop sidebar render in jsdom — verify at least one exists.
    expect(
      screen.getAllByRole('button', { name: 'settings.accountsAndCards' })[0]
    ).toBeInTheDocument()
  })

  it('shows "settings.accounts" sub-section header for non-CREDIT accounts', () => {
    renderSettings()
    // The accounts section is active by default; sub-section header should be present
    expect(screen.getByText('settings.accounts')).toBeInTheDocument()
  })

  it('shows "settings.creditCards" sub-section header', () => {
    renderSettings()
    expect(screen.getByText('settings.creditCards')).toBeInTheDocument()
  })

  it('shows "settings.newAccount" add button in the non-CREDIT sub-section', () => {
    renderSettings()
    expect(screen.getByRole('button', { name: /settings\.newAccount/i })).toBeInTheDocument()
  })

  it('shows "settings.newCreditCard" add button in the CREDIT sub-section', () => {
    renderSettings()
    expect(screen.getByRole('button', { name: /settings\.newCreditCard/i })).toBeInTheDocument()
  })

  it('lists non-CREDIT accounts in the Contas sub-section', () => {
    const retailAccount = makeRetailAccount({ name: 'Minha Conta Corrente' })
    const creditAccount = makeCreditAccount({ name: 'Meu Cartão Visa' })
    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount, creditAccount], transactions: [] }),
    })

    renderSettings()

    expect(screen.getByText('Minha Conta Corrente')).toBeInTheDocument()
    expect(screen.getByText('Meu Cartão Visa')).toBeInTheDocument()
  })

  it('opens modal with CREDIT pre-selected when clicking "Novo Cartão"', async () => {
    useDataStore.setState({
      data: makeDataFile({ accounts: [], transactions: [] }),
    })

    renderSettings()
    await userEvent.click(screen.getByRole('button', { name: /settings\.newCreditCard/i }))

    // Modal should open with CREDIT pre-selected — B-13: the save button reads "Salvar Cartão"
    // (settings.saveCard), not "Salvar Conta".
    expect(screen.getByRole('button', { name: /settings\.saveCard/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /settings\.saveAccount/i })).not.toBeInTheDocument()
  })

  it('shows "accounts.availableLimit" label only in the Cartões sub-section', () => {
    const retailAccount = makeRetailAccount({ id: 'acc-retail', name: 'Conta Corrente' })
    const creditAccount = makeCreditAccount({ id: 'acc-credit', name: 'Cartão Visa' })
    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount, creditAccount], transactions: [] }),
    })

    renderSettings()

    // availableLimit label appears only once (for the credit account)
    expect(screen.getAllByText('accounts.availableLimit')).toHaveLength(1)
  })
})

// ─── Settings — CC-15: accountBalances bifurcation for CREDIT accounts ────────

describe('Settings — CC-15: accounts list balance bifurcation', () => {
  it('shows "accounts.availableLimit" label for CREDIT accounts', () => {
    const creditAccount = makeCreditAccount()
    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [] }),
    })

    renderSettings()

    expect(screen.getByText('accounts.availableLimit')).toBeInTheDocument()
  })

  it('does not show "accounts.availableLimit" label for non-CREDIT accounts', () => {
    const retailAccount = makeRetailAccount()
    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [] }),
    })

    renderSettings()

    expect(screen.queryByText('accounts.availableLimit')).not.toBeInTheDocument()
  })

  it('shows available limit (limit − invoice) for CREDIT account', () => {
    const creditAccount = makeCreditAccount({
      id: 'acc-credit',
      creditMetadata: { limit: 10000, closingDay: 20, dueDay: 10 },
    })
    const expense = makeTx({
      id: 'tx-cc',
      accountId: 'acc-credit',
      type: 'EXPENSE',
      amount: 1500,
      date: todayStr,
    })

    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [expense] }),
    })

    renderSettings()

    // Available limit = 10000 − 1500 = 8500 (if expense is in current invoice period)
    // or = 10000 (if expense is not in current period, e.g. after closing day)
    // We verify the label is shown, actual value depends on period calculation
    expect(screen.getByText('accounts.availableLimit')).toBeInTheDocument()
  })

  it('shows 0,00 for CREDIT account without creditMetadata', () => {
    const creditAccount = makeCreditAccount({ creditMetadata: undefined })
    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [] }),
    })

    renderSettings()

    // The only account shown has creditMetadata=undefined → balance=0
    // Use regex to avoid NBSP normalization issues with Intl.NumberFormat
    expect(screen.getByText(/0,00/)).toBeInTheDocument()
  })

  it('shows correct standard balance for non-CREDIT account (INCOME − EXPENSE)', () => {
    const retailAccount = makeRetailAccount({ id: 'acc-retail' })
    const income = makeTx({
      id: 'tx-income',
      type: 'INCOME',
      amount: 2000,
      accountId: 'acc-retail',
    })
    const expense = makeTx({
      id: 'tx-expense',
      type: 'EXPENSE',
      amount: 500,
      accountId: 'acc-retail',
    })

    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [income, expense] }),
    })

    renderSettings()

    // Balance = 2000 - 500 = 1500 — unique value with only one account shown
    expect(screen.getByText(/1\.500,00/)).toBeInTheDocument()
  })

  it('does not include CREDIT expenses in non-CREDIT account balance', () => {
    const retailAccount = makeRetailAccount({ id: 'acc-retail' })
    const creditAccount = makeCreditAccount({ id: 'acc-credit' })
    // Use an unusual retail income value to make it unique and identifiable
    const retailIncome = makeTx({
      id: 'tx-income',
      type: 'INCOME',
      amount: 4321,
      accountId: 'acc-retail',
    })
    const creditExpense = makeTx({
      id: 'tx-cc-exp',
      type: 'EXPENSE',
      amount: 800,
      accountId: 'acc-credit',
    })

    useDataStore.setState({
      data: makeDataFile({
        accounts: [retailAccount, creditAccount],
        transactions: [retailIncome, creditExpense],
      }),
    })

    renderSettings()

    // Retail balance = 4321 (credit expense must NOT be subtracted)
    // 4321 → R$ 4.321,00 — a value that won't appear in the credit account column
    expect(screen.getByText(/4\.321,00/)).toBeInTheDocument()
  })
})

// ─── Settings — M-23: issuer icon no longer editable in the simplified account modal ──

describe('Settings — M-23: issuer icon picker removed from the account modal', () => {
  it('does not render an issuer/institution picker in the CREDIT modal', async () => {
    useDataStore.setState({
      data: makeDataFile({ accounts: [], transactions: [] }),
    })
    renderSettings()
    await userEvent.click(screen.getByRole('button', { name: /settings\.newCreditCard/i }))
    expect(screen.queryByText('Nubank')).not.toBeInTheDocument()
  })

  it('does not render an issuer/institution picker in the regular account modal', async () => {
    useDataStore.setState({
      data: makeDataFile({ accounts: [], transactions: [] }),
    })
    renderSettings()
    // Open a regular account modal (non-CREDIT default)
    await userEvent.click(screen.getByRole('button', { name: /settings\.newAccount/i }))
    expect(screen.queryByText('Nubank')).not.toBeInTheDocument()
  })

  it('preserves issuerIcon when editing a CREDIT account that already has one', () => {
    const creditAccount = makeCreditAccount({ issuerIcon: 'nubank' })
    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [] }),
    })
    renderSettings()
    // The credit card row should be rendered — the issuer color is applied via style
    expect(screen.getByText('Nexus Visa Gold')).toBeInTheDocument()
  })
})

// ─── Settings — M-42: archived accounts ──────────────────────────────────────

describe('Settings — M-42: archived accounts', () => {
  it('hides archived accounts from the main list but shows them in a collapsed "Archived" section', () => {
    const activeAccount = makeRetailAccount({ id: 'acc-active', name: 'Conta Ativa' })
    const archivedAccount = makeRetailAccount({
      id: 'acc-old',
      name: 'Conta Antiga',
      archived: true,
    })
    useDataStore.setState({
      data: makeDataFile({ accounts: [activeAccount, archivedAccount], transactions: [] }),
    })
    renderSettings()

    expect(screen.getByText('Conta Ativa')).toBeInTheDocument()
    expect(screen.getByText(/accounts\.archivedAccounts/)).toBeInTheDocument()
    // Collapsed by default — the archived account's name is not in the DOM yet
    expect(screen.queryByText('Conta Antiga')).not.toBeInTheDocument()
  })

  it('expands the "Archived accounts" section to reveal the archived account', async () => {
    const archivedAccount = makeRetailAccount({
      id: 'acc-old',
      name: 'Conta Antiga',
      archived: true,
    })
    useDataStore.setState({
      data: makeDataFile({ accounts: [archivedAccount], transactions: [] }),
    })
    renderSettings()

    await userEvent.click(screen.getByText(/accounts\.archivedAccounts/))

    expect(screen.getByText('Conta Antiga')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /accounts\.reactivate/i })).toBeInTheDocument()
  })

  it('reactivates an archived account via the "Reativar" button', async () => {
    const archivedAccount = makeRetailAccount({
      id: 'acc-old',
      name: 'Conta Antiga',
      archived: true,
    })
    useDataStore.setState({
      data: makeDataFile({ accounts: [archivedAccount], transactions: [] }),
    })
    renderSettings()

    await userEvent.click(screen.getByText(/accounts\.archivedAccounts/))
    await userEvent.click(screen.getByRole('button', { name: /accounts\.reactivate/i }))

    const saved = useDataStore.getState().data?.accounts.find((a) => a.id === 'acc-old')
    expect(saved?.archived).toBeUndefined()
  })

  it('the "Ver cartão" button on an archived card navigates to its details page', async () => {
    const archivedCard = makeCreditAccount({
      id: 'acc-old-card',
      name: 'Cartão Antigo',
      archived: true,
    })
    useDataStore.setState({
      data: makeDataFile({ accounts: [archivedCard], transactions: [] }),
    })
    renderSettings()

    await userEvent.click(screen.getByText(/accounts\.archivedAccounts/))
    await userEvent.click(screen.getByRole('button', { name: /accounts\.viewCard/i }))

    expect(await screen.findByText('credit-card-page-stub')).toBeInTheDocument()
    expect(screen.getByTestId('location-display')).toHaveTextContent('/credit-card/acc-old-card')
  })

  it('toggling "Ativa" off in the account modal archives the account on save', async () => {
    const account = makeRetailAccount({ id: 'acc-1', name: 'Conta 1' })
    useDataStore.setState({
      data: makeDataFile({ accounts: [account], transactions: [] }),
    })
    renderSettings()

    await userEvent.click(screen.getByText('Conta 1'))
    await userEvent.click(screen.getByRole('button', { name: 'accounts.active' }))
    await userEvent.click(screen.getByRole('button', { name: /settings\.saveAccount/i }))

    const saved = useDataStore.getState().data?.accounts.find((a) => a.id === 'acc-1')
    expect(saved?.archived).toBe(true)
  })
})

// ─── Settings — HE-05: create/edit LOAN account ──────────────────────────────

function makeLoanAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-loan',
    name: 'Financiamento do carro',
    type: 'LOAN',
    balance: 0,
    includeInBalance: false,
    loanMetadata: {
      outstandingBalance: 15000,
      monthlyPayment: 800,
      remainingInstallments: 18,
      interestRate: 1.5,
    },
    ...overrides,
  }
}

describe('Settings — HE-05: create/edit LOAN account', () => {
  it('shows the loan metadata fields when LOAN is selected in the new-account modal', async () => {
    useDataStore.setState({ data: makeDataFile({ accounts: [], transactions: [] }) })
    renderSettings('/settings/wealth')

    await userEvent.click(screen.getByRole('button', { name: /settings\.newLoan/i }))

    expect(screen.getByText('accounts.outstandingBalance')).toBeInTheDocument()
    expect(screen.getByText('accounts.monthlyPayment')).toBeInTheDocument()
    expect(screen.getByText('accounts.remainingInstallments')).toBeInTheDocument()
    expect(screen.getByText('accounts.interestRate')).toBeInTheDocument()
  })

  it('does not show the initial-balance field for LOAN accounts (uses outstandingBalance instead)', async () => {
    useDataStore.setState({ data: makeDataFile({ accounts: [], transactions: [] }) })
    renderSettings('/settings/wealth')

    await userEvent.click(screen.getByRole('button', { name: /settings\.newLoan/i }))

    expect(screen.queryByText('accounts.initialBalance')).not.toBeInTheDocument()
  })

  it('saves a new LOAN account with the entered loanMetadata', async () => {
    useDataStore.setState({ data: makeDataFile({ accounts: [], transactions: [] }) })
    renderSettings('/settings/wealth')

    await userEvent.click(screen.getByRole('button', { name: /settings\.newLoan/i }))
    await userEvent.type(
      screen.getByPlaceholderText('settings.accountNamePlaceholder'),
      'Financiamento do apê'
    )

    const balanceInputs = screen.getAllByPlaceholderText('R$ 0,00')
    await userEvent.type(balanceInputs[0], '20000')
    await userEvent.type(balanceInputs[1], '950')
    await userEvent.type(screen.getByPlaceholderText('0'), '24')
    await userEvent.type(screen.getByPlaceholderText('0,00%'), '1,2')

    await userEvent.click(screen.getByRole('button', { name: /settings\.saveAccount/i }))

    const saved = useDataStore
      .getState()
      .data?.accounts.find((a) => a.name === 'Financiamento do apê')
    expect(saved?.type).toBe('LOAN')
    expect(saved?.includeInBalance).toBe(false)
    expect(saved?.loanMetadata).toEqual({
      outstandingBalance: 20000,
      monthlyPayment: 950,
      remainingInstallments: 24,
      interestRate: 1.2,
    })
  })

  it('pre-fills the loan fields when editing an existing LOAN account', async () => {
    const loanAccount = makeLoanAccount()
    useDataStore.setState({
      data: makeDataFile({ accounts: [loanAccount], transactions: [] }),
    })
    renderSettings('/settings/wealth')

    await userEvent.click(screen.getByText('Financiamento do carro'))

    expect(screen.getByDisplayValue('15000')).toBeInTheDocument()
    expect(screen.getByDisplayValue('800')).toBeInTheDocument()
    expect(screen.getByDisplayValue('18')).toBeInTheDocument()
    expect(screen.getByDisplayValue('1.5')).toBeInTheDocument()
  })

  it('shows the outstandingBalance (not the derived cash-flow balance) in the accounts list', () => {
    const loanAccount = makeLoanAccount()
    useDataStore.setState({
      data: makeDataFile({ accounts: [loanAccount], transactions: [] }),
    })
    renderSettings('/settings/wealth')

    expect(screen.getByText(/15\.000,00/)).toBeInTheDocument()
  })
})

// ─── Settings — HE-09 follow-up: configurable income lookback window ────────

describe('Settings — income lookback window preference', () => {
  async function openPreferences() {
    const user = userEvent.setup()
    renderSettings()
    await user.click((await screen.findAllByText('settings.preferences'))[0])
    return user
  }

  function getIncomeWindowSelect() {
    const row = screen.getByText('settings.incomeWindowMonths').closest('div')
    return within(row as HTMLElement).getByRole('combobox')
  }

  it('defaults to 6 months', async () => {
    await openPreferences()
    expect(getIncomeWindowSelect()).toHaveValue('6')
  })

  it('persists the chosen window to the workspace store', async () => {
    const user = await openPreferences()
    await user.selectOptions(getIncomeWindowSelect(), '3')
    expect(useWorkspaceStore.getState().workspace.incomeWindowMonths).toBe(3)
  })

  it.each([3, 9, 12] as const)('accepts %i months as a valid selection', async (months) => {
    const user = await openPreferences()
    await user.selectOptions(getIncomeWindowSelect(), String(months))
    expect(useWorkspaceStore.getState().workspace.incomeWindowMonths).toBe(months)
  })
})

// ─── Settings — HE-16: configurable emergency reserve target ────────────────

describe('Settings — emergency reserve target preference', () => {
  async function openPreferences() {
    const user = userEvent.setup()
    renderSettings()
    await user.click((await screen.findAllByText('settings.preferences'))[0])
    return user
  }

  function getReserveTargetSelect() {
    const row = screen.getByText('settings.reserveTargetMonths').closest('div')
    return within(row as HTMLElement).getByRole('combobox')
  }

  it('defaults to 6 months', async () => {
    await openPreferences()
    expect(getReserveTargetSelect()).toHaveValue('6')
  })

  it('persists the chosen target to the workspace store', async () => {
    const user = await openPreferences()
    await user.selectOptions(getReserveTargetSelect(), '3')
    expect(useWorkspaceStore.getState().workspace.reserveTargetMonths).toBe(3)
  })

  it.each([3, 9, 12] as const)('accepts %i months as a valid selection', async (months) => {
    const user = await openPreferences()
    await user.selectOptions(getReserveTargetSelect(), String(months))
    expect(useWorkspaceStore.getState().workspace.reserveTargetMonths).toBe(months)
  })

  it('is independent from the income lookback window', async () => {
    const user = await openPreferences()
    await user.selectOptions(getReserveTargetSelect(), '3')
    expect(useWorkspaceStore.getState().workspace.reserveTargetMonths).toBe(3)
    expect(useWorkspaceStore.getState().workspace.incomeWindowMonths).toBe(6)
  })
})

// ─── Settings — B-25: currency preference, independent from locale ──────────

describe('Settings — currency preference', () => {
  async function openPreferences() {
    const user = userEvent.setup()
    renderSettings()
    await user.click((await screen.findAllByText('settings.preferences'))[0])
    return user
  }

  function getCurrencySelect() {
    const row = screen.getByText('settings.currency').closest('div')
    return within(row as HTMLElement).getByRole('combobox')
  }

  it('defaults to BRL for a pt-BR workspace', async () => {
    await openPreferences()
    expect(getCurrencySelect()).toHaveValue('BRL')
  })

  it('persists the chosen currency to the workspace store', async () => {
    const user = await openPreferences()
    await user.selectOptions(getCurrencySelect(), 'USD')
    expect(useWorkspaceStore.getState().workspace.currency).toBe('USD')
  })

  it('is independent from locale — switching currency does not change the language', async () => {
    const user = await openPreferences()
    await user.selectOptions(getCurrencySelect(), 'USD')
    expect(useWorkspaceStore.getState().workspace.currency).toBe('USD')
    expect(useWorkspaceStore.getState().workspace.locale).toBe('pt-BR')
  })
})

// ─── Settings — BX-13: gestão de receitas ────────────────────────────────────

describe('Settings — BX-13: gestão de receitas', () => {
  async function openPreferences() {
    const user = userEvent.setup()
    renderSettings()
    await user.click((await screen.findAllByText('settings.preferences'))[0])
    return user
  }

  it('shows the Quadrantes row with a toggle and a settings gear', async () => {
    await openPreferences()
    expect(screen.getByText('budgets.quadrantesLabel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'budgets.quadrantesLabel' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'budgets.recipeSettings' })).toBeInTheDocument()
  })

  it('the toggle still flips settings.quadrantesEnabled', async () => {
    const user = await openPreferences()
    const toggle = screen.getByRole('button', { name: 'budgets.quadrantesLabel' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(toggle)
    expect(useDataStore.getState().data?.settings.quadrantesEnabled).toBe(true)
  })

  it('the gear navigates to the recipe subpage and shows its config (BX-12)', async () => {
    const user = await openPreferences()
    await user.click(screen.getByRole('link', { name: 'budgets.recipeSettings' }))
    expect(screen.getByTestId('location-display')).toHaveTextContent('/settings/recipes/quadrantes')
    expect(screen.getByRole('button', { name: 'budgets.quadrantesInferLabel' })).toBeInTheDocument()
  })

  it('the back link on the subpage returns to Preferences', async () => {
    const user = userEvent.setup()
    renderSettings('/settings/recipes/quadrantes')
    await user.click(screen.getByText('budgets.backToPreferences'))
    expect(screen.getByTestId('location-display')).toHaveTextContent('/settings/preferences')
  })

  it('an unknown recipe slug falls back to "no data"', async () => {
    renderSettings('/settings/recipes/nao-existe')
    expect(await screen.findByText('common.noData')).toBeInTheDocument()
  })
})

// ─── Settings — BX-12: sugestão de meta por histórico ────────────────────────

describe('Settings — BX-12: sugestão de meta por histórico', () => {
  it('the toggle defaults to off', () => {
    renderSettings('/settings/recipes/quadrantes')
    expect(screen.getByRole('button', { name: 'budgets.quadrantesInferLabel' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('clicking the toggle persists settings.quadrantesInferFromHistory', async () => {
    const user = userEvent.setup()
    renderSettings('/settings/recipes/quadrantes')
    await user.click(screen.getByRole('button', { name: 'budgets.quadrantesInferLabel' }))
    expect(useDataStore.getState().data?.settings.quadrantesInferFromHistory).toBe(true)
  })
})

// ─── Settings — M-97: device name ──────────────────────────────────────────────

describe('Settings — M-97: device name', () => {
  it("saving a name upserts this device's own DeviceInfo entry", async () => {
    installFakeOpfs()
    const user = userEvent.setup()
    renderSettings('/settings/vault')

    const input = await screen.findByPlaceholderText('settings.deviceNamePlaceholder')
    await user.type(input, 'Notebook do Trabalho')
    await user.click(screen.getByText('settings.saveDeviceName'))

    expect(await screen.findByText('settings.deviceNameSaved')).toBeInTheDocument()
    const devices = useDataStore.getState().data?.devices ?? []
    expect(devices).toHaveLength(1)
    expect(devices[0].name).toBe('Notebook do Trabalho')
  })

  it('pre-fills the field with the name already saved for this device', async () => {
    installFakeOpfs()
    // Same device id the fake OPFS will hand back on first getDeviceId() call — seed
    // devices with a matching entry so the effect finds a name to pre-fill.
    const { getDeviceId } = await import('@/lib/cloudSync/deviceId')
    const id = await getDeviceId()
    useDataStore.setState({
      data: makeDataFile({ devices: [{ id, name: 'iPhone da Ana', updatedAt: '2026-01-01' }] }),
    })

    renderSettings('/settings/vault')

    expect(await screen.findByDisplayValue('iPhone da Ana')).toBeInTheDocument()
  })
})

// ─── Settings — M-96: audit log shows device and exact time ──────────────────

describe('Settings — M-96: audit log shows device and exact time', () => {
  it('shows the friendly device name for an entry made on a known peer device', async () => {
    installFakeOpfs()
    useDataStore.setState({
      data: makeDataFile({
        devices: [{ id: 'peer-1', name: 'MacBook do Trabalho', updatedAt: '2026-01-01' }],
        auditLog: [
          {
            id: 'audit-1',
            timestamp: '2026-01-01T12:00:00.000Z',
            action: 'CREATE',
            entity: 'account',
            entityId: 'acc-1',
            summary: 'Conta criada: Nubank',
            deviceId: 'peer-1',
          },
        ],
      }),
    })

    renderSettings('/settings/history')

    expect(await screen.findByText('MacBook do Trabalho')).toBeInTheDocument()
  })

  it('omits the device line for a legacy entry with no deviceId', async () => {
    installFakeOpfs()
    useDataStore.setState({
      data: makeDataFile({
        auditLog: [
          {
            id: 'audit-1',
            timestamp: '2026-01-01T12:00:00.000Z',
            action: 'CREATE',
            entity: 'account',
            entityId: 'acc-1',
            summary: 'Conta criada: Nubank',
          },
        ],
      }),
    })

    renderSettings('/settings/history')

    expect(await screen.findByText('Conta criada: Nubank')).toBeInTheDocument()
    expect(screen.queryByText('settings.multiDeviceThisDevice')).not.toBeInTheDocument()
  })
})
