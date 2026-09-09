import { describe, it, expect } from 'vitest'
import {
  hashRow,
  combineHashes,
  accountRowKey,
  categoryRowKey,
  tagRowKey,
  budgetRowKey,
  valuationRowKey,
  savedPeriodRowKey,
  auditEntryRowKey,
  transactionRowKey,
  deletedIdRowKey,
  deviceRowKey,
  hypothesisRowKey,
  HASH_VERSION,
} from '@/lib/storage/rowHash'
import type {
  RawAccount,
  RawCategory,
  RawTag,
  RawTransaction,
  RawBudget,
  RawValuation,
  RawSavedPeriod,
  RawAuditEntry,
  RawDevice,
  RawHypothesis,
} from '@/services/storage/worker'

function makeFullTransaction(overrides: Partial<RawTransaction> = {}): RawTransaction {
  return {
    id: 'tx-1',
    accountId: 'acc-1',
    categoryId: 'cat-1',
    amount: 100,
    type: 'EXPENSE',
    date: '2026-01-15',
    description: 'Original',
    isPaid: true,
    tags: ['tag-a', 'tag-b'],
    budgetIds: ['bud-a'],
    installment: { parentId: 'parent-1', currentIndex: 1, total: 3, purchaseDate: '2026-01-01' },
    recurrence: { frequency: 'monthly', parentId: 'parent-2', endDate: '2026-12-31' },
    transferAccountId: 'acc-2',
    referenceMonth: '2026-01',
    invoiceDueDate: '2026-02-10',
    notes: 'Original note',
    updatedAt: '2026-01-15T10:00:00.000Z',
    createdAt: '2026-01-15T09:00:00.000Z',
    ...overrides,
  }
}

function makeFullHypothesis(overrides: Partial<RawHypothesis> = {}): RawHypothesis {
  return {
    id: 'hy-1',
    name: 'Pós-graduação',
    enabled: true,
    items: [
      {
        id: 'item-1',
        kind: 'INSTALLMENT',
        description: 'Parcela',
        type: 'EXPENSE',
        amount: 500,
        startDate: '2026-01-01',
        installmentCount: 24,
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeFullAccount(overrides: Partial<RawAccount> = {}): RawAccount {
  return {
    id: 'acc-1',
    name: 'Conta',
    type: 'RETAIL',
    balance: 100,
    includeInBalance: true,
    creditMetadata: { limit: 1000, closingDay: 10, dueDay: 20 },
    loanMetadata: {
      outstandingBalance: 500,
      monthlyPayment: 50,
      remainingInstallments: 10,
      interestRate: 1.5,
    },
    reserveMetadata: {},
    issuerIcon: 'nubank',
    archived: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('hashRow / combineHashes', () => {
  it('is deterministic', () => {
    expect(hashRow('abc')).toBe(hashRow('abc'))
  })

  it('is sensitive to any content difference', () => {
    expect(hashRow('abc')).not.toBe(hashRow('abd'))
    expect(hashRow('ab')).not.toBe(hashRow('abc'))
  })

  it('combineHashes is commutative — row visit order never matters', () => {
    const h1 = hashRow('row-1')
    const h2 = hashRow('row-2')
    const h3 = hashRow('row-3')
    expect(combineHashes([h1, h2, h3])).toBe(combineHashes([h3, h1, h2]))
    expect(combineHashes([h1, h2, h3])).toBe(combineHashes([h2, h3, h1]))
  })

  it('combineHashes([]) is 0 — an emptied partition hashes to a known, comparable value', () => {
    expect(combineHashes([])).toBe(0)
  })

  // Propriedade da qual toda a manutenção incremental (writeSmallTables/applyTransactionDelta)
  // depende: XOR-fold permite tirar/adicionar uma linha sem reler a partição inteira.
  it('XOR-fold is incrementally equivalent to recomputing from scratch', () => {
    const rows = ['row-a', 'row-b', 'row-c'].map(hashRow)
    const full = combineHashes(rows)

    // Remove 'row-b', add 'row-d' — incremental update via XOR.
    const removed = hashRow('row-b')
    const added = hashRow('row-d')
    const incremental = full ^ removed ^ added

    const recomputed = combineHashes(['row-a', 'row-c', 'row-d'].map(hashRow))
    expect(incremental).toBe(recomputed)
  })
})

// Guarda contra detecção silenciosa quebrada: se um campo novo entrar em Raw* e a função de
// serialização não for atualizada, o hash não muda quando deveria — mesmo padrão de
// transactionDiff.test.ts.
describe('row key functions detect a change in every field', () => {
  it('transactionRowKey', () => {
    const base = makeFullTransaction()
    const baseHash = hashRow(transactionRowKey(base))
    const overrides: Array<Partial<RawTransaction>> = [
      { accountId: 'acc-changed' },
      { categoryId: 'cat-changed' },
      { amount: 999 },
      { type: 'INCOME' },
      { description: 'Changed' },
      { date: '2026-02-01' },
      { isPaid: false },
      { tags: ['tag-changed'] },
      { budgetIds: ['bud-changed'] },
      { installment: { parentId: 'parent-changed', currentIndex: 2, total: 3 } },
      { recurrence: { frequency: 'weekly', parentId: 'parent-changed' } },
      { transferAccountId: 'acc-changed' },
      { referenceMonth: '2026-02' },
      { invoiceDueDate: '2026-03-10' },
      { notes: 'Changed note' },
      { updatedAt: '2026-01-16T10:00:00.000Z' },
      { createdAt: '2026-01-16T09:00:00.000Z' },
    ]
    for (const override of overrides) {
      const changed = makeFullTransaction(override)
      expect(
        hashRow(transactionRowKey(changed)),
        `field(s) ${Object.keys(override).join(',')} not detected`
      ).not.toBe(baseHash)
    }
  })

  it('transactionRowKey ignores tags/budgetIds reordering (same membership)', () => {
    const a = makeFullTransaction({ tags: ['a', 'b', 'c'], budgetIds: ['x', 'y'] })
    const b = makeFullTransaction({ tags: ['c', 'a', 'b'], budgetIds: ['y', 'x'] })
    expect(hashRow(transactionRowKey(a))).toBe(hashRow(transactionRowKey(b)))
  })

  it('accountRowKey', () => {
    const base = makeFullAccount()
    const baseHash = hashRow(accountRowKey(base))
    const overrides: Array<Partial<RawAccount>> = [
      { name: 'Changed' },
      { type: 'CREDIT' },
      { balance: 999 },
      { includeInBalance: false },
      { creditMetadata: { limit: 2000, closingDay: 10, dueDay: 20 } },
      { loanMetadata: { outstandingBalance: 999, monthlyPayment: 50, remainingInstallments: 10 } },
      { reserveMetadata: undefined },
      { issuerIcon: 'other' },
      { archived: true },
      { updatedAt: '2026-02-01T00:00:00.000Z' },
    ]
    for (const override of overrides) {
      const changed = makeFullAccount(override)
      expect(
        hashRow(accountRowKey(changed)),
        `field(s) ${Object.keys(override).join(',')} not detected`
      ).not.toBe(baseHash)
    }
  })

  it('categoryRowKey', () => {
    const base: RawCategory = {
      id: 'cat-1',
      parentId: null,
      name: 'Original',
      icon: 'circle',
      color: '#888',
      type: 'EXPENSE',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const baseHash = hashRow(categoryRowKey(base))
    const overrides: Array<Partial<RawCategory>> = [
      { parentId: 'cat-parent' },
      { name: 'Changed' },
      { icon: 'square' },
      { color: '#fff' },
      { type: 'INCOME' },
      { updatedAt: '2026-02-01T00:00:00.000Z' },
    ]
    for (const override of overrides) {
      expect(hashRow(categoryRowKey({ ...base, ...override }))).not.toBe(baseHash)
    }
  })

  it('tagRowKey', () => {
    const base: RawTag = { id: 'tag-1', name: 'Original', color: '#888' }
    const baseHash = hashRow(tagRowKey(base))
    expect(hashRow(tagRowKey({ ...base, name: 'Changed' }))).not.toBe(baseHash)
    expect(hashRow(tagRowKey({ ...base, color: '#fff' }))).not.toBe(baseHash)
  })

  it('budgetRowKey', () => {
    const base: RawBudget = {
      id: 'bud-1',
      name: 'Original',
      emoji: '💰',
      color: '#888',
      kind: 'EXPENSE',
      target: 100,
      period: { mode: 'date', date: '2026-01' },
    }
    const baseHash = hashRow(budgetRowKey(base))
    const overrides: Array<Partial<RawBudget>> = [
      { name: 'Changed' },
      { target: 999 },
      { period: { mode: 'range', start: '2026-01-01', end: '2026-01-31' } },
      { archivedAt: '2026-02-01' },
      { targetSource: 'manual' },
    ]
    for (const override of overrides) {
      expect(hashRow(budgetRowKey({ ...base, ...override }))).not.toBe(baseHash)
    }
  })

  it('valuationRowKey', () => {
    const base: RawValuation = {
      id: 'val-1',
      accountId: 'acc-1',
      date: '2026-01-01',
      marketValue: 100,
    }
    const baseHash = hashRow(valuationRowKey(base))
    expect(hashRow(valuationRowKey({ ...base, marketValue: 200 }))).not.toBe(baseHash)
  })

  it('savedPeriodRowKey', () => {
    const base: RawSavedPeriod = {
      id: 'sp-1',
      name: 'Original',
      start: '2026-01-01',
      end: '2026-01-31',
    }
    const baseHash = hashRow(savedPeriodRowKey(base))
    expect(hashRow(savedPeriodRowKey({ ...base, name: 'Changed' }))).not.toBe(baseHash)
  })

  it('auditEntryRowKey', () => {
    const base: RawAuditEntry = {
      id: 'audit-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      action: 'CREATE',
      entity: 'transaction',
      entityId: 'tx-1',
      summary: 'Original',
    }
    const baseHash = hashRow(auditEntryRowKey(base))
    expect(hashRow(auditEntryRowKey({ ...base, summary: 'Changed' }))).not.toBe(baseHash)
  })

  it('hypothesisRowKey', () => {
    const base = makeFullHypothesis()
    const baseHash = hashRow(hypothesisRowKey(base))
    const overrides: Array<Partial<RawHypothesis>> = [
      { name: 'Changed' },
      { enabled: false },
      { updatedAt: '2026-02-01T00:00:00.000Z' },
      {
        items: [
          {
            id: 'item-1',
            kind: 'INSTALLMENT',
            description: 'Parcela',
            type: 'EXPENSE',
            amount: 999,
            startDate: '2026-01-01',
            installmentCount: 24,
          },
        ],
      },
      { items: [] },
    ]
    for (const override of overrides) {
      expect(
        hashRow(hypothesisRowKey({ ...base, ...override })),
        `field(s) ${Object.keys(override).join(',')} not detected`
      ).not.toBe(baseHash)
    }
  })

  it('hypothesisItemRowKey (via hypothesisRowKey) detects a change in every item field', () => {
    const makeItem = (overrides: Partial<RawHypothesis['items'][number]> = {}) => ({
      id: 'item-1',
      kind: 'RECURRING' as const,
      description: 'Assinatura',
      type: 'EXPENSE' as const,
      amount: 100,
      startDate: '2026-01-01',
      frequency: 'monthly',
      endDate: '2026-12-31',
      categoryId: 'cat-1',
      ...overrides,
    })
    const base = makeFullHypothesis({ items: [makeItem()] })
    const baseHash = hashRow(hypothesisRowKey(base))
    const overrides: Array<Partial<RawHypothesis['items'][number]>> = [
      { kind: 'CATEGORY_TARGET' },
      { description: 'Changed' },
      { type: 'INCOME' },
      { amount: 999 },
      { startDate: '2026-02-01' },
      { installmentCount: 12 },
      { frequency: 'weekly' },
      { endDate: '2027-01-31' },
      { categoryId: 'cat-2' },
    ]
    for (const override of overrides) {
      const changed = makeFullHypothesis({ items: [makeItem(override)] })
      expect(
        hashRow(hypothesisRowKey(changed)),
        `field(s) ${Object.keys(override).join(',')} not detected`
      ).not.toBe(baseHash)
    }
  })

  it('hypothesisRowKey ignores items reordering (same membership)', () => {
    const item1 = {
      id: 'item-1',
      kind: 'ONE_TIME' as const,
      description: 'A',
      type: 'EXPENSE' as const,
      amount: 100,
      startDate: '2026-01-01',
    }
    const item2 = {
      id: 'item-2',
      kind: 'ONE_TIME' as const,
      description: 'B',
      type: 'EXPENSE' as const,
      amount: 200,
      startDate: '2026-02-01',
    }
    const a = makeFullHypothesis({ items: [item1, item2] })
    const b = makeFullHypothesis({ items: [item2, item1] })
    expect(hashRow(hypothesisRowKey(a))).toBe(hashRow(hypothesisRowKey(b)))
  })
})

// ─── CS-39: pinagem do esquema de hash ────────────────────────────────────────

const PIN = {
  account: makeFullAccount(),
  category: {
    id: 'cat-1',
    parentId: 'cat-parent',
    name: 'Mercado',
    icon: 'cart',
    color: '#ff0000',
    type: 'EXPENSE',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as RawCategory,
  tag: {
    id: 'tag-1',
    name: 'Casa',
    color: '#00ff00',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as RawTag,
  budget: {
    id: 'bud-1',
    name: 'Lazer',
    emoji: '🎬',
    color: '#0000ff',
    kind: 'spending',
    target: 500,
    period: { mode: 'date', date: '2026-01' },
    archivedAt: '2026-02-01T00:00:00.000Z',
    recipeSlug: 'quadrantes',
    recipeSlot: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    targetSource: 'manual',
  } as RawBudget,
  valuation: {
    id: 'val-1',
    accountId: 'acc-1',
    date: '2026-01-31',
    marketValue: 1234,
  } as RawValuation,
  savedPeriod: {
    id: 'sp-1',
    name: 'Janeiro',
    start: '2026-01-01',
    end: '2026-01-31',
  } as RawSavedPeriod,
  auditEntry: {
    id: 'audit-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    action: 'CREATE',
    entity: 'transaction',
    entityId: 'tx-1',
    summary: 'Criou',
  } as RawAuditEntry,
  deletedId: 'deleted-1',
  transaction: makeFullTransaction(),
  device: {
    id: 'dev-1',
    name: 'MacBook',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as RawDevice,
  hypothesis: makeFullHypothesis(),
}

/**
 * Valores congelados do esquema de hash vigente. **Se um destes falhar, não "conserte" o número:**
 * você mudou uma função de `rowHash.ts`, e o efeito é que dois dispositivos em versões diferentes
 * do app passam a calcular hashes distintos para dado idêntico — o hash-skip do sync deixa de
 * convergir entre eles. O procedimento é bumpar `HASH_VERSION` em `lib/storage/rowHash.ts` **e**
 * atualizar os literais abaixo, nessa ordem. `ensureTableHashesCurrent()` (worker.ts) cuida de
 * invalidar e recomputar as `table_hashes` já gravadas quando a versão muda.
 */
const PINNED_HASHES = {
  version: 4,
  account: 1036428690,
  category: 2381249970,
  tag: 2039225961,
  budget: 3290489023,
  valuation: 2714327257,
  savedPeriod: 1657429824,
  // M-96: auditEntryRowKey gained the deviceId field (bumps HASH_VERSION 1→2) — PIN.auditEntry has
  // no deviceId (mirrors a legacy entry from before the field existed), so its hash changed too.
  auditEntry: 1448598596,
  deletedId: 2643702044,
  // notes field added to transactionRowKey (bumps HASH_VERSION 3→4).
  transaction: 1080612523,
  device: 3849676930,
  // M-101: hypothesisRowKey is new (bumps HASH_VERSION 2→3).
  hypothesis: 3175325234,
} as const

describe('CS-39 — esquema de hash pinado', () => {
  const BUMP = 'mudou uma função de rowHash.ts? bumpe HASH_VERSION e atualize PINNED_HASHES'

  it(`HASH_VERSION está em ${PINNED_HASHES.version} — ${BUMP}`, () => {
    expect(HASH_VERSION).toBe(PINNED_HASHES.version)
  })

  it.each([
    ['account', () => hashRow(accountRowKey(PIN.account)), PINNED_HASHES.account],
    ['category', () => hashRow(categoryRowKey(PIN.category)), PINNED_HASHES.category],
    ['tag', () => hashRow(tagRowKey(PIN.tag)), PINNED_HASHES.tag],
    ['budget', () => hashRow(budgetRowKey(PIN.budget)), PINNED_HASHES.budget],
    ['valuation', () => hashRow(valuationRowKey(PIN.valuation)), PINNED_HASHES.valuation],
    ['savedPeriod', () => hashRow(savedPeriodRowKey(PIN.savedPeriod)), PINNED_HASHES.savedPeriod],
    ['auditEntry', () => hashRow(auditEntryRowKey(PIN.auditEntry)), PINNED_HASHES.auditEntry],
    ['deletedId', () => hashRow(deletedIdRowKey(PIN.deletedId)), PINNED_HASHES.deletedId],
    ['transaction', () => hashRow(transactionRowKey(PIN.transaction)), PINNED_HASHES.transaction],
    ['device', () => hashRow(deviceRowKey(PIN.device)), PINNED_HASHES.device],
    ['hypothesis', () => hashRow(hypothesisRowKey(PIN.hypothesis)), PINNED_HASHES.hypothesis],
  ])('%s mantém o hash congelado', (_name, compute, expected) => {
    expect(compute(), BUMP).toBe(expected)
  })
})

/**
 * Pré-condição da segurança do hash-skip, e o teste mais importante deste arquivo.
 *
 * O sync pula uma partição quando o hash do peer bate com o local, e a justificativa de que isso
 * não perde dado é: hash igual ⇒ multiconjunto de linhas idêntico **incluindo `updatedAt`** ⇒ as
 * linhas omitidas jamais venceriam o LWW de `mergeForSync` contra o que já está local. Se alguém
 * tirar `updatedAt` de uma row key, passa a existir "hash igual, LWW diferente" — e o skip vira
 * perda silenciosa de dado, a pior falha que esta otimização pode produzir.
 */
describe('CS-39 — updatedAt participa de toda row key que o carrega', () => {
  it.each([
    ['account', (v: string) => accountRowKey({ ...PIN.account, updatedAt: v })],
    ['category', (v: string) => categoryRowKey({ ...PIN.category, updatedAt: v })],
    ['tag', (v: string) => tagRowKey({ ...PIN.tag, updatedAt: v })],
    ['budget', (v: string) => budgetRowKey({ ...PIN.budget, updatedAt: v })],
    ['transaction', (v: string) => transactionRowKey({ ...PIN.transaction, updatedAt: v })],
    ['device', (v: string) => deviceRowKey({ ...PIN.device, updatedAt: v })],
    ['hypothesis', (v: string) => hypothesisRowKey({ ...PIN.hypothesis, updatedAt: v })],
  ])('%s: mudar só updatedAt muda a chave', (_name, keyOf) => {
    expect(keyOf('2026-01-01T00:00:00.000Z')).not.toBe(keyOf('2026-06-01T00:00:00.000Z'))
  })
})
