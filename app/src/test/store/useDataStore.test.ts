import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useDataStore } from '@/store/useDataStore'
import { makeDataFile } from '../fixtures/dataFile'
import type {
  Account,
  Category,
  Tag,
  Transaction,
  CreditMetadata,
  LoanMetadata,
  ReserveMetadata,
  Valuation,
  SavedPeriod,
  Budget,
} from '@/types'

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    name: 'Checking',
    type: 'RETAIL',
    balance: 0,
    includeInBalance: true,
    ...overrides,
  }
}

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 'cat-1',
    parentId: null,
    name: 'Food',
    icon: 'utensils',
    color: '#FF0000',
    type: 'EXPENSE',
    ...overrides,
  }
}

function makeTag(overrides: Partial<Tag> = {}): Tag {
  return { id: 'tag-1', name: 'urgent', color: '#FF0000', ...overrides }
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    accountId: 'acc-1',
    categoryId: 'cat-1',
    amount: 100,
    type: 'EXPENSE',
    date: new Date().toISOString().slice(0, 10),
    description: 'Test',
    isPaid: true,
    tags: [],
    ...overrides,
  }
}

beforeEach(() => {
  useDataStore.setState({ data: null })
})

describe('mutate guard', () => {
  it('returns no state change when data is null', () => {
    useDataStore.getState().addAccount(makeAccount())
    expect(useDataStore.getState().data).toBeNull()
  })
})

describe('addAccount', () => {
  it('appends account and creates audit entry', () => {
    useDataStore.setState({ data: makeDataFile() })
    useDataStore.getState().addAccount(makeAccount({ id: 'acc-1', name: 'Conta Corrente' }))
    const { data } = useDataStore.getState()
    expect(data?.accounts).toHaveLength(1)
    expect(data?.accounts[0].name).toBe('Conta Corrente')
  })

  it('creates a CREATE audit entry', () => {
    useDataStore.setState({ data: makeDataFile() })
    useDataStore.getState().addAccount(makeAccount({ id: 'acc-1' }))
    const log = useDataStore.getState().data?.auditLog ?? []
    expect(log.some((e) => e.action === 'CREATE' && e.entityId === 'acc-1')).toBe(true)
  })
})

describe('deleteAccount', () => {
  it('removes account and creates DELETE audit entry', () => {
    useDataStore.setState({ data: makeDataFile({ accounts: [makeAccount({ id: 'acc-1' })] }) })
    useDataStore.getState().deleteAccount('acc-1')
    const { data } = useDataStore.getState()
    expect(data?.accounts).toHaveLength(0)
    expect(data?.auditLog.some((e) => e.action === 'DELETE' && e.entityId === 'acc-1')).toBe(true)
  })

  it('does not throw when deleting a non-existent id', () => {
    useDataStore.setState({ data: makeDataFile() })
    expect(() => useDataStore.getState().deleteAccount('ghost-id')).not.toThrow()
  })
})

describe('updateAccount', () => {
  it('updates existing account', () => {
    const acc = makeAccount({ id: 'acc-1', name: 'Old Name' })
    useDataStore.setState({ data: makeDataFile({ accounts: [acc] }) })
    useDataStore.getState().updateAccount({ ...acc, name: 'New Name' })
    expect(useDataStore.getState().data?.accounts[0].name).toBe('New Name')
  })

  it('does not crash on non-existent account', () => {
    useDataStore.setState({ data: makeDataFile() })
    expect(() => useDataStore.getState().updateAccount(makeAccount({ id: 'ghost' }))).not.toThrow()
  })
})

describe('categories', () => {
  it('addCategory appends and creates audit entry', () => {
    useDataStore.setState({ data: makeDataFile() })
    useDataStore.getState().addCategory(makeCategory({ id: 'cat-1' }))
    expect(useDataStore.getState().data?.categories).toHaveLength(1)
    expect(
      useDataStore
        .getState()
        .data?.auditLog.some((e) => e.action === 'CREATE' && e.entityId === 'cat-1')
    ).toBe(true)
  })

  it('updateCategory changes the category', () => {
    useDataStore.setState({
      data: makeDataFile({ categories: [makeCategory({ id: 'cat-1', name: 'Old' })] }),
    })
    useDataStore.getState().updateCategory(makeCategory({ id: 'cat-1', name: 'New' }))
    expect(useDataStore.getState().data?.categories[0].name).toBe('New')
  })

  it('deleteCategory removes it', () => {
    useDataStore.setState({ data: makeDataFile({ categories: [makeCategory({ id: 'cat-1' })] }) })
    useDataStore.getState().deleteCategory('cat-1')
    expect(useDataStore.getState().data?.categories).toHaveLength(0)
  })
})

describe('tags', () => {
  it('addTag appends and creates audit entry', () => {
    useDataStore.setState({ data: makeDataFile() })
    useDataStore.getState().addTag(makeTag({ id: 'tag-1' }))
    expect(useDataStore.getState().data?.tags).toHaveLength(1)
    expect(
      useDataStore
        .getState()
        .data?.auditLog.some((e) => e.action === 'CREATE' && e.entityId === 'tag-1')
    ).toBe(true)
  })

  it('deleteTag removes it', () => {
    useDataStore.setState({ data: makeDataFile({ tags: [makeTag({ id: 'tag-1' })] }) })
    useDataStore.getState().deleteTag('tag-1')
    expect(useDataStore.getState().data?.tags).toHaveLength(0)
  })

  it('updateTag changes the tag name', () => {
    useDataStore.setState({ data: makeDataFile({ tags: [makeTag({ id: 'tag-1', name: 'old' })] }) })
    useDataStore.getState().updateTag(makeTag({ id: 'tag-1', name: 'new' }))
    expect(useDataStore.getState().data?.tags[0].name).toBe('new')
  })
})

describe('transactions', () => {
  it('addTransaction appends and creates audit entry', () => {
    useDataStore.setState({
      data: makeDataFile({ categories: [makeCategory()] }),
    })
    useDataStore.getState().addTransaction(makeTransaction({ id: 'tx-1' }))
    expect(useDataStore.getState().data?.transactions).toHaveLength(1)
    expect(
      useDataStore
        .getState()
        .data?.auditLog.some((e) => e.action === 'CREATE' && e.entityId === 'tx-1')
    ).toBe(true)
  })

  it('updateTransaction changes data', () => {
    useDataStore.setState({
      data: makeDataFile({ transactions: [makeTransaction({ id: 'tx-1', amount: 100 })] }),
    })
    useDataStore.getState().updateTransaction(makeTransaction({ id: 'tx-1', amount: 200 }))
    expect(useDataStore.getState().data?.transactions[0].amount).toBe(200)
  })

  it('deleteTransaction removes it', () => {
    useDataStore.setState({
      data: makeDataFile({ transactions: [makeTransaction({ id: 'tx-1' })] }),
    })
    useDataStore.getState().deleteTransaction('tx-1')
    expect(useDataStore.getState().data?.transactions).toHaveLength(0)
  })
})

describe('updateUser', () => {
  it('patches user fields and creates audit entry', () => {
    useDataStore.setState({ data: makeDataFile() })
    useDataStore.getState().updateUser({ name: 'New Name' })
    expect(useDataStore.getState().data?.user.name).toBe('New Name')
    expect(
      useDataStore
        .getState()
        .data?.auditLog.some((e) => e.action === 'UPDATE' && e.entity === 'user')
    ).toBe(true)
  })
})

describe('loadData / clearData', () => {
  it('loadData sets data', () => {
    useDataStore.getState().loadData(makeDataFile())
    expect(useDataStore.getState().data).not.toBeNull()
  })

  it('clearData resets to null', () => {
    useDataStore.setState({ data: makeDataFile() })
    useDataStore.getState().clearData()
    expect(useDataStore.getState().data).toBeNull()
  })
})

describe('creditMetadata handling (CC-12)', () => {
  const creditMeta: CreditMetadata = { limit: 5000, closingDay: 10, dueDay: 25 }

  it('addAccount with CREDIT type persists creditMetadata', () => {
    useDataStore.setState({ data: makeDataFile() })
    const creditAccount = makeAccount({
      id: 'acc-credit',
      type: 'CREDIT',
      creditMetadata: creditMeta,
    })
    useDataStore.getState().addAccount(creditAccount)
    const saved = useDataStore.getState().data?.accounts[0]
    expect(saved?.creditMetadata).toEqual(creditMeta)
  })

  it('updateAccount with CREDIT type updates creditMetadata', () => {
    const creditAccount = makeAccount({
      id: 'acc-credit',
      type: 'CREDIT',
      creditMetadata: creditMeta,
    })
    useDataStore.setState({ data: makeDataFile({ accounts: [creditAccount] }) })
    const updated: CreditMetadata = { limit: 10000, closingDay: 15, dueDay: 5 }
    useDataStore.getState().updateAccount({ ...creditAccount, creditMetadata: updated })
    const saved = useDataStore.getState().data?.accounts[0]
    expect(saved?.creditMetadata).toEqual(updated)
  })

  it('addAccount with non-CREDIT type does not include creditMetadata', () => {
    useDataStore.setState({ data: makeDataFile() })
    // Simulate a stale account object that erroneously carries creditMetadata
    const staleAccount = makeAccount({
      id: 'acc-retail',
      type: 'RETAIL',
      creditMetadata: creditMeta,
    })
    useDataStore.getState().addAccount(staleAccount)
    const saved = useDataStore.getState().data?.accounts[0]
    expect(saved?.creditMetadata).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(saved, 'creditMetadata')).toBe(false)
  })

  it('updateAccount changing type away from CREDIT strips creditMetadata', () => {
    const creditAccount = makeAccount({ id: 'acc-1', type: 'CREDIT', creditMetadata: creditMeta })
    useDataStore.setState({ data: makeDataFile({ accounts: [creditAccount] }) })
    useDataStore
      .getState()
      .updateAccount({ ...creditAccount, type: 'SAVINGS', creditMetadata: creditMeta })
    const saved = useDataStore.getState().data?.accounts[0]
    expect(saved?.type).toBe('SAVINGS')
    expect(saved?.creditMetadata).toBeUndefined()
  })

  // M-34: issuerIcon (institution) is allowed on any account type
  it('addAccount with non-CREDIT type preserves issuerIcon', () => {
    useDataStore.setState({ data: makeDataFile() })
    useDataStore
      .getState()
      .addAccount(makeAccount({ id: 'acc-retail', type: 'RETAIL', issuerIcon: 'nubank' }))
    const saved = useDataStore.getState().data?.accounts[0]
    expect(saved?.issuerIcon).toBe('nubank')
  })

  it('strips creditMetadata from a non-CREDIT account while keeping its issuerIcon', () => {
    useDataStore.setState({ data: makeDataFile() })
    const staleAccount = makeAccount({
      id: 'acc-retail',
      type: 'RETAIL',
      issuerIcon: 'itau',
      creditMetadata: creditMeta,
    })
    useDataStore.getState().addAccount(staleAccount)
    const saved = useDataStore.getState().data?.accounts[0]
    expect(saved?.issuerIcon).toBe('itau')
    expect(saved?.creditMetadata).toBeUndefined()
  })

  // M-42: archived (visibility flag) is allowed on any account type
  it('addAccount with non-CREDIT type preserves archived: true', () => {
    useDataStore.setState({ data: makeDataFile() })
    useDataStore
      .getState()
      .addAccount(makeAccount({ id: 'acc-retail', type: 'RETAIL', archived: true }))
    const saved = useDataStore.getState().data?.accounts[0]
    expect(saved?.archived).toBe(true)
  })

  it('addAccount with non-CREDIT type and archived: false omits the field', () => {
    useDataStore.setState({ data: makeDataFile() })
    useDataStore
      .getState()
      .addAccount(makeAccount({ id: 'acc-retail', type: 'RETAIL', archived: false }))
    const saved = useDataStore.getState().data?.accounts[0]
    expect(saved?.archived).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(saved, 'archived')).toBe(false)
  })

  it('updateAccount reactivates an archived account by setting archived: false', () => {
    const archivedAccount = makeAccount({ id: 'acc-1', type: 'SAVINGS', archived: true })
    useDataStore.setState({ data: makeDataFile({ accounts: [archivedAccount] }) })
    useDataStore.getState().updateAccount({ ...archivedAccount, archived: false })
    const saved = useDataStore.getState().data?.accounts[0]
    expect(saved?.archived).toBeUndefined()
  })
})

describe('loanMetadata handling (HE-06)', () => {
  const loanMeta: LoanMetadata = {
    outstandingBalance: 15000,
    monthlyPayment: 800,
    remainingInstallments: 18,
    interestRate: 1.5,
  }

  it('addAccount with LOAN type persists loanMetadata', () => {
    useDataStore.setState({ data: makeDataFile() })
    const loanAccount = makeAccount({ id: 'acc-loan', type: 'LOAN', loanMetadata: loanMeta })
    useDataStore.getState().addAccount(loanAccount)
    const saved = useDataStore.getState().data?.accounts[0]
    expect(saved?.loanMetadata).toEqual(loanMeta)
  })

  // HE-06: the agreed update path for outstandingBalance is direct edit via updateAccount
  // (no separate Valuation-style history mechanism in v1 — see plan/FINANCIAL_HEALTH.md §D5).
  it('updateAccount with LOAN type updates loanMetadata (manual outstandingBalance edit)', () => {
    const loanAccount = makeAccount({ id: 'acc-loan', type: 'LOAN', loanMetadata: loanMeta })
    useDataStore.setState({ data: makeDataFile({ accounts: [loanAccount] }) })
    const updated: LoanMetadata = { ...loanMeta, outstandingBalance: 14200 }
    useDataStore.getState().updateAccount({ ...loanAccount, loanMetadata: updated })
    const saved = useDataStore.getState().data?.accounts[0]
    expect(saved?.loanMetadata).toEqual(updated)
  })

  it('addAccount with non-LOAN type does not include loanMetadata', () => {
    useDataStore.setState({ data: makeDataFile() })
    // Simulate a stale account object that erroneously carries loanMetadata
    const staleAccount = makeAccount({ id: 'acc-retail', type: 'RETAIL', loanMetadata: loanMeta })
    useDataStore.getState().addAccount(staleAccount)
    const saved = useDataStore.getState().data?.accounts[0]
    expect(saved?.loanMetadata).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(saved, 'loanMetadata')).toBe(false)
  })

  it('updateAccount changing type away from LOAN strips loanMetadata', () => {
    const loanAccount = makeAccount({ id: 'acc-1', type: 'LOAN', loanMetadata: loanMeta })
    useDataStore.setState({ data: makeDataFile({ accounts: [loanAccount] }) })
    useDataStore
      .getState()
      .updateAccount({ ...loanAccount, type: 'SAVINGS', loanMetadata: loanMeta })
    const saved = useDataStore.getState().data?.accounts[0]
    expect(saved?.type).toBe('SAVINGS')
    expect(saved?.loanMetadata).toBeUndefined()
  })

  it('strips loanMetadata from a non-LOAN account while keeping its issuerIcon', () => {
    useDataStore.setState({ data: makeDataFile() })
    const staleAccount = makeAccount({
      id: 'acc-retail',
      type: 'RETAIL',
      issuerIcon: 'itau',
      loanMetadata: loanMeta,
    })
    useDataStore.getState().addAccount(staleAccount)
    const saved = useDataStore.getState().data?.accounts[0]
    expect(saved?.issuerIcon).toBe('itau')
    expect(saved?.loanMetadata).toBeUndefined()
  })
})

describe('reserveMetadata handling (HE-14)', () => {
  const reserveMeta: ReserveMetadata = {}

  it('addAccount with RETAIL type persists reserveMetadata', () => {
    useDataStore.setState({ data: makeDataFile() })
    const reserveAccount = makeAccount({
      id: 'acc-retail',
      type: 'RETAIL',
      reserveMetadata: reserveMeta,
    })
    useDataStore.getState().addAccount(reserveAccount)
    const saved = useDataStore.getState().data?.accounts[0]
    expect(saved?.reserveMetadata).toEqual(reserveMeta)
  })

  it('addAccount with SAVINGS type persists reserveMetadata', () => {
    useDataStore.setState({ data: makeDataFile() })
    const reserveAccount = makeAccount({
      id: 'acc-savings',
      type: 'SAVINGS',
      reserveMetadata: reserveMeta,
    })
    useDataStore.getState().addAccount(reserveAccount)
    const saved = useDataStore.getState().data?.accounts[0]
    expect(saved?.reserveMetadata).toEqual(reserveMeta)
  })

  it('updateAccount toggling reserveMetadata off removes it', () => {
    const reserveAccount = makeAccount({
      id: 'acc-1',
      type: 'RETAIL',
      reserveMetadata: reserveMeta,
    })
    useDataStore.setState({ data: makeDataFile({ accounts: [reserveAccount] }) })
    useDataStore.getState().updateAccount({ ...reserveAccount, reserveMetadata: undefined })
    const saved = useDataStore.getState().data?.accounts[0]
    expect(saved?.reserveMetadata).toBeUndefined()
  })

  it('addAccount with a non-eligible type does not include reserveMetadata', () => {
    useDataStore.setState({ data: makeDataFile() })
    // Simulate a stale account object that erroneously carries reserveMetadata
    const staleAccount = makeAccount({
      id: 'acc-loan',
      type: 'LOAN',
      reserveMetadata: reserveMeta,
    })
    useDataStore.getState().addAccount(staleAccount)
    const saved = useDataStore.getState().data?.accounts[0]
    expect(saved?.reserveMetadata).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(saved, 'reserveMetadata')).toBe(false)
  })

  it('updateAccount changing type away from RETAIL/SAVINGS strips reserveMetadata', () => {
    const reserveAccount = makeAccount({
      id: 'acc-1',
      type: 'RETAIL',
      reserveMetadata: reserveMeta,
    })
    useDataStore.setState({ data: makeDataFile({ accounts: [reserveAccount] }) })
    useDataStore
      .getState()
      .updateAccount({ ...reserveAccount, type: 'LOAN', reserveMetadata: reserveMeta })
    const saved = useDataStore.getState().data?.accounts[0]
    expect(saved?.type).toBe('LOAN')
    expect(saved?.reserveMetadata).toBeUndefined()
  })

  it('strips reserveMetadata from a non-eligible account while keeping its issuerIcon', () => {
    useDataStore.setState({ data: makeDataFile() })
    const staleAccount = makeAccount({
      id: 'acc-loan',
      type: 'LOAN',
      issuerIcon: 'itau',
      reserveMetadata: reserveMeta,
    })
    useDataStore.getState().addAccount(staleAccount)
    const saved = useDataStore.getState().data?.accounts[0]
    expect(saved?.issuerIcon).toBe('itau')
    expect(saved?.reserveMetadata).toBeUndefined()
  })
})

describe('CREDIT_PAYMENT handling (CC-21)', () => {
  function makeCreditAccount() {
    return {
      id: 'acc-credit',
      name: 'Nubank Visa',
      type: 'CREDIT' as const,
      balance: 0,
      includeInBalance: false,
      creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 },
    }
  }

  function makeCheckingAccount() {
    return {
      id: 'acc-checking',
      name: 'Conta Corrente',
      type: 'RETAIL' as const,
      balance: 0,
      includeInBalance: true,
    }
  }

  it('addTransaction persists CREDIT_PAYMENT with transferAccountId', () => {
    const credit = makeCreditAccount()
    const checking = makeCheckingAccount()
    useDataStore.setState({
      data: makeDataFile({ accounts: [credit, checking] }),
    })

    const tx: import('@/types').Transaction = {
      id: 'tx-cp',
      accountId: credit.id,
      categoryId: '',
      amount: 1200,
      type: 'CREDIT_PAYMENT',
      date: new Date().toISOString().slice(0, 10),
      description: 'Pagamento fatura',
      isPaid: true,
      tags: [],
      transferAccountId: checking.id,
    }
    useDataStore.getState().addTransaction(tx)

    const saved = useDataStore.getState().data?.transactions[0]
    expect(saved?.type).toBe('CREDIT_PAYMENT')
    expect(saved?.accountId).toBe(credit.id)
    expect(saved?.transferAccountId).toBe(checking.id)
  })

  it('addTransaction generates descriptive audit log for CREDIT_PAYMENT', () => {
    const credit = makeCreditAccount()
    const checking = makeCheckingAccount()
    useDataStore.setState({
      data: makeDataFile({ accounts: [credit, checking] }),
    })

    const tx: import('@/types').Transaction = {
      id: 'tx-cp',
      accountId: credit.id,
      categoryId: '',
      amount: 500,
      type: 'CREDIT_PAYMENT',
      date: new Date().toISOString().slice(0, 10),
      description: '',
      isPaid: true,
      tags: [],
      transferAccountId: checking.id,
    }
    useDataStore.getState().addTransaction(tx)

    const entry = useDataStore.getState().data?.auditLog.find((e) => e.entityId === 'tx-cp')
    expect(entry).toBeDefined()
    expect(entry?.summary).toContain('Pagamento de fatura')
    expect(entry?.summary).toContain(credit.name)
    expect(entry?.summary).toContain(checking.name)
  })

  it('regular addTransaction still generates standard audit log', () => {
    const checking = makeCheckingAccount()
    const cat = {
      id: 'cat-1',
      parentId: null,
      name: 'Mercado',
      icon: 'cart',
      color: '#F00',
      type: 'EXPENSE' as const,
    }
    useDataStore.setState({
      data: makeDataFile({ accounts: [checking], categories: [cat] }),
    })

    const tx: import('@/types').Transaction = {
      id: 'tx-exp',
      accountId: checking.id,
      categoryId: cat.id,
      amount: 100,
      type: 'EXPENSE',
      date: new Date().toISOString().slice(0, 10),
      description: 'Feira',
      isPaid: true,
      tags: [],
    }
    useDataStore.getState().addTransaction(tx)

    const entry = useDataStore.getState().data?.auditLog.find((e) => e.entityId === 'tx-exp')
    expect(entry?.summary).toContain('Feira')
  })
})

describe('setRetentionLimit', () => {
  it('applies new limit and trims audit log', () => {
    const manyEntries = Array.from({ length: 10 }, (_, i) => ({
      id: `e-${i}`,
      timestamp: new Date().toISOString(),
      action: 'CREATE' as const,
      entity: 'account' as const,
      entityId: 'acc-1',
      summary: 'x',
    }))
    useDataStore.setState({ data: makeDataFile({ auditLog: manyEntries }) })
    useDataStore.getState().setRetentionLimit(3)
    expect(useDataStore.getState().data?.auditLog.length).toBeLessThanOrEqual(3)
  })

  it('preserves all entries when limit is null', () => {
    const manyEntries = Array.from({ length: 10 }, (_, i) => ({
      id: `e-${i}`,
      timestamp: new Date().toISOString(),
      action: 'CREATE' as const,
      entity: 'account' as const,
      entityId: 'acc-1',
      summary: 'x',
    }))
    useDataStore.setState({ data: makeDataFile({ auditLog: manyEntries }) })
    useDataStore.getState().setRetentionLimit(null)
    expect(useDataStore.getState().data?.auditLog).toHaveLength(10)
  })
})

// ─── CC-24 + CC-25: Installment group creation ───────────────────────────────

describe('addTransaction — installment group (CC-24/CC-25)', () => {
  const creditAccount = {
    id: 'acc-credit',
    name: 'Nubank',
    type: 'CREDIT' as const,
    balance: 0,
    includeInBalance: false,
    creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 },
  }
  const expenseCat = {
    id: 'cat-1',
    parentId: null,
    name: 'Viagem',
    icon: 'plane',
    color: '#F00',
    type: 'EXPENSE' as const,
  }

  function makeInstallmentPayload(total: number, amount: number): import('@/types').Transaction {
    const parentId = 'parent-uuid-1'
    return {
      id: parentId,
      accountId: creditAccount.id,
      categoryId: expenseCat.id,
      amount,
      type: 'EXPENSE',
      date: '2024-03-15',
      description: 'Passagem',
      isPaid: false,
      tags: [],
      installment: { parentId, currentIndex: 1, total },
    }
  }

  beforeEach(() => {
    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], categories: [expenseCat] }),
    })
  })

  it('generates N separate transactions for installment.total > 1', () => {
    useDataStore.getState().addTransaction(makeInstallmentPayload(3, 300))
    const txs = useDataStore.getState().data?.transactions ?? []
    expect(txs).toHaveLength(3)
  })

  it('each installment has a unique id', () => {
    useDataStore.getState().addTransaction(makeInstallmentPayload(3, 300))
    const txs = useDataStore.getState().data?.transactions ?? []
    const ids = txs.map((t) => t.id)
    expect(new Set(ids).size).toBe(3)
  })

  it('all installments share the same parentId', () => {
    useDataStore.getState().addTransaction(makeInstallmentPayload(3, 300))
    const txs = useDataStore.getState().data?.transactions ?? []
    const parentIds = txs.map((t) => t.installment?.parentId)
    expect(new Set(parentIds).size).toBe(1)
    expect(parentIds[0]).toBe('parent-uuid-1')
  })

  it('installment currentIndex increments from 1 to N', () => {
    useDataStore.getState().addTransaction(makeInstallmentPayload(3, 300))
    const txs = useDataStore.getState().data?.transactions ?? []
    const indexes = txs.map((t) => t.installment?.currentIndex).sort()
    expect(indexes).toEqual([1, 2, 3])
  })

  it('description gets (X/N) suffix on each installment', () => {
    useDataStore.getState().addTransaction(makeInstallmentPayload(3, 300))
    const txs = useDataStore.getState().data?.transactions ?? []
    const descs = txs.map((t) => t.description).sort()
    expect(descs).toContain('Passagem (1/3)')
    expect(descs).toContain('Passagem (2/3)')
    expect(descs).toContain('Passagem (3/3)')
  })

  it('date advances by one month per installment', () => {
    useDataStore.getState().addTransaction(makeInstallmentPayload(3, 300))
    const txs = useDataStore
      .getState()
      .data?.transactions.sort(
        (a, b) => (a.installment?.currentIndex ?? 0) - (b.installment?.currentIndex ?? 0)
      )
    expect(txs?.[0].date).toBe('2024-03-15')
    expect(txs?.[1].date).toBe('2024-04-15')
    expect(txs?.[2].date).toBe('2024-05-15')
  })

  it('M-64: all installments share the same purchaseDate, distinct from their own date', () => {
    useDataStore.getState().addTransaction(makeInstallmentPayload(3, 300))
    const txs = useDataStore
      .getState()
      .data?.transactions.sort(
        (a, b) => (a.installment?.currentIndex ?? 0) - (b.installment?.currentIndex ?? 0)
      )
    expect(txs?.map((t) => t.installment?.purchaseDate)).toEqual([
      '2024-03-15',
      '2024-03-15',
      '2024-03-15',
    ])
    expect(txs?.[1].date).not.toBe(txs?.[1].installment?.purchaseDate)
  })

  it('amount is distributed evenly (no remainder when divisible)', () => {
    useDataStore.getState().addTransaction(makeInstallmentPayload(3, 300))
    const txs = useDataStore.getState().data?.transactions ?? []
    txs.forEach((t) => expect(t.amount).toBeCloseTo(100, 2))
  })

  it('rounding remainder goes to the first installment', () => {
    // R$ 100.00 / 3 = R$ 33.33 × 3 = R$ 99.99; first gets R$ 33.34
    useDataStore.getState().addTransaction(makeInstallmentPayload(3, 100))
    const txs = useDataStore
      .getState()
      .data?.transactions.sort(
        (a, b) => (a.installment?.currentIndex ?? 0) - (b.installment?.currentIndex ?? 0)
      )
    const total = (txs ?? []).reduce((sum, t) => sum + t.amount, 0)
    expect(Math.round(total * 100) / 100).toBe(100)
    // First parcel is >= others
    expect(txs![0].amount).toBeGreaterThanOrEqual(txs![1].amount)
  })

  it('all installments have isPaid = false', () => {
    useDataStore.getState().addTransaction(makeInstallmentPayload(3, 300))
    const txs = useDataStore.getState().data?.transactions ?? []
    txs.forEach((t) => expect(t.isPaid).toBe(false))
  })

  it('CC-25: generates a single audit log entry for the group', () => {
    useDataStore.getState().addTransaction(makeInstallmentPayload(3, 300))
    const log = useDataStore.getState().data?.auditLog ?? []
    expect(log).toHaveLength(1)
    const entry = log[0]
    expect(entry.action).toBe('CREATE')
    expect(entry.entity).toBe('transaction')
    expect(entry.entityId).toBe('parent-uuid-1')
  })

  it('CC-25: audit summary mentions N, description, and account name', () => {
    useDataStore.getState().addTransaction(makeInstallmentPayload(3, 300))
    const entry = useDataStore.getState().data?.auditLog[0]
    expect(entry?.summary).toContain('3')
    expect(entry?.summary).toContain('Passagem')
    expect(entry?.summary).toContain('Nubank')
  })

  it('wraps month correctly at year boundary (November + 2 = January next year)', () => {
    const payload = makeInstallmentPayload(2, 200)
    payload.date = '2024-11-15'
    useDataStore.getState().addTransaction(payload)
    const txs = useDataStore
      .getState()
      .data?.transactions.sort(
        (a, b) => (a.installment?.currentIndex ?? 0) - (b.installment?.currentIndex ?? 0)
      )
    expect(txs?.[0].date).toBe('2024-11-15')
    expect(txs?.[1].date).toBe('2024-12-15')
  })

  it('clamps day to last day of short month (Jan 31 + 1 month = Feb 28)', () => {
    const payload = makeInstallmentPayload(2, 200)
    payload.date = '2024-01-31'
    useDataStore.getState().addTransaction(payload)
    const txs = useDataStore
      .getState()
      .data?.transactions.sort(
        (a, b) => (a.installment?.currentIndex ?? 0) - (b.installment?.currentIndex ?? 0)
      )
    expect(txs?.[0].date).toBe('2024-01-31')
    expect(txs?.[1].date).toBe('2024-02-29') // 2024 is a leap year
  })
})

// ─── M-35: recurring series generation ────────────────────────────────────────

describe('M-35: addTransaction with recurrence', () => {
  const account = makeAccount({ id: 'acc-r' })
  const category = makeCategory({ id: 'cat-r', type: 'INCOME' })

  function makeRecurring(
    recurrence: Transaction['recurrence'],
    overrides: Partial<Transaction> = {}
  ): Transaction {
    return makeTransaction({
      id: 'rec-parent',
      accountId: 'acc-r',
      categoryId: 'cat-r',
      type: 'INCOME',
      amount: 1000,
      date: '2026-01-10',
      description: 'Salário',
      isPaid: true,
      recurrence,
      ...overrides,
    })
  }

  beforeEach(() => {
    useDataStore.setState({
      data: makeDataFile({ accounts: [account], categories: [category] }),
    })
  })

  it('generates 25 monthly occurrences over the default 24-month rolling horizon (B-22)', () => {
    useDataStore
      .getState()
      .addTransaction(makeRecurring({ frequency: 'monthly', parentId: 'rec-parent' }))
    const txs = useDataStore.getState().data?.transactions ?? []
    expect(txs).toHaveLength(25) // months 0..24 inclusive
  })

  it('all occurrences share the parentId and frequency', () => {
    useDataStore
      .getState()
      .addTransaction(makeRecurring({ frequency: 'monthly', parentId: 'rec-parent' }))
    const txs = useDataStore.getState().data?.transactions ?? []
    expect(new Set(txs.map((t) => t.recurrence?.parentId)).size).toBe(1)
    expect(txs[0].recurrence?.parentId).toBe('rec-parent')
    expect(txs.every((t) => t.recurrence?.frequency === 'monthly')).toBe(true)
  })

  it('only the first occurrence keeps the paid status; later ones are unpaid', () => {
    useDataStore
      .getState()
      .addTransaction(makeRecurring({ frequency: 'monthly', parentId: 'rec-parent' }))
    const txs = [...(useDataStore.getState().data?.transactions ?? [])].sort((a, b) =>
      a.date.localeCompare(b.date)
    )
    expect(txs[0].isPaid).toBe(true)
    expect(txs.slice(1).every((t) => t.isPaid === false)).toBe(true)
  })

  it('respects an explicit endDate (weekly): Jan 1,8,15,22,29 → 5 occurrences', () => {
    useDataStore
      .getState()
      .addTransaction(
        makeRecurring(
          { frequency: 'weekly', parentId: 'rec-parent', endDate: '2026-01-29' },
          { date: '2026-01-01' }
        )
      )
    const txs = useDataStore.getState().data?.transactions ?? []
    expect(txs).toHaveLength(5)
    expect(txs.every((t) => t.date <= '2026-01-29')).toBe(true)
  })

  it('generates a single audit entry for the series', () => {
    useDataStore
      .getState()
      .addTransaction(makeRecurring({ frequency: 'monthly', parentId: 'rec-parent' }))
    const log = useDataStore.getState().data?.auditLog ?? []
    expect(log).toHaveLength(1)
    expect(log[0].entityId).toBe('rec-parent')
  })
})

// ─── M-35: deleteRecurrenceFrom ───────────────────────────────────────────────

describe('M-35: deleteRecurrenceFrom', () => {
  const account = makeAccount({ id: 'acc-r' })
  const category = makeCategory({ id: 'cat-r', type: 'INCOME' })

  beforeEach(() => {
    useDataStore.setState({
      data: makeDataFile({ accounts: [account], categories: [category] }),
    })
    useDataStore.getState().addTransaction(
      makeTransaction({
        id: 'rec-parent',
        accountId: 'acc-r',
        categoryId: 'cat-r',
        type: 'INCOME',
        amount: 1000,
        date: '2026-01-10',
        description: 'Salário',
        isPaid: true,
        recurrence: { frequency: 'monthly', parentId: 'rec-parent' },
      })
    )
  })

  it('removes the chosen occurrence and all later ones, keeping earlier ones', () => {
    expect(useDataStore.getState().data?.transactions).toHaveLength(25)
    useDataStore.getState().deleteRecurrenceFrom('rec-parent', '2026-04-10')
    const after = useDataStore.getState().data?.transactions ?? []
    expect(after).toHaveLength(3) // Jan, Feb, Mar remain
    expect(after.every((t) => t.date < '2026-04-10')).toBe(true)
  })

  it('records the removed occurrence ids as tombstones in deletedIds', () => {
    useDataStore.getState().deleteRecurrenceFrom('rec-parent', '2026-04-10')
    expect(useDataStore.getState().data?.deletedIds).toHaveLength(22) // 25 - 3
  })
})

// ─── B-22: refreshRecurrenceHorizons — rolling window top-up ──────────────────

describe('B-22: refreshRecurrenceHorizons', () => {
  const account = makeAccount({ id: 'acc-r' })
  const category = makeCategory({ id: 'cat-r', type: 'INCOME' })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('extends an open-ended series once "today" approaches the materialized horizon', () => {
    useDataStore.setState({
      data: makeDataFile({ accounts: [account], categories: [category] }),
    })
    useDataStore.getState().addTransaction(
      makeTransaction({
        id: 'rec-parent',
        accountId: 'acc-r',
        categoryId: 'cat-r',
        type: 'INCOME',
        amount: 1000,
        date: '2026-01-10',
        description: 'Salário',
        isPaid: true,
        recurrence: { frequency: 'monthly', parentId: 'rec-parent' },
      })
    )
    // 25 occurrences generated at creation: 2026-01-10 .. 2028-01-10 (24-month horizon).
    expect(useDataStore.getState().data?.transactions).toHaveLength(25)

    // Jump "today" close to the materialized horizon (2028-01-10).
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2027-12-15'))
    useDataStore.getState().refreshRecurrenceHorizons()

    const txs = useDataStore.getState().data?.transactions ?? []
    const maxDate = txs.reduce((m, t) => (t.date > m ? t.date : m), '')
    // New horizon: 2027-12-15 + 24 months = 2029-12-15 → 23 new monthly occurrences
    // from 2028-02-10 through 2029-12-10 (25 + 23 = 48 total).
    expect(txs).toHaveLength(48)
    expect(maxDate).toBe('2029-12-10')
    expect(txs.every((t) => t.recurrence?.parentId === 'rec-parent')).toBe(true)
    const newOnes = txs.filter((t) => t.date > '2028-01-10')
    expect(newOnes).toHaveLength(23)
    expect(newOnes.every((t) => t.isPaid === false)).toBe(true)
  })

  it('does not duplicate occurrences already materialized within the horizon', () => {
    useDataStore.setState({
      data: makeDataFile({ accounts: [account], categories: [category] }),
    })
    useDataStore.getState().addTransaction(
      makeTransaction({
        id: 'rec-parent',
        accountId: 'acc-r',
        categoryId: 'cat-r',
        type: 'INCOME',
        amount: 1000,
        date: '2026-01-10',
        isPaid: true,
        recurrence: { frequency: 'monthly', parentId: 'rec-parent' },
      })
    )
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15')) // far from the horizon — no top-up needed
    useDataStore.getState().refreshRecurrenceHorizons()
    expect(useDataStore.getState().data?.transactions).toHaveLength(25)
  })

  it('does not extend a series that has an explicit endDate', () => {
    useDataStore.setState({
      data: makeDataFile({ accounts: [account], categories: [category] }),
    })
    useDataStore.getState().addTransaction(
      makeTransaction({
        id: 'rec-parent',
        accountId: 'acc-r',
        categoryId: 'cat-r',
        type: 'INCOME',
        amount: 1000,
        date: '2026-01-01',
        isPaid: true,
        recurrence: { frequency: 'weekly', parentId: 'rec-parent', endDate: '2026-01-29' },
      })
    )
    expect(useDataStore.getState().data?.transactions).toHaveLength(5)

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2027-12-31')) // far in the future — would top up an open series
    useDataStore.getState().refreshRecurrenceHorizons()
    expect(useDataStore.getState().data?.transactions).toHaveLength(5)
  })
})

// ─── CC-27: deleteInstallmentGroup ────────────────────────────────────────────

describe('deleteInstallmentGroup (CC-27)', () => {
  const installmentTxs: import('@/types').Transaction[] = [
    {
      id: 'inst-1',
      accountId: 'acc-1',
      categoryId: 'cat-1',
      amount: 100,
      type: 'EXPENSE',
      date: '2024-03-15',
      description: 'Viagem (1/3)',
      isPaid: false,
      tags: [],
      installment: { parentId: 'parent-abc', currentIndex: 1, total: 3 },
    },
    {
      id: 'inst-2',
      accountId: 'acc-1',
      categoryId: 'cat-1',
      amount: 100,
      type: 'EXPENSE',
      date: '2024-04-15',
      description: 'Viagem (2/3)',
      isPaid: false,
      tags: [],
      installment: { parentId: 'parent-abc', currentIndex: 2, total: 3 },
    },
    {
      id: 'inst-3',
      accountId: 'acc-1',
      categoryId: 'cat-1',
      amount: 100,
      type: 'EXPENSE',
      date: '2024-05-15',
      description: 'Viagem (3/3)',
      isPaid: false,
      tags: [],
      installment: { parentId: 'parent-abc', currentIndex: 3, total: 3 },
    },
  ]

  const otherTx: import('@/types').Transaction = {
    id: 'other-tx',
    accountId: 'acc-1',
    categoryId: 'cat-1',
    amount: 500,
    type: 'EXPENSE',
    date: '2024-03-01',
    description: 'Aluguel',
    isPaid: true,
    tags: [],
  }

  beforeEach(() => {
    useDataStore.setState({
      data: makeDataFile({
        accounts: [makeAccount({ id: 'acc-1' })],
        transactions: [...installmentTxs, otherTx],
      }),
    })
  })

  it('removes all transactions with the given parentId', () => {
    useDataStore.getState().deleteInstallmentGroup('parent-abc')
    const txs = useDataStore.getState().data?.transactions ?? []
    expect(txs).toHaveLength(1)
    expect(txs[0].id).toBe('other-tx')
  })

  it('does not affect transactions without the given parentId', () => {
    useDataStore.getState().deleteInstallmentGroup('parent-abc')
    const remaining = useDataStore.getState().data?.transactions ?? []
    expect(remaining[0].id).toBe('other-tx')
  })

  it('creates a DELETE audit log entry with parentId as entityId', () => {
    useDataStore.getState().deleteInstallmentGroup('parent-abc')
    const log = useDataStore.getState().data?.auditLog ?? []
    const entry = log.find((e) => e.entityId === 'parent-abc')
    expect(entry).toBeDefined()
    expect(entry?.action).toBe('DELETE')
  })

  it('audit summary mentions the parcel count and description', () => {
    useDataStore.getState().deleteInstallmentGroup('parent-abc')
    const entry = useDataStore.getState().data?.auditLog.find((e) => e.entityId === 'parent-abc')
    expect(entry?.summary).toContain('3')
    expect(entry?.summary).toContain('Viagem')
  })
})

// ─── deletedIds tombstone (B-11) ──────────────────────────────────────────────

describe('deletedIds tombstone (B-11)', () => {
  it('deleteAccount registers id in deletedIds', () => {
    useDataStore.setState({ data: makeDataFile({ accounts: [makeAccount({ id: 'acc-del' })] }) })
    useDataStore.getState().deleteAccount('acc-del')
    expect(useDataStore.getState().data?.deletedIds).toContain('acc-del')
  })

  it('deleteCategory registers id in deletedIds', () => {
    useDataStore.setState({
      data: makeDataFile({ categories: [makeCategory({ id: 'cat-del' })] }),
    })
    useDataStore.getState().deleteCategory('cat-del')
    expect(useDataStore.getState().data?.deletedIds).toContain('cat-del')
  })

  it('deleteTag registers id in deletedIds', () => {
    useDataStore.setState({ data: makeDataFile({ tags: [makeTag({ id: 'tag-del' })] }) })
    useDataStore.getState().deleteTag('tag-del')
    expect(useDataStore.getState().data?.deletedIds).toContain('tag-del')
  })

  it('deleteTransaction registers id in deletedIds', () => {
    useDataStore.setState({
      data: makeDataFile({ transactions: [makeTransaction({ id: 'tx-del' })] }),
    })
    useDataStore.getState().deleteTransaction('tx-del')
    expect(useDataStore.getState().data?.deletedIds).toContain('tx-del')
  })

  it('deleteInstallmentGroup registers all installment IDs in deletedIds', () => {
    const txs = [
      makeTransaction({
        id: 'tx-i1',
        installment: { parentId: 'par-1', currentIndex: 1, total: 2 },
      }),
      makeTransaction({
        id: 'tx-i2',
        installment: { parentId: 'par-1', currentIndex: 2, total: 2 },
      }),
    ]
    useDataStore.setState({ data: makeDataFile({ transactions: txs }) })
    useDataStore.getState().deleteInstallmentGroup('par-1')
    const deletedIds = useDataStore.getState().data?.deletedIds ?? []
    expect(deletedIds).toContain('tx-i1')
    expect(deletedIds).toContain('tx-i2')
  })

  it('deletedIds accumulates across multiple delete operations', () => {
    useDataStore.setState({
      data: makeDataFile({
        accounts: [makeAccount({ id: 'acc-a' }), makeAccount({ id: 'acc-b', name: 'B' })],
      }),
    })
    useDataStore.getState().deleteAccount('acc-a')
    useDataStore.getState().deleteAccount('acc-b')
    const deletedIds = useDataStore.getState().data?.deletedIds ?? []
    expect(deletedIds).toContain('acc-a')
    expect(deletedIds).toContain('acc-b')
  })
})

// ─── Valuations (NW-08) ───────────────────────────────────────────────────────

function makeValuation(overrides: Partial<Valuation> = {}): Valuation {
  return {
    id: 'val-1',
    accountId: 'acc-invest',
    date: '2026-01-31',
    marketValue: 10000,
    ...overrides,
  }
}

describe('addValuation', () => {
  it('appends valuation and creates audit entry referencing the account', () => {
    useDataStore.setState({
      data: makeDataFile({
        accounts: [
          { id: 'acc-invest', name: 'Ações', type: 'STOCKS', balance: 0, includeInBalance: true },
        ],
      }),
    })
    useDataStore.getState().addValuation(makeValuation())
    const { valuations, auditLog } = useDataStore.getState().data!
    expect(valuations).toHaveLength(1)
    expect(valuations[0].id).toBe('val-1')
    expect(valuations[0].marketValue).toBe(10000)
    const entry = auditLog.at(-1)!
    expect(entry.action).toBe('CREATE')
    expect(entry.entity).toBe('account')
    expect(entry.entityId).toBe('acc-invest')
    expect(entry.summary).toContain('Ações')
  })

  it('does nothing when data is null', () => {
    useDataStore.setState({ data: null })
    useDataStore.getState().addValuation(makeValuation())
    expect(useDataStore.getState().data).toBeNull()
  })
})

describe('updateValuation', () => {
  it('updates an existing valuation in place', () => {
    useDataStore.setState({
      data: makeDataFile({
        accounts: [
          { id: 'acc-invest', name: 'Cripto', type: 'CRYPTO', balance: 0, includeInBalance: true },
        ],
        valuations: [makeValuation()],
      }),
    })
    useDataStore
      .getState()
      .updateValuation(makeValuation({ marketValue: 15000, date: '2026-02-28' }))
    const { valuations, auditLog } = useDataStore.getState().data!
    expect(valuations).toHaveLength(1)
    expect(valuations[0].marketValue).toBe(15000)
    expect(valuations[0].date).toBe('2026-02-28')
    const entry = auditLog.at(-1)!
    expect(entry.action).toBe('UPDATE')
    expect(entry.entity).toBe('account')
    expect(entry.summary).toContain('15000')
  })

  it('does not add a new entry if id is not found', () => {
    useDataStore.setState({ data: makeDataFile({ valuations: [makeValuation()] }) })
    useDataStore.getState().updateValuation(makeValuation({ id: 'nonexistent' }))
    expect(useDataStore.getState().data!.valuations).toHaveLength(1)
    expect(useDataStore.getState().data!.valuations[0].id).toBe('val-1')
  })
})

describe('deleteValuation', () => {
  it('removes valuation and records id in deletedIds', () => {
    useDataStore.setState({
      data: makeDataFile({
        accounts: [
          { id: 'acc-invest', name: 'Forex', type: 'FOREX', balance: 0, includeInBalance: true },
        ],
        valuations: [makeValuation()],
      }),
    })
    useDataStore.getState().deleteValuation('val-1')
    const { valuations, deletedIds, auditLog } = useDataStore.getState().data!
    expect(valuations).toHaveLength(0)
    expect(deletedIds).toContain('val-1')
    const entry = auditLog.at(-1)!
    expect(entry.action).toBe('DELETE')
    expect(entry.entity).toBe('account')
  })

  it('does nothing when data is null', () => {
    useDataStore.setState({ data: null })
    useDataStore.getState().deleteValuation('val-1')
    expect(useDataStore.getState().data).toBeNull()
  })

  it('is idempotent: deleting a non-existent id does not crash', () => {
    useDataStore.setState({ data: makeDataFile({ valuations: [] }) })
    expect(() => useDataStore.getState().deleteValuation('ghost-id')).not.toThrow()
    expect(useDataStore.getState().data!.deletedIds).toContain('ghost-id')
  })
})

// ─── Saved periods (M-45) ─────────────────────────────────────────────────────

function makeSavedPeriod(overrides: Partial<SavedPeriod> = {}): SavedPeriod {
  return {
    id: 'sp-1',
    name: 'Q1 2026',
    start: '2026-01-01',
    end: '2026-03-31',
    ...overrides,
  }
}

describe('addSavedPeriod', () => {
  it('appends the period and creates a CREATE audit entry', () => {
    useDataStore.setState({ data: makeDataFile() })
    useDataStore.getState().addSavedPeriod(makeSavedPeriod())
    const { savedPeriods, auditLog } = useDataStore.getState().data!
    expect(savedPeriods).toHaveLength(1)
    expect(savedPeriods[0].name).toBe('Q1 2026')
    const entry = auditLog.at(-1)!
    expect(entry.action).toBe('CREATE')
    expect(entry.entity).toBe('savedPeriod')
    expect(entry.summary).toContain('Q1 2026')
  })

  it('does nothing when data is null', () => {
    useDataStore.setState({ data: null })
    useDataStore.getState().addSavedPeriod(makeSavedPeriod())
    expect(useDataStore.getState().data).toBeNull()
  })
})

describe('deleteSavedPeriod', () => {
  it('removes the period and records id in deletedIds with a DELETE audit entry', () => {
    useDataStore.setState({ data: makeDataFile({ savedPeriods: [makeSavedPeriod()] }) })
    useDataStore.getState().deleteSavedPeriod('sp-1')
    const { savedPeriods, deletedIds, auditLog } = useDataStore.getState().data!
    expect(savedPeriods).toHaveLength(0)
    expect(deletedIds).toContain('sp-1')
    const entry = auditLog.at(-1)!
    expect(entry.action).toBe('DELETE')
    expect(entry.entity).toBe('savedPeriod')
    expect(entry.summary).toContain('Q1 2026')
  })

  it('is idempotent: deleting a non-existent id does not crash', () => {
    useDataStore.setState({ data: makeDataFile({ savedPeriods: [] }) })
    expect(() => useDataStore.getState().deleteSavedPeriod('ghost-id')).not.toThrow()
    expect(useDataStore.getState().data!.deletedIds).toContain('ghost-id')
  })
})

// ─── Caixinhas (F-30/BX-04) ────────────────────────────────────────────────────

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'bx-1',
    name: 'Viagem',
    emoji: '✈️',
    color: '#1B4F72',
    kind: 'expense',
    target: 1000,
    period: { mode: 'range', start: '2026-01-01', end: '2026-12-31' },
    ...overrides,
  }
}

describe('addBudget', () => {
  it('appends the budget and creates a CREATE audit entry', () => {
    useDataStore.setState({ data: makeDataFile() })
    useDataStore.getState().addBudget(makeBudget())
    const { budgets, auditLog } = useDataStore.getState().data!
    expect(budgets).toHaveLength(1)
    expect(budgets[0].name).toBe('Viagem')
    expect(budgets[0].updatedAt).toBeTruthy()
    expect(budgets[0].createdAt).toBeTruthy()
    const entry = auditLog.at(-1)!
    expect(entry.action).toBe('CREATE')
    expect(entry.entity).toBe('budget')
    expect(entry.summary).toContain('Viagem')
  })

  it('does nothing when data is null', () => {
    useDataStore.setState({ data: null })
    useDataStore.getState().addBudget(makeBudget())
    expect(useDataStore.getState().data).toBeNull()
  })
})

describe('updateBudget', () => {
  it('updates an existing budget', () => {
    useDataStore.setState({ data: makeDataFile({ budgets: [makeBudget({ target: 1000 })] }) })
    useDataStore.getState().updateBudget(makeBudget({ target: 2000 }))
    expect(useDataStore.getState().data?.budgets[0].target).toBe(2000)
  })

  it('does not crash on a non-existent budget', () => {
    useDataStore.setState({ data: makeDataFile() })
    expect(() => useDataStore.getState().updateBudget(makeBudget({ id: 'ghost' }))).not.toThrow()
  })

  it('preserves createdAt when the caller passes it through unchanged', () => {
    useDataStore.setState({
      data: makeDataFile({ budgets: [makeBudget({ createdAt: '2026-01-01T00:00:00.000Z' })] }),
    })
    useDataStore
      .getState()
      .updateBudget(makeBudget({ target: 2000, createdAt: '2026-01-01T00:00:00.000Z' }))
    expect(useDataStore.getState().data?.budgets[0].createdAt).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('deleteBudget', () => {
  it('removes the budget and records id in deletedIds with a DELETE audit entry', () => {
    useDataStore.setState({ data: makeDataFile({ budgets: [makeBudget()] }) })
    useDataStore.getState().deleteBudget('bx-1')
    const { budgets, deletedIds, auditLog } = useDataStore.getState().data!
    expect(budgets).toHaveLength(0)
    expect(deletedIds).toContain('bx-1')
    const entry = auditLog.at(-1)!
    expect(entry.action).toBe('DELETE')
    expect(entry.entity).toBe('budget')
    expect(entry.summary).toContain('Viagem')
  })

  it('strips the budget id from every linked transaction, without deleting the transactions', () => {
    useDataStore.setState({
      data: makeDataFile({
        budgets: [makeBudget()],
        transactions: [
          makeTransaction({ id: 'tx-1', budgetIds: ['bx-1'] }),
          makeTransaction({ id: 'tx-2', budgetIds: ['bx-1', 'bx-2'] }),
          makeTransaction({ id: 'tx-3', budgetIds: ['bx-2'] }),
        ],
      }),
    })
    useDataStore.getState().deleteBudget('bx-1')
    const { transactions, deletedIds } = useDataStore.getState().data!
    expect(transactions).toHaveLength(3)
    expect(transactions.find((t) => t.id === 'tx-1')?.budgetIds).toEqual([])
    expect(transactions.find((t) => t.id === 'tx-2')?.budgetIds).toEqual(['bx-2'])
    expect(transactions.find((t) => t.id === 'tx-3')?.budgetIds).toEqual(['bx-2'])
    expect(deletedIds).not.toContain('tx-1')
  })

  it('is idempotent: deleting a non-existent id does not crash', () => {
    useDataStore.setState({ data: makeDataFile({ budgets: [] }) })
    expect(() => useDataStore.getState().deleteBudget('ghost-id')).not.toThrow()
    expect(useDataStore.getState().data!.deletedIds).toContain('ghost-id')
  })
})

describe('archiveBudget', () => {
  it('sets archivedAt without touching linked transactions', () => {
    useDataStore.setState({
      data: makeDataFile({
        budgets: [makeBudget()],
        transactions: [makeTransaction({ id: 'tx-1', budgetIds: ['bx-1'] })],
      }),
    })
    useDataStore.getState().archiveBudget('bx-1')
    const { budgets, transactions, auditLog } = useDataStore.getState().data!
    expect(budgets[0].archivedAt).toBeTruthy()
    expect(transactions[0].budgetIds).toEqual(['bx-1'])
    const entry = auditLog.at(-1)!
    expect(entry.entity).toBe('budget')
    expect(entry.summary).toContain('arquivada')
  })

  it('is idempotent: archiving a non-existent id does not crash', () => {
    useDataStore.setState({ data: makeDataFile({ budgets: [] }) })
    expect(() => useDataStore.getState().archiveBudget('ghost-id')).not.toThrow()
  })
})

describe('linkTransactionToBudget', () => {
  it('adds the budget id to the transaction budgetIds', () => {
    useDataStore.setState({
      data: makeDataFile({
        budgets: [makeBudget()],
        transactions: [makeTransaction({ id: 'tx-1', budgetIds: [] })],
      }),
    })
    useDataStore.getState().linkTransactionToBudget('bx-1', 'tx-1')
    const { transactions, auditLog } = useDataStore.getState().data!
    expect(transactions[0].budgetIds).toEqual(['bx-1'])
    const entry = auditLog.at(-1)!
    expect(entry.entity).toBe('budget')
    expect(entry.entityId).toBe('bx-1')
    expect(entry.summary).toContain('associado')
  })

  it('is idempotent: linking an already-linked transaction does not duplicate the id', () => {
    useDataStore.setState({
      data: makeDataFile({
        budgets: [makeBudget()],
        transactions: [makeTransaction({ id: 'tx-1', budgetIds: ['bx-1'] })],
      }),
    })
    useDataStore.getState().linkTransactionToBudget('bx-1', 'tx-1')
    expect(useDataStore.getState().data!.transactions[0].budgetIds).toEqual(['bx-1'])
  })

  it('does not crash when the budget or transaction does not exist', () => {
    useDataStore.setState({ data: makeDataFile({ budgets: [makeBudget()], transactions: [] }) })
    expect(() => useDataStore.getState().linkTransactionToBudget('bx-1', 'ghost-tx')).not.toThrow()
    expect(() =>
      useDataStore.getState().linkTransactionToBudget('ghost-budget', 'tx-1')
    ).not.toThrow()
  })
})

describe('unlinkTransactionFromBudget', () => {
  it('removes the budget id from the transaction budgetIds', () => {
    useDataStore.setState({
      data: makeDataFile({
        budgets: [makeBudget()],
        transactions: [makeTransaction({ id: 'tx-1', budgetIds: ['bx-1', 'bx-2'] })],
      }),
    })
    useDataStore.getState().unlinkTransactionFromBudget('bx-1', 'tx-1')
    const { transactions, auditLog } = useDataStore.getState().data!
    expect(transactions[0].budgetIds).toEqual(['bx-2'])
    const entry = auditLog.at(-1)!
    expect(entry.summary).toContain('desvinculado')
  })

  it('is idempotent: unlinking a transaction that is not linked does not crash', () => {
    useDataStore.setState({
      data: makeDataFile({
        budgets: [makeBudget()],
        transactions: [makeTransaction({ id: 'tx-1', budgetIds: [] })],
      }),
    })
    expect(() => useDataStore.getState().unlinkTransactionFromBudget('bx-1', 'tx-1')).not.toThrow()
    expect(useDataStore.getState().data!.transactions[0].budgetIds).toEqual([])
  })
})

// ─── Receita Quadrantes (F-30/BX-07/BX-08) ─────────────────────────────────────

describe('ensureQuadrantesBatch', () => {
  it('does nothing when the recipe is disabled', () => {
    useDataStore.setState({
      data: makeDataFile({ settings: { ...makeDataFile().settings, quadrantesEnabled: false } }),
    })
    useDataStore.getState().ensureQuadrantesBatch()
    expect(useDataStore.getState().data!.budgets).toHaveLength(0)
  })

  it('does nothing when data is null', () => {
    useDataStore.setState({ data: null })
    expect(() => useDataStore.getState().ensureQuadrantesBatch()).not.toThrow()
  })

  it('generates the 4-budget batch and an audit entry when enabled and no batch exists yet', () => {
    useDataStore.setState({
      data: makeDataFile({ settings: { ...makeDataFile().settings, quadrantesEnabled: true } }),
    })
    useDataStore.getState().ensureQuadrantesBatch()
    const { budgets, auditLog } = useDataStore.getState().data!
    expect(budgets).toHaveLength(4)
    expect(budgets.every((b) => b.recipeSlug === 'quadrantes')).toBe(true)
    const entry = auditLog.at(-1)!
    expect(entry.entity).toBe('budget')
    expect(entry.summary).toContain('Quadrantes')
  })

  it('is idempotent: calling it again the same month does not duplicate the batch', () => {
    useDataStore.setState({
      data: makeDataFile({ settings: { ...makeDataFile().settings, quadrantesEnabled: true } }),
    })
    useDataStore.getState().ensureQuadrantesBatch()
    useDataStore.getState().ensureQuadrantesBatch()
    expect(useDataStore.getState().data!.budgets).toHaveLength(4)
  })
})

describe('setQuadrantesEnabled', () => {
  it('persists the toggle', () => {
    useDataStore.setState({ data: makeDataFile() })
    useDataStore.getState().setQuadrantesEnabled(true)
    expect(useDataStore.getState().data!.settings.quadrantesEnabled).toBe(true)
  })

  it('generates the current-month batch immediately when turned on', () => {
    useDataStore.setState({ data: makeDataFile() })
    useDataStore.getState().setQuadrantesEnabled(true)
    expect(useDataStore.getState().data!.budgets).toHaveLength(4)
  })

  it('turning off does not delete already-generated budgets', () => {
    useDataStore.setState({
      data: makeDataFile({ settings: { ...makeDataFile().settings, quadrantesEnabled: true } }),
    })
    useDataStore.getState().ensureQuadrantesBatch()
    useDataStore.getState().setQuadrantesEnabled(false)
    expect(useDataStore.getState().data!.budgets).toHaveLength(4)
    expect(useDataStore.getState().data!.settings.quadrantesEnabled).toBe(false)
  })
})

describe('addTransaction — BX-08 auto-link by date', () => {
  function activeQuadranteBudgets(): Budget[] {
    const today = new Date()
    const y = today.getFullYear()
    const m = String(today.getMonth() + 1).padStart(2, '0')
    return [
      makeBudget({
        id: 'q-slot1',
        recipeSlug: 'quadrantes',
        recipeSlot: 1,
        period: { mode: 'range', start: `${y}-${m}-01`, end: `${y}-${m}-08` },
      }),
    ]
  }

  it('links a new EXPENSE transaction whose date falls in a quadrante range', () => {
    const today = new Date()
    const y = today.getFullYear()
    const m = String(today.getMonth() + 1).padStart(2, '0')
    useDataStore.setState({ data: makeDataFile({ budgets: activeQuadranteBudgets() }) })
    useDataStore
      .getState()
      .addTransaction(makeTransaction({ id: 'tx-1', type: 'EXPENSE', date: `${y}-${m}-03` }))
    expect(useDataStore.getState().data!.transactions[0].budgetIds).toEqual(['q-slot1'])
  })

  it('does not link a TRANSFER even if its date matches a quadrante range', () => {
    const today = new Date()
    const y = today.getFullYear()
    const m = String(today.getMonth() + 1).padStart(2, '0')
    useDataStore.setState({ data: makeDataFile({ budgets: activeQuadranteBudgets() }) })
    useDataStore.getState().addTransaction(
      makeTransaction({
        id: 'tx-1',
        type: 'TRANSFER',
        date: `${y}-${m}-03`,
        transferAccountId: 'acc-2',
      })
    )
    expect(useDataStore.getState().data!.transactions[0].budgetIds ?? []).toEqual([])
  })

  it('does not link an EXPENSE whose date falls outside every quadrante range', () => {
    useDataStore.setState({ data: makeDataFile({ budgets: activeQuadranteBudgets() }) })
    useDataStore
      .getState()
      .addTransaction(makeTransaction({ id: 'tx-1', type: 'EXPENSE', date: '2020-01-15' }))
    expect(useDataStore.getState().data!.transactions[0].budgetIds ?? []).toEqual([])
  })

  it('links each installment individually by its own date (P-7)', () => {
    const today = new Date()
    const y = today.getFullYear()
    const m = String(today.getMonth() + 1).padStart(2, '0')
    const budgets = [
      makeBudget({
        id: 'q-slot1',
        recipeSlug: 'quadrantes',
        recipeSlot: 1,
        period: { mode: 'range', start: `${y}-${m}-01`, end: `${y}-${m}-08` },
      }),
      makeBudget({
        id: 'q-slot2',
        recipeSlug: 'quadrantes',
        recipeSlot: 2,
        period: { mode: 'range', start: `${y}-${m}-09`, end: `${y}-${m}-16` },
      }),
    ]
    useDataStore.setState({ data: makeDataFile({ budgets }) })
    useDataStore.getState().addTransaction(
      makeTransaction({
        id: 'parent-1',
        type: 'EXPENSE',
        date: `${y}-${m}-03`,
        installment: { parentId: 'parent-1', currentIndex: 1, total: 2 },
      })
    )
    const { transactions } = useDataStore.getState().data!
    expect(transactions).toHaveLength(2)
    // 1st installment falls in slot 1's range; the 2nd (one month later) falls outside both.
    expect(transactions[0].budgetIds).toEqual(['q-slot1'])
  })
})

describe('updateTransaction — BX-08 move-on-date-change', () => {
  function slotBudgets() {
    const today = new Date()
    const y = today.getFullYear()
    const m = String(today.getMonth() + 1).padStart(2, '0')
    return {
      y,
      m,
      budgets: [
        makeBudget({
          id: 'q-slot1',
          recipeSlug: 'quadrantes',
          recipeSlot: 1,
          period: { mode: 'range', start: `${y}-${m}-01`, end: `${y}-${m}-08` },
        }),
        makeBudget({
          id: 'q-slot2',
          recipeSlug: 'quadrantes',
          recipeSlot: 2,
          period: { mode: 'range', start: `${y}-${m}-09`, end: `${y}-${m}-16` },
        }),
      ],
    }
  }

  it('moves the auto-link when the date is edited into a different quadrante', () => {
    const { y, m, budgets } = slotBudgets()
    useDataStore.setState({
      data: makeDataFile({
        budgets,
        transactions: [
          makeTransaction({
            id: 'tx-1',
            type: 'EXPENSE',
            date: `${y}-${m}-03`,
            budgetIds: ['q-slot1'],
          }),
        ],
      }),
    })
    useDataStore.getState().updateTransaction(
      makeTransaction({
        id: 'tx-1',
        type: 'EXPENSE',
        date: `${y}-${m}-12`,
        budgetIds: ['q-slot1'],
      })
    )
    expect(useDataStore.getState().data!.transactions[0].budgetIds).toEqual(['q-slot2'])
  })

  it('does not reintroduce a manually-removed link when the date is left unchanged', () => {
    const { y, m, budgets } = slotBudgets()
    useDataStore.setState({
      data: makeDataFile({
        budgets,
        transactions: [
          makeTransaction({ id: 'tx-1', type: 'EXPENSE', date: `${y}-${m}-03`, budgetIds: [] }),
        ],
      }),
    })
    // Same date as before — a plain edit (e.g. description) must not reactivate the sweep.
    useDataStore.getState().updateTransaction(
      makeTransaction({
        id: 'tx-1',
        type: 'EXPENSE',
        date: `${y}-${m}-03`,
        description: 'edited',
        budgetIds: [],
      })
    )
    expect(useDataStore.getState().data!.transactions[0].budgetIds).toEqual([])
  })

  it('preserves manual (non-recipe) budget links when the date moves between quadrantes', () => {
    const { y, m, budgets } = slotBudgets()
    const manual = makeBudget({ id: 'manual-1', recipeSlug: undefined, recipeSlot: undefined })
    useDataStore.setState({
      data: makeDataFile({
        budgets: [...budgets, manual],
        transactions: [
          makeTransaction({
            id: 'tx-1',
            type: 'EXPENSE',
            date: `${y}-${m}-03`,
            budgetIds: ['q-slot1', 'manual-1'],
          }),
        ],
      }),
    })
    useDataStore.getState().updateTransaction(
      makeTransaction({
        id: 'tx-1',
        type: 'EXPENSE',
        date: `${y}-${m}-12`,
        budgetIds: ['q-slot1', 'manual-1'],
      })
    )
    const budgetIds = useDataStore.getState().data!.transactions[0].budgetIds!
    expect(budgetIds).toContain('manual-1')
    expect(budgetIds).toContain('q-slot2')
    expect(budgetIds).not.toContain('q-slot1')
  })
})
