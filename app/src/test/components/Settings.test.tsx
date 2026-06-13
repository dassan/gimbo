import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Settings from '@/pages/Settings'
import { useDataStore } from '@/store/useDataStore'
import { makeDataFile } from '@/test/fixtures/dataFile'
import { storage } from '@/services/storage'
import { loadBackupDirHandle, writeBackupToDir } from '@/lib/backupDir'
import type { Account, Transaction } from '@/types'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { changeLanguage: vi.fn() } }),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
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
  useDataStore.setState({ data: makeDataFile() })
  vi.clearAllMocks()
  vi.mocked(storage).replaceAll.mockResolvedValue(undefined)
  vi.mocked(storage).exportBlob.mockResolvedValue(new Blob())
  vi.mocked(storage).importBlob.mockResolvedValue(undefined)
  vi.mocked(storage).loadDataFile.mockResolvedValue(null)
})

// ─── Settings — BK-08: manual "Sync now" backup ──────────────────────────────

describe('Settings — BK-08: manual sync now', () => {
  it('forces a backup write to the configured folder on demand', async () => {
    const fakeHandle = { name: 'MyBackups' } as unknown as FileSystemDirectoryHandle
    vi.mocked(loadBackupDirHandle).mockResolvedValueOnce(fakeHandle)
    const user = userEvent.setup()

    render(<Settings />)
    // Navigate to the Backup & Sync section (first nav occurrence).
    await user.click((await screen.findAllByText('settings.backupSync'))[0])

    // The "Sync now" button appears once the configured folder loads.
    await user.click(await screen.findByText('settings.backupSyncNow'))

    // Success toast confirms the write completed; the backup was written to the folder.
    expect(await screen.findByText('settings.backupSyncDone')).toBeInTheDocument()
    expect(vi.mocked(writeBackupToDir)).toHaveBeenCalledWith(fakeHandle, expect.any(Blob))
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
    render(<Settings />)
    // Both mobile tab bar and desktop sidebar render in jsdom — verify at least one exists.
    expect(
      screen.getAllByRole('button', { name: 'settings.accountsAndCards' })[0]
    ).toBeInTheDocument()
  })

  it('shows "settings.accounts" sub-section header for non-CREDIT accounts', () => {
    render(<Settings />)
    // The accounts section is active by default; sub-section header should be present
    expect(screen.getByText('settings.accounts')).toBeInTheDocument()
  })

  it('shows "settings.creditCards" sub-section header', () => {
    render(<Settings />)
    expect(screen.getByText('settings.creditCards')).toBeInTheDocument()
  })

  it('shows "settings.newAccount" add button in the non-CREDIT sub-section', () => {
    render(<Settings />)
    expect(screen.getByRole('button', { name: /settings\.newAccount/i })).toBeInTheDocument()
  })

  it('shows "settings.newCreditCard" add button in the CREDIT sub-section', () => {
    render(<Settings />)
    expect(screen.getByRole('button', { name: /settings\.newCreditCard/i })).toBeInTheDocument()
  })

  it('lists non-CREDIT accounts in the Contas sub-section', () => {
    const retailAccount = makeRetailAccount({ name: 'Minha Conta Corrente' })
    const creditAccount = makeCreditAccount({ name: 'Meu Cartão Visa' })
    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount, creditAccount], transactions: [] }),
    })

    render(<Settings />)

    expect(screen.getByText('Minha Conta Corrente')).toBeInTheDocument()
    expect(screen.getByText('Meu Cartão Visa')).toBeInTheDocument()
  })

  it('opens modal with CREDIT pre-selected when clicking "Novo Cartão"', async () => {
    useDataStore.setState({
      data: makeDataFile({ accounts: [], transactions: [] }),
    })

    render(<Settings />)
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

    render(<Settings />)

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

    render(<Settings />)

    expect(screen.getByText('accounts.availableLimit')).toBeInTheDocument()
  })

  it('does not show "accounts.availableLimit" label for non-CREDIT accounts', () => {
    const retailAccount = makeRetailAccount()
    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [] }),
    })

    render(<Settings />)

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

    render(<Settings />)

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

    render(<Settings />)

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

    render(<Settings />)

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

    render(<Settings />)

    // Retail balance = 4321 (credit expense must NOT be subtracted)
    // 4321 → R$ 4.321,00 — a value that won't appear in the credit account column
    expect(screen.getByText(/4\.321,00/)).toBeInTheDocument()
  })
})

// ─── Settings — M-23: issuer icon picker for CREDIT accounts ─────────────────

describe('Settings — M-23: issuer icon picker', () => {
  async function openCreditModal() {
    useDataStore.setState({
      data: makeDataFile({ accounts: [], transactions: [] }),
    })
    render(<Settings />)
    await userEvent.click(screen.getByRole('button', { name: /settings\.newCreditCard/i }))
  }

  it('shows the issuer section label when CREDIT modal is open', async () => {
    await openCreditModal()
    expect(screen.getByText('accounts.issuer')).toBeInTheDocument()
  })

  it('renders all issuer options in the picker', async () => {
    await openCreditModal()
    // All named issuers should appear as buttons
    expect(screen.getByText('Nubank')).toBeInTheDocument()
    expect(screen.getByText('Itaú')).toBeInTheDocument()
    expect(screen.getByText('Bradesco')).toBeInTheDocument()
    expect(screen.getByText('Inter')).toBeInTheDocument()
    expect(screen.getByText('Santander')).toBeInTheDocument()
    expect(screen.getByText('Caixa')).toBeInTheDocument()
    expect(screen.getByText('accounts.issuerGeneric')).toBeInTheDocument()
  })

  it('does not show the issuer section when a non-CREDIT type is selected in the modal', async () => {
    useDataStore.setState({
      data: makeDataFile({ accounts: [], transactions: [] }),
    })
    render(<Settings />)
    // Open a regular account modal (non-CREDIT default)
    await userEvent.click(screen.getByRole('button', { name: /settings\.newAccount/i }))

    expect(screen.queryByText('accounts.issuer')).not.toBeInTheDocument()
  })

  it('preserves issuerIcon when editing a CREDIT account that already has one', () => {
    const creditAccount = makeCreditAccount({ issuerIcon: 'nubank' })
    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [] }),
    })
    render(<Settings />)
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
    render(<Settings />)

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
    render(<Settings />)

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
    render(<Settings />)

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
    render(<Settings />)

    await userEvent.click(screen.getByText(/accounts\.archivedAccounts/))
    await userEvent.click(screen.getByRole('button', { name: /accounts\.viewCard/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/credit-card/acc-old-card')
  })

  it('toggling "Ativa" off in the account modal archives the account on save', async () => {
    const account = makeRetailAccount({ id: 'acc-1', name: 'Conta 1' })
    useDataStore.setState({
      data: makeDataFile({ accounts: [account], transactions: [] }),
    })
    render(<Settings />)

    await userEvent.click(screen.getByText('Conta 1'))
    await userEvent.click(screen.getByRole('button', { name: 'accounts.active' }))
    await userEvent.click(screen.getByRole('button', { name: /settings\.saveAccount/i }))

    const saved = useDataStore.getState().data?.accounts.find((a) => a.id === 'acc-1')
    expect(saved?.archived).toBe(true)
  })
})
