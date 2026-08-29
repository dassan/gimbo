import { describe, it, expect } from 'vitest'
import { computeAccountBalances, isCashRealized, parseDateLocal, sumBalances } from '@/lib/utils'
import type { Account, Transaction } from '@/types'

// HY-0 — prova de que o motor único (`computeAccountBalances`) reproduz as cinco cópias da regra
// de saldo que existiam antes dele. As implementações antigas estão reproduzidas aqui **verbatim**
// (só renomeadas) porque uma refatoração de motor de dinheiro só é confiável se a versão anterior
// continuar disponível para discordar dela.
//
// Duas divergências conhecidas estão fixadas no fim do arquivo em vez de escondidas: nos dois
// casos, quatro cópias concordavam e uma discordava, e o motor único adotou a maioria.

// ─── Implementações legadas, preservadas para comparação ─────────────────────

/** Dashboard e Configurações (blocos idênticos, copiados um do outro). */
function legacyDashboard(accounts: Account[], transactions: Transaction[]): Record<string, number> {
  const map: Record<string, number> = {}
  accounts
    .filter((a) => a.type !== 'CREDIT')
    .forEach((a) => {
      map[a.id] = a.balance
    })

  transactions.forEach((tx) => {
    if (tx.type === 'CREDIT_PAYMENT') {
      if (tx.transferAccountId) {
        const payer = accounts.find((a) => a.id === tx.transferAccountId)
        if (payer && payer.type !== 'CREDIT') {
          map[tx.transferAccountId] = (map[tx.transferAccountId] ?? 0) - tx.amount
        }
      }
      return
    }
    const account = accounts.find((a) => a.id === tx.accountId)
    if (!account || account.type === 'CREDIT') return
    if (!isCashRealized(tx)) return
    if (tx.type === 'INCOME') map[tx.accountId] = (map[tx.accountId] ?? 0) + tx.amount
    if (tx.type === 'EXPENSE') map[tx.accountId] = (map[tx.accountId] ?? 0) - tx.amount
    if (tx.type === 'TRANSFER') {
      map[tx.accountId] = (map[tx.accountId] ?? 0) - tx.amount
      if (tx.transferAccountId) {
        const dest = accounts.find((a) => a.id === tx.transferAccountId)
        if (dest && dest.type !== 'CREDIT') {
          map[tx.transferAccountId] = (map[tx.transferAccountId] ?? 0) + tx.amount
        }
      }
    }
  })
  return map
}

/** `getReserveBalance` (HE-13/HE-14). */
function legacyReserve(transactions: Transaction[], reserveAccounts: Account[]): number {
  const reserveIds = new Set(reserveAccounts.map((a) => a.id))
  const balances = new Map<string, number>(reserveAccounts.map((a) => [a.id, a.balance]))

  for (const tx of transactions) {
    if (tx.type === 'CREDIT_PAYMENT') {
      if (tx.transferAccountId && reserveIds.has(tx.transferAccountId)) {
        balances.set(tx.transferAccountId, (balances.get(tx.transferAccountId) ?? 0) - tx.amount)
      }
      continue
    }
    if (!isCashRealized(tx)) continue
    if (reserveIds.has(tx.accountId)) {
      if (tx.type === 'INCOME')
        balances.set(tx.accountId, (balances.get(tx.accountId) ?? 0) + tx.amount)
      if (tx.type === 'EXPENSE')
        balances.set(tx.accountId, (balances.get(tx.accountId) ?? 0) - tx.amount)
      if (tx.type === 'TRANSFER')
        balances.set(tx.accountId, (balances.get(tx.accountId) ?? 0) - tx.amount)
    }
    if (tx.type === 'TRANSFER' && tx.transferAccountId && reserveIds.has(tx.transferAccountId)) {
      balances.set(tx.transferAccountId, (balances.get(tx.transferAccountId) ?? 0) + tx.amount)
    }
  }
  return [...balances.values()].reduce((sum, v) => sum + v, 0)
}

/** `applyTx` + `computeAssetBalances` do Patrimônio Líquido. */
function legacyApplyTx(sum: number, tx: Transaction, accountId: string): number {
  if (tx.accountId === accountId) {
    if (tx.type === 'INCOME') return isCashRealized(tx) ? sum + tx.amount : sum
    if (tx.type === 'EXPENSE') return isCashRealized(tx) ? sum - tx.amount : sum
    if (tx.type === 'TRANSFER') return sum - tx.amount
  } else if (tx.transferAccountId === accountId) {
    if (tx.type === 'TRANSFER') return sum + tx.amount
    if (tx.type === 'CREDIT_PAYMENT') return sum - tx.amount
  }
  return sum
}

function legacyAssetBalances(
  assetAccounts: Account[],
  transactions: Transaction[],
  today: Date
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const a of assetAccounts) result[a.id] = a.balance
  for (const tx of transactions) {
    if (parseDateLocal(tx.date) > today) continue
    const a1 = tx.accountId
    if (a1 in result) result[a1] = legacyApplyTx(result[a1], tx, a1)
    const a2 = tx.transferAccountId
    if (a2 && a2 !== a1 && a2 in result) result[a2] = legacyApplyTx(result[a2], tx, a2)
  }
  return result
}

/** `balanceUpTo` do rodapé de Lançamentos. */
function legacyBalanceUpTo(
  accounts: Account[],
  transactions: Transaction[],
  scopeIds: Set<string>,
  upTo: Date | null
): number {
  let total = accounts.filter((a) => scopeIds.has(a.id)).reduce((s, a) => s + a.balance, 0)
  for (const tx of transactions) {
    if (upTo && parseDateLocal(tx.date) > upTo) continue
    if (!isCashRealized(tx)) continue
    if (tx.type === 'TRANSFER') {
      if (scopeIds.has(tx.accountId)) total -= tx.amount
      if (tx.transferAccountId && scopeIds.has(tx.transferAccountId)) total += tx.amount
    } else if (tx.type === 'CREDIT_PAYMENT') {
      if (tx.transferAccountId && scopeIds.has(tx.transferAccountId)) total -= tx.amount
    } else if (scopeIds.has(tx.accountId)) {
      if (tx.type === 'INCOME') total += tx.amount
      else if (tx.type === 'EXPENSE') total -= tx.amount
    }
  }
  return total
}

// ─── Fixture ─────────────────────────────────────────────────────────────────

const TODAY = new Date(2026, 7, 28) // 2026-08-28, meio-dia local irrelevante

function acc(overrides: Partial<Account> & { id: string }): Account {
  return {
    name: overrides.id,
    type: 'RETAIL',
    balance: 0,
    includeInBalance: true,
    ...overrides,
  }
}

function tx(overrides: Partial<Transaction> & { id: string }): Transaction {
  return {
    accountId: 'corrente',
    categoryId: 'cat-1',
    amount: 100,
    type: 'EXPENSE',
    date: '2026-08-10',
    description: overrides.id,
    isPaid: true,
    tags: [],
    ...overrides,
  }
}

const accounts: Account[] = [
  acc({ id: 'corrente', balance: 1000 }),
  acc({ id: 'poupanca', type: 'SAVINGS', balance: 5000, reserveMetadata: {} }),
  acc({ id: 'reserva2', type: 'RETAIL', balance: 300, reserveMetadata: {} }),
  acc({
    id: 'cartao',
    type: 'CREDIT',
    balance: 0,
    creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 },
  }),
]

const transactions: Transaction[] = [
  tx({ id: 'renda-paga', type: 'INCOME', amount: 4000, isPaid: true }),
  tx({ id: 'renda-nao-paga', type: 'INCOME', amount: 900, isPaid: false }),
  tx({ id: 'gasto-pago', type: 'EXPENSE', amount: 250, isPaid: true }),
  tx({ id: 'gasto-nao-pago', type: 'EXPENSE', amount: 70, isPaid: false }),
  tx({ id: 'gasto-poupanca', accountId: 'poupanca', type: 'EXPENSE', amount: 40, isPaid: true }),
  tx({
    id: 'transferencia',
    type: 'TRANSFER',
    amount: 500,
    accountId: 'corrente',
    transferAccountId: 'poupanca',
    isPaid: false, // TRANSFER ignora isPaid — sempre realizada (B-15)
  }),
  tx({
    id: 'transferencia-reserva',
    type: 'TRANSFER',
    amount: 120,
    accountId: 'poupanca',
    transferAccountId: 'reserva2',
  }),
  tx({
    id: 'pagamento-fatura',
    type: 'CREDIT_PAYMENT',
    amount: 800,
    accountId: 'cartao',
    transferAccountId: 'corrente',
    referenceMonth: '2026-08',
  }),
  tx({ id: 'compra-cartao', accountId: 'cartao', type: 'EXPENSE', amount: 300, isPaid: true }),
  // Futuro — separa quem corta em hoje (Patrimônio/Lançamentos) de quem não corta (Dashboard).
  tx({ id: 'futuro-pago', type: 'INCOME', amount: 2000, isPaid: true, date: '2026-12-01' }),
  tx({
    id: 'futuro-transferencia',
    type: 'TRANSFER',
    amount: 60,
    accountId: 'corrente',
    transferAccountId: 'poupanca',
    date: '2026-11-05',
  }),
  // Passado distante — exercita o corte `after` da reavaliação de ativos.
  tx({ id: 'antigo', type: 'EXPENSE', amount: 33, isPaid: true, date: '2020-02-02' }),
]

const nonCreditSeeds = () =>
  new Map(accounts.filter((a) => a.type !== 'CREDIT').map((a) => [a.id, a.balance] as const))

// ─── Equivalência com cada cópia legada ──────────────────────────────────────

describe('computeAccountBalances — equivalência com as implementações que substituiu', () => {
  it('reproduz o bloco do Dashboard/Configurações (sem corte de data)', () => {
    const expected = legacyDashboard(accounts, transactions)
    const actual = computeAccountBalances(transactions, nonCreditSeeds())
    expect(Object.fromEntries(actual)).toEqual(expected)
  })

  it('reproduz getReserveBalance (sementes = só contas de reserva)', () => {
    const reserveAccounts = accounts.filter((a) => a.reserveMetadata)
    const seeds = new Map(reserveAccounts.map((a) => [a.id, a.balance] as const))
    expect(sumBalances(computeAccountBalances(transactions, seeds))).toBe(
      legacyReserve(transactions, reserveAccounts)
    )
  })

  it('reproduz computeAssetBalances do Patrimônio Líquido (corte em hoje)', () => {
    const assetAccounts = accounts.filter((a) => a.type !== 'CREDIT')
    const expected = legacyAssetBalances(assetAccounts, transactions, TODAY)
    const actual = computeAccountBalances(transactions, nonCreditSeeds(), { asOf: TODAY })
    expect(Object.fromEntries(actual)).toEqual(expected)
  })

  it('reproduz balanceUpTo do rodapé de Lançamentos, com e sem data', () => {
    const scopeIds = new Set(['corrente', 'poupanca', 'reserva2'])
    const seeds = new Map(
      accounts.filter((a) => scopeIds.has(a.id)).map((a) => [a.id, a.balance] as const)
    )
    const cutoff = new Date(2026, 7, 15)

    expect(sumBalances(computeAccountBalances(transactions, seeds, { asOf: cutoff }))).toBe(
      legacyBalanceUpTo(accounts, transactions, scopeIds, cutoff)
    )
    expect(sumBalances(computeAccountBalances(transactions, seeds))).toBe(
      legacyBalanceUpTo(accounts, transactions, scopeIds, null)
    )
  })

  it('reproduz o replay a partir de uma cotação (corte `after` + `asOf`)', () => {
    const baseDate = new Date(2026, 0, 1)
    const seeds = new Map([['corrente', 12345]])
    const expected = transactions
      .filter((t) => {
        const d = parseDateLocal(t.date)
        return d > baseDate && d <= TODAY
      })
      .reduce((sum, t) => legacyApplyTx(sum, t, 'corrente'), 12345)

    const actual = computeAccountBalances(transactions, seeds, { after: baseDate, asOf: TODAY })
    expect(actual.get('corrente')).toBe(expected)
  })
})

// ─── Propriedades da regra ───────────────────────────────────────────────────

describe('computeAccountBalances — regras de saldo', () => {
  it('só devolve as contas semeadas — é assim que CREDIT fica de fora', () => {
    const result = computeAccountBalances(transactions, nonCreditSeeds())
    expect([...result.keys()].sort()).toEqual(['corrente', 'poupanca', 'reserva2'])
  })

  it('não cria conta nova a partir de uma transação órfã', () => {
    const orphan = [tx({ id: 'orfa', accountId: 'conta-que-nao-existe', amount: 10 })]
    const result = computeAccountBalances(orphan, new Map([['corrente', 100]]))
    expect(result.size).toBe(1)
    expect(result.get('corrente')).toBe(100)
  })

  it('não muta as sementes recebidas', () => {
    const seeds = nonCreditSeeds()
    computeAccountBalances(transactions, seeds)
    expect(seeds.get('corrente')).toBe(1000)
  })

  it('ignora INCOME/EXPENSE não pagos, mas nunca ignora TRANSFER (B-15)', () => {
    const seeds = new Map([
      ['a', 0],
      ['b', 0],
    ])
    const pending = [
      tx({ id: 'i', accountId: 'a', type: 'INCOME', amount: 10, isPaid: false }),
      tx({ id: 'e', accountId: 'a', type: 'EXPENSE', amount: 20, isPaid: false }),
      tx({
        id: 't',
        accountId: 'a',
        transferAccountId: 'b',
        type: 'TRANSFER',
        amount: 5,
        isPaid: false,
      }),
    ]
    const result = computeAccountBalances(pending, seeds)
    expect(result.get('a')).toBe(-5)
    expect(result.get('b')).toBe(5)
  })

  it('CREDIT_PAYMENT debita só quem pagou, nunca o cartão (B-16)', () => {
    const seeds = new Map([
      ['cartao', 0],
      ['corrente', 1000],
    ])
    const payment = [
      tx({
        id: 'p',
        accountId: 'cartao',
        transferAccountId: 'corrente',
        type: 'CREDIT_PAYMENT',
        amount: 800,
      }),
    ]
    const result = computeAccountBalances(payment, seeds)
    expect(result.get('corrente')).toBe(200)
    expect(result.get('cartao')).toBe(0)
  })

  it('`asOf` é inclusivo e `after` é exclusivo', () => {
    const seeds = new Map([['corrente', 0]])
    const day = [tx({ id: 'd', type: 'EXPENSE', amount: 10, date: '2026-08-10' })]
    const onTheDay = new Date(2026, 7, 10)
    expect(computeAccountBalances(day, seeds, { asOf: onTheDay }).get('corrente')).toBe(-10)
    expect(computeAccountBalances(day, seeds, { after: onTheDay }).get('corrente')).toBe(0)
  })
})

// ─── Divergências conhecidas, adotadas conscientemente ───────────────────────

describe('computeAccountBalances — divergências que a unificação resolveu', () => {
  it('auto-transferência se anula (maioria) em vez de debitar (Patrimônio Líquido)', () => {
    const seeds = new Map([['corrente', 100]])
    const selfTransfer = [
      tx({
        id: 's',
        accountId: 'corrente',
        transferAccountId: 'corrente',
        type: 'TRANSFER',
        amount: 40,
      }),
    ]

    expect(computeAccountBalances(selfTransfer, seeds).get('corrente')).toBe(100)
    // O que a cópia do Patrimônio Líquido fazia, e que a UI impede de existir
    // (TransactionDrawer filtra a própria conta da lista de destino):
    expect(
      legacyAssetBalances([acc({ id: 'corrente', balance: 100 })], selfTransfer, TODAY)
    ).toEqual({ corrente: 60 })
  })

  it('o replay sem cotação passa a debitar CREDIT_PAYMENT da conta pagadora', () => {
    // O ramo de fallback de `getAssetBalance` filtrava as transações antes de aplicá-las e só
    // aceitava o outro lado de um TRANSFER — um pagamento de fatura financiado por uma conta de
    // ativo sem cotação não saía do saldo dela. As outras quatro cópias sempre debitaram.
    const seeds = new Map([['acoes', 1000]])
    const payment = [
      tx({
        id: 'p',
        accountId: 'cartao',
        transferAccountId: 'acoes',
        type: 'CREDIT_PAYMENT',
        amount: 250,
      }),
    ]
    expect(computeAccountBalances(payment, seeds, { asOf: TODAY }).get('acoes')).toBe(750)
  })
})
