import { uuid } from '@/lib/utils'
import { measure } from '@/lib/perfMonitor'
import { trackPerformance } from '@/lib/telemetry'
import type { TransactionDelta } from '@/lib/storage/transactionDiff'
import { CURRENT_SCHEMA_VERSION } from '@/lib/storage/schema'
import type { SelectiveReadStats, SyncManifestBase } from './worker'
import type {
  Account,
  AccountType,
  AuditAction,
  AuditEntity,
  AuditEntry,
  Budget,
  Category,
  CategoryType,
  CreditMetadata,
  DataFile,
  Installment,
  LoanMetadata,
  Recurrence,
  SavedPeriod,
  Settings,
  Tag,
  Transaction,
  TransactionType,
  User,
  Valuation,
} from '@/types'
import {
  benchVariants,
  fitCostModel,
  linearity,
  median,
  permute,
  type BenchSample,
  type BenchVariant,
  type ColumnBenchResult,
  type PageSizeBenchResult,
  type WriteBenchResult,
} from '@/lib/storage/columnBench'

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export type CreateAccountData = Omit<Account, 'id'>
export type UpdateAccountData = Partial<Omit<Account, 'id'>>

export type CreateCategoryData = Omit<Category, 'id'>
export type UpdateCategoryData = Partial<Omit<Category, 'id'>>

export type CreateTagData = Omit<Tag, 'id'>
export type UpdateTagData = Partial<Omit<Tag, 'id'>>

export type CreateTransactionData = Omit<Transaction, 'id'>
export type UpdateTransactionData = Partial<Omit<Transaction, 'id'>>

export type TransactionFilters = {
  accountId?: string
  categoryId?: string
  type?: TransactionType
  fromDate?: string
  toDate?: string
  isPaid?: boolean
}

// ─── Internal worker protocol ──────────────────────────────────────────────────

type WorkerRequest = {
  id: string
  method: string
  args: unknown[]
}

type WorkerResponse = {
  id: string
  result?: unknown
  error?: string
  perf?: { metric: string; ms: number }
  bootPerf?: { metric: string; ms: number }[]
}

type QueryResult = { rows: unknown[][]; columns: string[] }
type Row = Record<string, unknown>

// M-91 — abre a caixa-preta do `loadDataFile()`, sempre ativa (mesma justificativa de
// `lib/bootMetrics.ts`/`syncMetrics.ts`: o custo real só aparece no cofre e no navegador do
// usuário). Baixa frequência — `loadDataFile()`/`getTransactions()` rodam no boot e no baseline de
// sync, não a cada mutação.
function measureLoad<T>(metric: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now()
  return fn().finally(() => trackPerformance(metric, performance.now() - start))
}

function measureLoadSync<T>(metric: string, fn: () => T): T {
  const start = performance.now()
  try {
    return fn()
  } finally {
    trackPerformance(metric, performance.now() - start)
  }
}

// ─── StorageService ───────────────────────────────────────────────────────────

export class StorageService {
  private readonly worker: Worker
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >()

  constructor() {
    // Guard: Web Workers are unavailable in test environments (jsdom).
    // All methods become no-ops so unit tests can import the store freely.
    if (typeof Worker === 'undefined') {
      this.worker = null as unknown as Worker
      return
    }
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    this.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const { id, result, error, perf, bootPerf } = event.data
      // M-87: mensagem não-solicitada do worker com o detalhamento do `init()`. Sempre registrada
      // (não gated por DEV, ao contrário de `perf` logo abaixo) — é métrica de boot, e boot só
      // interessa medido no cofre e no navegador reais do usuário. Não corresponde a nenhuma
      // chamada pendente, então retorna antes da busca em `this.pending`.
      if (bootPerf) {
        for (const entry of bootPerf) trackPerformance(entry.metric, entry.ms)
        return
      }
      if (import.meta.env.DEV && perf) trackPerformance(perf.metric, perf.ms)
      const handlers = this.pending.get(id)
      if (!handlers) return
      this.pending.delete(id)
      if (error !== undefined) {
        handlers.reject(new Error(error))
      } else {
        handlers.resolve(result)
      }
    })
  }

  // ─── Low-level worker bridge ────────────────────────────────────────────────

  private call<T>(method: string, args: unknown[] = [], transfer: Transferable[] = []): Promise<T> {
    // No-op in environments where the Worker could not be created (e.g. tests).
    if (!this.worker) return Promise.resolve(undefined as unknown as T)
    return new Promise((resolve, reject) => {
      const id = uuid()
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      })
      if (import.meta.env.DEV) {
        measure(`storage.postMessage.${method}`, () => {
          this.worker.postMessage({ id, method, args } satisfies WorkerRequest, transfer)
        })
      } else {
        this.worker.postMessage({ id, method, args } satisfies WorkerRequest, transfer)
      }
    })
  }

  private async query(sql: string, params: unknown[] = []): Promise<Row[]> {
    const result = await this.call<QueryResult>('query', [sql, params])
    const { rows, columns } = result
    return rows.map((row) => {
      const obj: Row = {}
      columns.forEach((col, i) => {
        obj[col] = row[i]
      })
      return obj
    })
  }

  private run(sql: string, params: unknown[] = []): Promise<void> {
    return this.call<void>('run', [sql, params])
  }

  /**
   * M-87: resolve quando o `init()` do worker termina (wasm + OPFS + migrations + hashes) — a fila
   * do worker encadeia a partir dele, então esta chamada, que não faz nada, só volta depois que o
   * storage está de pé. Serve para separar, no boot, o custo de partida do custo de ler o cofre.
   */
  ready(): Promise<void> {
    return this.call<void>('ready')
  }

  // ─── User ────────────────────────────────────────────────────────────────────

  async getUser(): Promise<User | null> {
    const rows = await this.query("SELECT * FROM users WHERE id = 'singleton'")
    if (rows.length === 0) return null
    return rowToUser(rows[0])
  }

  async upsertUser(user: User): Promise<void> {
    // `email` column is kept physically (no DDL change) but never populated anymore — see M-69.
    await this.run(
      `INSERT INTO users (id, name, email, created_at, updated_at)
       VALUES ('singleton', ?, '', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         email = excluded.email,
         updated_at = excluded.updated_at`,
      [user.name, user.createdAt, user.updatedAt]
    )
  }

  // ─── Settings ────────────────────────────────────────────────────────────────

  async getSettings(): Promise<Settings | null> {
    const rows = await this.query("SELECT * FROM settings WHERE id = 'singleton'")
    if (rows.length === 0) return null
    return rowToSettings(rows[0])
  }

  async upsertSettings(settings: Settings): Promise<void> {
    await this.run(
      `INSERT INTO settings (id, file_created_at, file_updated_at, audit_log_retention_limit, quadrantes_enabled, quadrantes_infer_from_history)
       VALUES ('singleton', ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         file_created_at = excluded.file_created_at,
         file_updated_at = excluded.file_updated_at,
         audit_log_retention_limit = excluded.audit_log_retention_limit,
         quadrantes_enabled = excluded.quadrantes_enabled,
         quadrantes_infer_from_history = excluded.quadrantes_infer_from_history`,
      [
        settings.fileCreatedAt,
        settings.fileUpdatedAt,
        settings.auditLogRetentionLimit,
        settings.quadrantesEnabled ? 1 : 0,
        settings.quadrantesInferFromHistory ? 1 : 0,
      ]
    )
  }

  // ─── Accounts ────────────────────────────────────────────────────────────────

  async getAccounts(): Promise<Account[]> {
    const rows = await this.query('SELECT * FROM accounts ORDER BY name')
    return rows.map(rowToAccount)
  }

  async createAccount(data: CreateAccountData): Promise<Account> {
    const id = uuid()
    const now = new Date().toISOString()
    await this.run(
      `INSERT INTO accounts
         (id, name, type, balance, include_in_balance,
          credit_limit, credit_closing_day, credit_due_day,
          loan_outstanding_balance, loan_monthly_payment, loan_remaining_installments, loan_interest_rate,
          is_reserve, issuer_icon, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.name,
        data.type,
        data.balance,
        data.includeInBalance ? 1 : 0,
        data.creditMetadata?.limit ?? null,
        data.creditMetadata?.closingDay ?? null,
        data.creditMetadata?.dueDay ?? null,
        data.loanMetadata?.outstandingBalance ?? null,
        data.loanMetadata?.monthlyPayment ?? null,
        data.loanMetadata?.remainingInstallments ?? null,
        data.loanMetadata?.interestRate ?? null,
        data.reserveMetadata ? 1 : 0,
        data.issuerIcon ?? null,
        data.archived ? 1 : 0,
        now,
        now,
      ]
    )
    const rows = await this.query('SELECT * FROM accounts WHERE id = ?', [id])
    return rowToAccount(rows[0])
  }

  async updateAccount(id: string, data: UpdateAccountData): Promise<Account> {
    const rows = await this.query('SELECT * FROM accounts WHERE id = ?', [id])
    if (rows.length === 0) throw new Error(`Account not found: ${id}`)
    const ts = data.updatedAt ?? new Date().toISOString()
    const merged: Account = { ...rowToAccount(rows[0]), ...data, updatedAt: ts }
    await this.run(
      `UPDATE accounts SET
         name = ?, type = ?, balance = ?, include_in_balance = ?,
         credit_limit = ?, credit_closing_day = ?, credit_due_day = ?,
         loan_outstanding_balance = ?, loan_monthly_payment = ?, loan_remaining_installments = ?, loan_interest_rate = ?,
         is_reserve = ?, issuer_icon = ?, archived = ?, updated_at = ?
       WHERE id = ?`,
      [
        merged.name,
        merged.type,
        merged.balance,
        merged.includeInBalance ? 1 : 0,
        merged.creditMetadata?.limit ?? null,
        merged.creditMetadata?.closingDay ?? null,
        merged.creditMetadata?.dueDay ?? null,
        merged.loanMetadata?.outstandingBalance ?? null,
        merged.loanMetadata?.monthlyPayment ?? null,
        merged.loanMetadata?.remainingInstallments ?? null,
        merged.loanMetadata?.interestRate ?? null,
        merged.reserveMetadata ? 1 : 0,
        merged.issuerIcon ?? null,
        merged.archived ? 1 : 0,
        ts,
        id,
      ]
    )
    return merged
  }

  async deleteAccount(id: string): Promise<void> {
    await this.run('DELETE FROM accounts WHERE id = ?', [id])
    await this.addDeletedId(id)
  }

  // ─── Categories ──────────────────────────────────────────────────────────────

  async getCategories(): Promise<Category[]> {
    const rows = await this.query('SELECT * FROM categories ORDER BY name')
    return rows.map(rowToCategory)
  }

  async createCategory(data: CreateCategoryData): Promise<Category> {
    const id = uuid()
    const now = new Date().toISOString()
    await this.run(
      `INSERT INTO categories (id, parent_id, name, icon, color, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.parentId ?? null, data.name, data.icon, data.color, data.type, now, now]
    )
    const rows = await this.query('SELECT * FROM categories WHERE id = ?', [id])
    return rowToCategory(rows[0])
  }

  async updateCategory(id: string, data: UpdateCategoryData): Promise<Category> {
    const rows = await this.query('SELECT * FROM categories WHERE id = ?', [id])
    if (rows.length === 0) throw new Error(`Category not found: ${id}`)
    const ts = data.updatedAt ?? new Date().toISOString()
    const merged: Category = { ...rowToCategory(rows[0]), ...data, updatedAt: ts }
    await this.run(
      `UPDATE categories
       SET parent_id = ?, name = ?, icon = ?, color = ?, type = ?, updated_at = ?
       WHERE id = ?`,
      [merged.parentId ?? null, merged.name, merged.icon, merged.color, merged.type, ts, id]
    )
    return merged
  }

  async deleteCategory(id: string): Promise<void> {
    await this.run('DELETE FROM categories WHERE id = ?', [id])
    await this.addDeletedId(id)
  }

  // ─── Tags ────────────────────────────────────────────────────────────────────

  async getTags(): Promise<Tag[]> {
    const rows = await this.query('SELECT * FROM tags ORDER BY name')
    return rows.map(rowToTag)
  }

  async createTag(data: CreateTagData): Promise<Tag> {
    const id = uuid()
    const now = new Date().toISOString()
    await this.run(
      'INSERT INTO tags (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, data.name, data.color, now, now]
    )
    const rows = await this.query('SELECT * FROM tags WHERE id = ?', [id])
    return rowToTag(rows[0])
  }

  async updateTag(id: string, data: UpdateTagData): Promise<Tag> {
    const rows = await this.query('SELECT * FROM tags WHERE id = ?', [id])
    if (rows.length === 0) throw new Error(`Tag not found: ${id}`)
    const ts = data.updatedAt ?? new Date().toISOString()
    const merged: Tag = { ...rowToTag(rows[0]), ...data, updatedAt: ts }
    await this.run('UPDATE tags SET name = ?, color = ?, updated_at = ? WHERE id = ?', [
      merged.name,
      merged.color,
      ts,
      id,
    ])
    return merged
  }

  async deleteTag(id: string): Promise<void> {
    await this.run('DELETE FROM tags WHERE id = ?', [id])
    await this.addDeletedId(id)
  }

  // ─── Transactions ────────────────────────────────────────────────────────────

  async getTransactions(filters?: TransactionFilters): Promise<Transaction[]> {
    const conditions: string[] = []
    const params: unknown[] = []

    if (filters?.accountId !== undefined) {
      conditions.push('t.account_id = ?')
      params.push(filters.accountId)
    }
    if (filters?.categoryId !== undefined) {
      conditions.push('t.category_id = ?')
      params.push(filters.categoryId)
    }
    if (filters?.type !== undefined) {
      conditions.push('t.type = ?')
      params.push(filters.type)
    }
    if (filters?.fromDate !== undefined) {
      conditions.push('t.date >= ?')
      params.push(filters.fromDate)
    }
    if (filters?.toDate !== undefined) {
      conditions.push('t.date <= ?')
      params.push(filters.toDate)
    }
    if (filters?.isPaid !== undefined) {
      conditions.push('t.is_paid = ?')
      params.push(filters.isPaid ? 1 : 0)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // M-72/PERFORMANCE.md: a versão anterior fazia tudo numa query só (LEFT JOIN duplo +
    // GROUP_CONCAT(DISTINCT) + GROUP BY t.id). Medido contra um cofre real de ~25 mil
    // transações: o JOIN/GROUP BY sozinho custou ~224s mesmo com fan-out de tags quase nulo
    // (0,15 tag/transação) — o gargalo é o próprio agrupamento/DISTINCT nesse ambiente
    // (wa-sqlite/WASM sobre a VFS assíncrona do OPFS), não o volume de linhas. As duas tabelas
    // de junção são pequenas (proporcionais a vínculos reais, não a transações × transações) —
    // buscá-las inteiras e juntar em JS é ordens de magnitude mais rápido que o JOIN+GROUP BY.
    // M-91: as duas metades têm remédios completamente diferentes — `.rows` é o SQLite lendo o OPFS
    // mais o clone estruturado do `postMessage`; `.map` é esta thread montando um objeto por
    // transação. Medidas juntas, uma esconde a outra.
    const [txRows, tagRows, budgetRows] = await measureLoad('storage.getTransactions.rows', () =>
      Promise.all([
        this.query(
          `SELECT t.* FROM transactions t ${where} ORDER BY t.date DESC, t.created_at DESC`,
          params
        ),
        this.query('SELECT transaction_id, tag_id FROM transaction_tags'),
        this.query('SELECT transaction_id, budget_id FROM transaction_budgets'),
      ])
    )

    return measureLoadSync('storage.getTransactions.map', () => {
      const tagsByTx = groupIds(tagRows, 'tag_id')
      const budgetsByTx = groupIds(budgetRows, 'budget_id')

      return txRows.map((row) =>
        rowToTransaction({
          ...row,
          tag_ids: tagsByTx.get(row.id as string)?.join(',') ?? null,
          budget_ids: budgetsByTx.get(row.id as string)?.join(',') ?? null,
        })
      )
    })
  }

  // ─── HY/Fase 0 — benchmark de colunas ──────────────────────────────────────

  /**
   * Mede o custo de ler `transactions` variando **colunas** (1, 9, 20) e **anos** (tabela inteira
   * vs. janela de 2 anos), para decidir se o épico de hidratação (`plan/BOOT_HYDRATION.md`) deve
   * podar coluna, podar ano, ou os dois.
   *
   * Devolve as duas metades separadas, porque elas têm remédios diferentes e uma esconde a outra
   * quando medidas juntas (mesma lição do `M-91`): `worker` é o SQLite materializando linha;
   * `endToEnd` repete a mesma consulta pela RPC normal e portanto inclui `postMessage` mais a
   * montagem de um objeto por linha aqui nesta thread. A diferença entre as duas é o custo da
   * fronteira.
   *
   * Não é caminho de produto: só o gate `?bench` chama isto, e um cofre grande leva minutos.
   */
  async benchColumns(rounds = 3): Promise<ColumnBenchResult> {
    const worker = await this.call<{
      rows: number
      yearSpan: [number, number]
      samples: BenchSample[]
    }>('benchColumns', [rounds])

    const variants = benchVariants(new Date().getFullYear(), worker.yearSpan[0], worker.yearSpan[1])
    const collected = new Map<string, number[]>()
    const rowCount = new Map<string, number>()

    const runVariant = async (variant: BenchVariant): Promise<{ ms: number; rows: number }> => {
      const startedAt = performance.now()
      let total = 0
      for (const step of variant.steps) {
        total += (await this.query(step.sql, step.params)).length
      }
      return { ms: performance.now() - startedAt, rows: total }
    }

    // Mesmo aquecimento descartado, mesma permutação e mesma pausa do lado do worker — comparar as
    // duas metades só faz sentido se as duas pagarem o mesmo protocolo de medição.
    for (const variant of variants) await runVariant(variant)

    for (let round = 0; round < rounds; round++) {
      for (const variant of permute(variants, round)) {
        await new Promise((resolve) => setTimeout(resolve, 150))
        const { ms, rows } = await runVariant(variant)
        const list = collected.get(variant.name)
        if (list) list.push(ms)
        else collected.set(variant.name, [ms])
        rowCount.set(variant.name, rows)
      }
    }

    const endToEnd: BenchSample[] = variants.map((variant) => {
      const values = collected.get(variant.name) ?? []
      return {
        name: variant.name,
        columns: variant.columns,
        scope: variant.scope,
        chunks: variant.steps.length,
        rows: rowCount.get(variant.name) ?? 0,
        samples: values,
        medianMs: median(values),
      }
    })

    return {
      rows: worker.rows,
      rounds,
      yearSpan: worker.yearSpan,
      worker: worker.samples,
      endToEnd,
      model: fitCostModel(worker.samples, worker.rows),
      linearity: linearity(worker.samples),
    }
  }

  /**
   * HY-16 — custo por página lida, medido sobre cópias do cofre em arquivo de rascunho. Nunca toca
   * o `db` real: uma das variantes roda `VACUUM` para reescrever com páginas de 64KB.
   */
  benchPageSize(): Promise<PageSizeBenchResult> {
    return this.call<PageSizeBenchResult>('benchPageSize')
  }

  /**
   * HY-17 — o outro lado do `HY-16`: quanto a escrita piora com página maior. Mesma disciplina —
   * tudo sobre cópias em arquivo de rascunho, o cofre real nunca é tocado.
   */
  benchWrite(rounds = 10): Promise<WriteBenchResult> {
    return this.call<WriteBenchResult>('benchWrite', [rounds])
  }

  /**
   * HY-21 — fecha o banco para que outra aba possa assumir o cofre. Depois disto o serviço não
   * serve mais: toda chamada falha, por desenho.
   */
  close(): Promise<void> {
    return this.call<void>('close')
  }

  async createTransaction(data: CreateTransactionData): Promise<Transaction> {
    const id = uuid()
    const now = new Date().toISOString()
    await this.run(
      `INSERT INTO transactions
         (id, account_id, category_id, amount, type, description, date, is_paid,
          transfer_account_id, installment_parent_id, installment_index, installment_total,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.accountId,
        data.categoryId || null,
        data.amount,
        data.type,
        data.description,
        data.date,
        data.isPaid ? 1 : 0,
        data.transferAccountId ?? null,
        data.installment?.parentId ?? null,
        data.installment?.currentIndex ?? null,
        data.installment?.total ?? null,
        now,
        now,
      ]
    )
    if (data.tags.length > 0) {
      for (const tagId of data.tags) {
        await this.run('INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)', [
          id,
          tagId,
        ])
      }
    }
    for (const budgetId of data.budgetIds ?? []) {
      await this.run('INSERT INTO transaction_budgets (transaction_id, budget_id) VALUES (?, ?)', [
        id,
        budgetId,
      ])
    }
    const rows = await this.query(
      `SELECT t.*, GROUP_CONCAT(DISTINCT tt.tag_id) AS tag_ids,
              GROUP_CONCAT(DISTINCT tb.budget_id) AS budget_ids
       FROM transactions t
       LEFT JOIN transaction_tags tt ON t.id = tt.transaction_id
       LEFT JOIN transaction_budgets tb ON t.id = tb.transaction_id
       WHERE t.id = ?
       GROUP BY t.id`,
      [id]
    )
    return rowToTransaction(rows[0])
  }

  async updateTransaction(id: string, data: UpdateTransactionData): Promise<Transaction> {
    const rows = await this.query(
      `SELECT t.*, GROUP_CONCAT(DISTINCT tt.tag_id) AS tag_ids,
              GROUP_CONCAT(DISTINCT tb.budget_id) AS budget_ids
       FROM transactions t
       LEFT JOIN transaction_tags tt ON t.id = tt.transaction_id
       LEFT JOIN transaction_budgets tb ON t.id = tb.transaction_id
       WHERE t.id = ?
       GROUP BY t.id`,
      [id]
    )
    if (rows.length === 0) throw new Error(`Transaction not found: ${id}`)
    const ts = data.updatedAt ?? new Date().toISOString()
    const merged: Transaction = { ...rowToTransaction(rows[0]), ...data, updatedAt: ts }
    await this.run(
      `UPDATE transactions SET
         account_id = ?, category_id = ?, amount = ?, type = ?,
         description = ?, date = ?, is_paid = ?, transfer_account_id = ?,
         installment_parent_id = ?, installment_index = ?, installment_total = ?,
         updated_at = ?
       WHERE id = ?`,
      [
        merged.accountId,
        merged.categoryId || null,
        merged.amount,
        merged.type,
        merged.description,
        merged.date,
        merged.isPaid ? 1 : 0,
        merged.transferAccountId ?? null,
        merged.installment?.parentId ?? null,
        merged.installment?.currentIndex ?? null,
        merged.installment?.total ?? null,
        ts,
        id,
      ]
    )
    await this.run('DELETE FROM transaction_tags WHERE transaction_id = ?', [id])
    for (const tagId of merged.tags) {
      await this.run('INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)', [
        id,
        tagId,
      ])
    }
    await this.run('DELETE FROM transaction_budgets WHERE transaction_id = ?', [id])
    for (const budgetId of merged.budgetIds ?? []) {
      await this.run('INSERT INTO transaction_budgets (transaction_id, budget_id) VALUES (?, ?)', [
        id,
        budgetId,
      ])
    }
    return merged
  }

  async deleteTransaction(id: string): Promise<void> {
    await this.run('DELETE FROM transactions WHERE id = ?', [id])
    await this.addDeletedId(id)
  }

  async deleteTransactionGroup(parentId: string): Promise<void> {
    const rows = await this.query('SELECT id FROM transactions WHERE installment_parent_id = ?', [
      parentId,
    ])
    for (const row of rows) {
      await this.addDeletedId(row.id as string)
    }
    await this.run('DELETE FROM transactions WHERE installment_parent_id = ?', [parentId])
  }

  // ─── Audit Log ───────────────────────────────────────────────────────────────

  async getAuditLog(): Promise<AuditEntry[]> {
    const rows = await this.query('SELECT * FROM audit_log ORDER BY timestamp ASC')
    return rows.map(rowToAuditEntry)
  }

  async addAuditEntry(entry: Omit<AuditEntry, 'id'>): Promise<AuditEntry> {
    const id = uuid()
    await this.run(
      'INSERT INTO audit_log (id, timestamp, action, entity, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)',
      [id, entry.timestamp, entry.action, entry.entity, entry.entityId, entry.summary]
    )
    return { id, ...entry }
  }

  async trimAuditLog(maxEntries: number): Promise<void> {
    await this.run(
      `DELETE FROM audit_log WHERE id NOT IN (
         SELECT id FROM audit_log ORDER BY timestamp DESC LIMIT ?
       )`,
      [maxEntries]
    )
  }

  // ─── Deleted IDs ─────────────────────────────────────────────────────────────

  async getDeletedIds(): Promise<string[]> {
    const rows = await this.query('SELECT id FROM deleted_ids')
    return rows.map((r) => r.id as string)
  }

  async addDeletedId(id: string): Promise<void> {
    await this.run('INSERT OR IGNORE INTO deleted_ids (id) VALUES (?)', [id])
  }

  // ─── Valuations ──────────────────────────────────────────────────────────────

  async getValuations(): Promise<Valuation[]> {
    const rows = await this.query('SELECT id, account_id, date, market_value FROM valuations')
    return rows.map((r) => ({
      id: r.id as string,
      accountId: r.account_id as string,
      date: r.date as string,
      marketValue: r.market_value as number,
    }))
  }

  // ─── Saved periods (M-45) ─────────────────────────────────────────────────────

  async getSavedPeriods(): Promise<SavedPeriod[]> {
    const rows = await this.query(
      'SELECT id, name, start_date, end_date FROM saved_periods ORDER BY created_at'
    )
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      start: r.start_date as string,
      end: r.end_date as string,
    }))
  }

  // ─── Budgets (F-30/BX-03) ──────────────────────────────────────────────────────

  async getBudgets(): Promise<Budget[]> {
    const rows = await this.query('SELECT * FROM budgets ORDER BY created_at')
    return rows.map(rowToBudget)
  }

  // ─── Export / Import ─────────────────────────────────────────────────────────

  async exportBlob(): Promise<Blob> {
    const buffer = await this.call<ArrayBuffer>('export')
    return new Blob([buffer], { type: 'application/x-sqlite3' })
  }

  /**
   * SEC-06 — resgate: bytes crus de `gimbo.db`, sem depender de o banco ter inicializado.
   *
   * Só para o caminho de falha de boot (ver a tela de `initError` em `App.tsx`). No fluxo normal
   * use `exportBlob()`, que passa pela fila e faz checkpoint do WAL com o banco aberto. Este aqui
   * é despachado fora da fila no worker justamente porque um `init()` rejeitado a inutiliza.
   */
  async exportRawBlob(): Promise<Blob> {
    const buffer = await this.call<ArrayBuffer>('exportRawBytes')
    return new Blob([buffer], { type: 'application/x-sqlite3' })
  }

  async importBlob(blob: Blob): Promise<void> {
    const buffer = await blob.arrayBuffer()
    // Transfer the ArrayBuffer to the worker to avoid copying.
    await this.call<void>('import', [buffer], [buffer])
  }

  /**
   * CS-15: reads a peer's device-<id>.db bytes into a DataFile, entirely in a worker-side
   * scratch db — the local gimbo.db is never opened, migrated or written to. Read-only; callers
   * (folderSyncService) are responsible for merging and persisting the result themselves.
   */
  async readPeerBlob(
    blob: Blob
  ): Promise<
    | { status: 'ok'; data: DataFile; stats: SelectiveReadStats }
    | { status: 'skipped'; reason: 'unreadable' | 'newer-schema' }
  > {
    const buffer = await blob.arrayBuffer()
    const result = await this.call<
      | { ok: true; data: Omit<DataFile, 'schemaVersion'>; stats: SelectiveReadStats }
      | { ok: false; reason: 'unreadable' | 'newer-schema' }
    >('readPeer', [buffer], [buffer])
    if (!result.ok) return { status: 'skipped', reason: result.reason }
    return {
      status: 'ok',
      data: { schemaVersion: CURRENT_SCHEMA_VERSION, ...result.data },
      stats: result.stats,
    }
  }

  /**
   * CS-41: singletons + hashes por partição numa única task do worker, para o publicador do
   * transporte particionado montar seu manifesto a partir de um instante consistente do banco.
   */
  async getSyncManifestBase(): Promise<SyncManifestBase | null> {
    return this.call<SyncManifestBase | null>('syncManifestBase', [])
  }

  /**
   * CS-41: lê as partições pedidas do cofre local, para publicação. As chaves são as mesmas de
   * `table_hashes` (`accounts:`, `transactions:2026`).
   */
  async readPartitions(keys: string[]): Promise<Record<string, unknown[]>> {
    if (keys.length === 0) return {}
    return this.call<Record<string, unknown[]>>('readPartitions', [keys])
  }

  async getDatabaseVersion(): Promise<number> {
    const rows = await this.query('PRAGMA user_version')
    return (rows[0]?.user_version ?? 0) as number
  }

  // ─── Bulk read / write ───────────────────────────────────────────────────────

  /** Load every table and assemble a DataFile. Returns null if the DB is empty (no user row). */
  async loadDataFile(): Promise<DataFile | null> {
    const user = await this.getUser()
    if (!user) return null
    const settings = await this.getSettings()
    if (!settings) return null

    const [
      accounts,
      categories,
      tags,
      transactions,
      valuations,
      auditLog,
      deletedIds,
      savedPeriods,
      budgets,
    ] = await Promise.all([
      this.getAccounts(),
      this.getCategories(),
      this.getTags(),
      // M-91: inclui a espera na fila do worker atrás das tabelas pequenas — a diferença para
      // `storage.getTransactions.rows` é exatamente esse tempo de fila.
      measureLoad('storage.loadDataFile.transactions', () => this.getTransactions()),
      this.getValuations(),
      this.getAuditLog(),
      this.getDeletedIds(),
      this.getSavedPeriods(),
      this.getBudgets(),
    ])

    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      user,
      settings,
      accounts,
      categories,
      tags,
      transactions,
      valuations,
      auditLog,
      deletedIds,
      savedPeriods,
      budgets,
    }
  }

  /** Atomically replace every table with the content of a DataFile. */
  replaceAll(data: DataFile): Promise<void> {
    return this.call<void>('replaceAll', [data])
  }

  /**
   * M-73/PERFORMANCE.md: caminho rápido para mutate() — reescreve as tabelas pequenas por
   * inteiro (baratas), mas só aplica INSERT/UPDATE/DELETE direcionados para as transações que
   * de fato mudaram (`delta`, de `lib/storage/transactionDiff.ts`), em vez de reescrever as
   * dezenas de milhares de linhas de `transactions` a cada mutação.
   */
  applyMutation(data: DataFile, delta: TransactionDelta): Promise<void> {
    return this.call<void>('applyMutation', [data, delta])
  }

  /** Delete all rows from every table, leaving the schema intact. */
  clearAll(): Promise<void> {
    return this.call<void>('clearAll', [])
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  terminate(): void {
    this.worker.terminate()
  }
}

// ─── Row → TypeScript mappers ─────────────────────────────────────────────────

/** Agrupa linhas de uma tabela de junção (ex.: transaction_tags) por transaction_id. */
function groupIds(rows: Row[], valueCol: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const row of rows) {
    const txId = row.transaction_id as string
    const value = row[valueCol] as string
    const list = map.get(txId)
    if (list) list.push(value)
    else map.set(txId, [value])
  }
  return map
}

function rowToUser(row: Row): User {
  return {
    name: row.name as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function rowToSettings(row: Row): Settings {
  return {
    fileCreatedAt: row.file_created_at as string,
    fileUpdatedAt: row.file_updated_at as string,
    auditLogRetentionLimit: row.audit_log_retention_limit as number | null,
    quadrantesEnabled: Boolean(row.quadrantes_enabled),
    quadrantesInferFromHistory: Boolean(row.quadrantes_infer_from_history),
  }
}

function rowToAccount(row: Row): Account {
  const account: Account = {
    id: row.id as string,
    name: row.name as string,
    type: row.type as AccountType,
    balance: row.balance as number,
    includeInBalance: Boolean(row.include_in_balance),
  }
  if (row.credit_limit !== null && row.credit_limit !== undefined) {
    account.creditMetadata = {
      limit: row.credit_limit as number,
      closingDay: row.credit_closing_day as number,
      dueDay: row.credit_due_day as number,
    } satisfies CreditMetadata
  }
  if (row.loan_outstanding_balance !== null && row.loan_outstanding_balance !== undefined) {
    account.loanMetadata = {
      outstandingBalance: row.loan_outstanding_balance as number,
      monthlyPayment: row.loan_monthly_payment as number,
      remainingInstallments: row.loan_remaining_installments as number,
      ...(row.loan_interest_rate !== null && row.loan_interest_rate !== undefined
        ? { interestRate: row.loan_interest_rate as number }
        : {}),
    } satisfies LoanMetadata
  }
  if (row.is_reserve) {
    account.reserveMetadata = {}
  }
  if (row.issuer_icon !== null && row.issuer_icon !== undefined) {
    account.issuerIcon = row.issuer_icon as string
  }
  if (row.archived) {
    account.archived = true
  }
  if (row.updated_at !== null && row.updated_at !== undefined) {
    account.updatedAt = row.updated_at as string
  }
  return account
}

function rowToCategory(row: Row): Category {
  return {
    id: row.id as string,
    parentId: (row.parent_id as string | null) ?? null,
    name: row.name as string,
    icon: row.icon as string,
    color: row.color as string,
    type: row.type as CategoryType,
    ...(row.updated_at !== null && row.updated_at !== undefined
      ? { updatedAt: row.updated_at as string }
      : {}),
  }
}

function rowToTag(row: Row): Tag {
  return {
    id: row.id as string,
    name: row.name as string,
    color: row.color as string,
    ...(row.updated_at !== null && row.updated_at !== undefined
      ? { updatedAt: row.updated_at as string }
      : {}),
  }
}

function rowToTransaction(row: Row): Transaction {
  const tagIds = row.tag_ids as string | null
  const budgetIds = row.budget_ids as string | null
  const tx: Transaction = {
    id: row.id as string,
    accountId: row.account_id as string,
    categoryId: (row.category_id as string | null) ?? '',
    amount: row.amount as number,
    type: row.type as TransactionType,
    description: row.description as string,
    date: row.date as string,
    isPaid: Boolean(row.is_paid),
    tags: tagIds ? tagIds.split(',') : [],
    budgetIds: budgetIds ? budgetIds.split(',') : [],
  }
  if (row.updated_at !== null && row.updated_at !== undefined) {
    tx.updatedAt = row.updated_at as string
  }
  if (row.created_at !== null && row.created_at !== undefined) {
    tx.createdAt = row.created_at as string
  }
  if (row.transfer_account_id !== null && row.transfer_account_id !== undefined) {
    tx.transferAccountId = row.transfer_account_id as string
  }
  if (row.reference_month !== null && row.reference_month !== undefined) {
    tx.referenceMonth = row.reference_month as string
  }
  if (row.invoice_due_date !== null && row.invoice_due_date !== undefined) {
    tx.invoiceDueDate = row.invoice_due_date as string
  }
  if (row.installment_parent_id !== null && row.installment_parent_id !== undefined) {
    tx.installment = {
      parentId: row.installment_parent_id as string,
      currentIndex: row.installment_index as number,
      total: row.installment_total as number,
      ...(row.installment_purchase_date !== null && row.installment_purchase_date !== undefined
        ? { purchaseDate: row.installment_purchase_date as string }
        : {}),
    } satisfies Installment
  }
  if (row.recurrence_parent_id !== null && row.recurrence_parent_id !== undefined) {
    const recurrence: Recurrence = {
      frequency: row.recurrence_frequency as Recurrence['frequency'],
      parentId: row.recurrence_parent_id as string,
    }
    if (row.recurrence_end_date !== null && row.recurrence_end_date !== undefined) {
      recurrence.endDate = row.recurrence_end_date as string
    }
    tx.recurrence = recurrence
  }
  return tx
}

function rowToBudget(row: Row): Budget {
  const period: Budget['period'] =
    row.period_mode === 'date'
      ? { mode: 'date', date: row.period_date as string }
      : { mode: 'range', start: row.period_start as string, end: row.period_end as string }
  const b: Budget = {
    id: row.id as string,
    name: row.name as string,
    emoji: row.emoji as string,
    color: row.color as string,
    kind: row.kind as Budget['kind'],
    target: row.target as number,
    period,
  }
  if (row.archived_at !== null && row.archived_at !== undefined) {
    b.archivedAt = row.archived_at as string
  }
  if (row.recipe_slug !== null && row.recipe_slug !== undefined) {
    b.recipeSlug = row.recipe_slug as string
  }
  if (row.recipe_slot !== null && row.recipe_slot !== undefined) {
    b.recipeSlot = row.recipe_slot as number
  }
  if (row.updated_at !== null && row.updated_at !== undefined) {
    b.updatedAt = row.updated_at as string
  }
  if (row.created_at !== null && row.created_at !== undefined) {
    b.createdAt = row.created_at as string
  }
  if (row.target_source !== null && row.target_source !== undefined) {
    b.targetSource = row.target_source as Budget['targetSource']
  }
  return b
}

function rowToAuditEntry(row: Row): AuditEntry {
  return {
    id: row.id as string,
    timestamp: row.timestamp as string,
    action: row.action as AuditAction,
    entity: row.entity as AuditEntity,
    entityId: row.entity_id as string,
    summary: row.summary as string,
  }
}
