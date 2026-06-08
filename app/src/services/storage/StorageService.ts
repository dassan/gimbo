import { uuid } from '@/lib/utils'
import { CURRENT_SCHEMA_VERSION } from '@/lib/storage/schema'
import type {
  Account,
  AccountType,
  AuditAction,
  AuditEntity,
  AuditEntry,
  Category,
  CategoryType,
  CreditMetadata,
  DataFile,
  Installment,
  Recurrence,
  Settings,
  Tag,
  Transaction,
  TransactionType,
  User,
  Valuation,
} from '@/types'

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
}

type QueryResult = { rows: unknown[][]; columns: string[] }
type Row = Record<string, unknown>

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
      const { id, result, error } = event.data
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
      this.worker.postMessage({ id, method, args } satisfies WorkerRequest, transfer)
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

  // ─── User ────────────────────────────────────────────────────────────────────

  async getUser(): Promise<User | null> {
    const rows = await this.query("SELECT * FROM users WHERE id = 'singleton'")
    if (rows.length === 0) return null
    return rowToUser(rows[0])
  }

  async upsertUser(user: User): Promise<void> {
    await this.run(
      `INSERT INTO users (id, name, email, created_at, updated_at)
       VALUES ('singleton', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         email = excluded.email,
         updated_at = excluded.updated_at`,
      [user.name, user.email, user.createdAt, user.updatedAt]
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
      `INSERT INTO settings (id, file_created_at, file_updated_at, audit_log_retention_limit)
       VALUES ('singleton', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         file_created_at = excluded.file_created_at,
         file_updated_at = excluded.file_updated_at,
         audit_log_retention_limit = excluded.audit_log_retention_limit`,
      [settings.fileCreatedAt, settings.fileUpdatedAt, settings.auditLogRetentionLimit]
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
          credit_limit, credit_closing_day, credit_due_day, issuer_icon,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.name,
        data.type,
        data.balance,
        data.includeInBalance ? 1 : 0,
        data.creditMetadata?.limit ?? null,
        data.creditMetadata?.closingDay ?? null,
        data.creditMetadata?.dueDay ?? null,
        data.issuerIcon ?? null,
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
    const merged: Account = { ...rowToAccount(rows[0]), ...data }
    await this.run(
      `UPDATE accounts SET
         name = ?, type = ?, balance = ?, include_in_balance = ?,
         credit_limit = ?, credit_closing_day = ?, credit_due_day = ?,
         issuer_icon = ?, updated_at = ?
       WHERE id = ?`,
      [
        merged.name,
        merged.type,
        merged.balance,
        merged.includeInBalance ? 1 : 0,
        merged.creditMetadata?.limit ?? null,
        merged.creditMetadata?.closingDay ?? null,
        merged.creditMetadata?.dueDay ?? null,
        merged.issuerIcon ?? null,
        new Date().toISOString(),
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
    const merged: Category = { ...rowToCategory(rows[0]), ...data }
    await this.run(
      `UPDATE categories
       SET parent_id = ?, name = ?, icon = ?, color = ?, type = ?, updated_at = ?
       WHERE id = ?`,
      [
        merged.parentId ?? null,
        merged.name,
        merged.icon,
        merged.color,
        merged.type,
        new Date().toISOString(),
        id,
      ]
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
    const merged: Tag = { ...rowToTag(rows[0]), ...data }
    await this.run('UPDATE tags SET name = ?, color = ?, updated_at = ? WHERE id = ?', [
      merged.name,
      merged.color,
      new Date().toISOString(),
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

    const rows = await this.query(
      `SELECT t.*, GROUP_CONCAT(tt.tag_id) AS tag_ids
       FROM transactions t
       LEFT JOIN transaction_tags tt ON t.id = tt.transaction_id
       ${where}
       GROUP BY t.id
       ORDER BY t.date DESC, t.created_at DESC`,
      params
    )
    return rows.map(rowToTransaction)
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
    const rows = await this.query(
      `SELECT t.*, GROUP_CONCAT(tt.tag_id) AS tag_ids
       FROM transactions t
       LEFT JOIN transaction_tags tt ON t.id = tt.transaction_id
       WHERE t.id = ?
       GROUP BY t.id`,
      [id]
    )
    return rowToTransaction(rows[0])
  }

  async updateTransaction(id: string, data: UpdateTransactionData): Promise<Transaction> {
    const rows = await this.query(
      `SELECT t.*, GROUP_CONCAT(tt.tag_id) AS tag_ids
       FROM transactions t
       LEFT JOIN transaction_tags tt ON t.id = tt.transaction_id
       WHERE t.id = ?
       GROUP BY t.id`,
      [id]
    )
    if (rows.length === 0) throw new Error(`Transaction not found: ${id}`)
    const merged: Transaction = { ...rowToTransaction(rows[0]), ...data }
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
        new Date().toISOString(),
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

  // ─── Export / Import ─────────────────────────────────────────────────────────

  async exportBlob(): Promise<Blob> {
    const buffer = await this.call<ArrayBuffer>('export')
    return new Blob([buffer], { type: 'application/x-sqlite3' })
  }

  async importBlob(blob: Blob): Promise<void> {
    const buffer = await blob.arrayBuffer()
    // Transfer the ArrayBuffer to the worker to avoid copying.
    await this.call<void>('import', [buffer], [buffer])
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

    const [accounts, categories, tags, transactions, valuations, auditLog, deletedIds] =
      await Promise.all([
        this.getAccounts(),
        this.getCategories(),
        this.getTags(),
        this.getTransactions(),
        this.getValuations(),
        this.getAuditLog(),
        this.getDeletedIds(),
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
    }
  }

  /** Atomically replace every table with the content of a DataFile. */
  replaceAll(data: DataFile): Promise<void> {
    return this.call<void>('replaceAll', [data])
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

function rowToUser(row: Row): User {
  return {
    name: row.name as string,
    email: row.email as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function rowToSettings(row: Row): Settings {
  return {
    fileCreatedAt: row.file_created_at as string,
    fileUpdatedAt: row.file_updated_at as string,
    auditLogRetentionLimit: row.audit_log_retention_limit as number | null,
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
  if (row.issuer_icon !== null && row.issuer_icon !== undefined) {
    account.issuerIcon = row.issuer_icon as string
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
  }
}

function rowToTag(row: Row): Tag {
  return {
    id: row.id as string,
    name: row.name as string,
    color: row.color as string,
  }
}

function rowToTransaction(row: Row): Transaction {
  const tagIds = row.tag_ids as string | null
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
  }
  if (row.transfer_account_id !== null && row.transfer_account_id !== undefined) {
    tx.transferAccountId = row.transfer_account_id as string
  }
  if (row.installment_parent_id !== null && row.installment_parent_id !== undefined) {
    tx.installment = {
      parentId: row.installment_parent_id as string,
      currentIndex: row.installment_index as number,
      total: row.installment_total as number,
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
