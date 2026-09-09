/// <reference lib="webworker" />
// This file runs as a Dedicated Web Worker. TypeScript sees both DOM and
// WebWorker libs; `declare const self` below resolves the `self` ambiguity.
declare const self: DedicatedWorkerGlobalScope

import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite-async.mjs'
import * as SQLite from 'wa-sqlite'
// @ts-expect-error – JavaScript VFS without ambient declarations
import { OriginPrivateFileSystemVFS } from 'wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js'
import v1Schema from './migrations/v1.sql?raw'
import v2Schema from './migrations/v2.sql?raw'
import v3Schema from './migrations/v3.sql?raw'
import v4Schema from './migrations/v4.sql?raw'
import v5Schema from './migrations/v5.sql?raw'
import v6Schema from './migrations/v6.sql?raw'
import v7Schema from './migrations/v7.sql?raw'
import v8Schema from './migrations/v8.sql?raw'
import v9Schema from './migrations/v9.sql?raw'
import v10Schema from './migrations/v10.sql?raw'
import v11Schema from './migrations/v11.sql?raw'
import v12Schema from './migrations/v12.sql?raw'
import v13Schema from './migrations/v13.sql?raw'
import v14Schema from './migrations/v14.sql?raw'
import v15Schema from './migrations/v15.sql?raw'
import v16Schema from './migrations/v16.sql?raw'
import v17Schema from './migrations/v17.sql?raw'
import v18Schema from './migrations/v18.sql?raw'
import v19Schema from './migrations/v19.sql?raw'
import { ERR_DB_UNREADABLE, ERR_SCHEMA_TOO_NEW } from './errors'
import {
  benchVariants,
  median,
  permute,
  PAGE_BENCH_READ,
  WRITE_BENCH_VARIANTS,
  type BenchSample,
  type BenchVariant,
  type PageSizeBenchEntry,
  type PageSizeBenchResult,
  type WriteBenchEntry,
  type WriteBenchResult,
} from '@/lib/storage/columnBench'
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
  deletedIdRowKey,
  deviceRowKey,
  transactionRowKey,
  hypothesisRowKey,
  HASH_VERSION,
} from '@/lib/storage/rowHash'

// ─── Protocol types ───────────────────────────────────────────────────────────

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
  // M-87: canal não-solicitado — o worker publica o detalhamento do próprio init assim que ele
  // termina, sem esperar por nenhuma chamada. Ao contrário de `perf` (gated por DEV do lado de
  // quem consome), estes eventos são sempre registrados: o custo de partida do wa-sqlite/OPFS só
  // se manifesta no navegador e no cofre reais do usuário.
  bootPerf?: { metric: string; ms: number }[]
}

// ─── DataFile subset used by replaceAll ───────────────────────────────────────

type RawUser = { name: string; createdAt: string; updatedAt: string }
type RawSettings = {
  fileCreatedAt: string
  fileUpdatedAt: string
  auditLogRetentionLimit: number | null
  quadrantesEnabled: boolean
  quadrantesInferFromHistory: boolean
}
// Exported (type-only elsewhere) so lib/storage/rowHash.ts can compute a canonical hash key per
// row without duplicating these shapes — CS-30/CS-31 Fase 2.
export type RawAccount = {
  id: string
  name: string
  type: string
  balance: number
  includeInBalance: boolean
  creditMetadata?: { limit: number; closingDay: number; dueDay: number }
  loanMetadata?: {
    outstandingBalance: number
    monthlyPayment: number
    remainingInstallments: number
    interestRate?: number
  }
  reserveMetadata?: Record<string, never>
  issuerIcon?: string
  archived?: boolean
  updatedAt?: string
}
export type RawCategory = {
  id: string
  parentId: string | null
  name: string
  icon: string
  color: string
  type: string
  updatedAt?: string
}
export type RawTag = { id: string; name: string; color: string; updatedAt?: string }
export type RawTransaction = {
  id: string
  accountId: string
  categoryId: string
  amount: number
  type: string
  description: string
  date: string
  isPaid: boolean
  tags: string[]
  installment?: { parentId: string; currentIndex: number; total: number; purchaseDate?: string }
  recurrence?: { frequency: string; parentId: string; endDate?: string }
  transferAccountId?: string
  referenceMonth?: string
  invoiceDueDate?: string
  updatedAt?: string
  createdAt?: string
  budgetIds?: string[]
  notes?: string
}
export type RawAuditEntry = {
  id: string
  timestamp: string
  action: string
  entity: string
  entityId: string
  summary: string
  deviceId?: string
}
export type RawDevice = {
  id: string
  name: string
  updatedAt: string
}
export type RawValuation = {
  id: string
  accountId: string
  date: string
  marketValue: number
}
export type RawSavedPeriod = {
  id: string
  name: string
  start: string
  end: string
}
export type RawBudget = {
  id: string
  name: string
  emoji: string
  color: string
  kind: string
  target: number
  period: { mode: 'date'; date: string } | { mode: 'range'; start: string; end: string }
  archivedAt?: string
  recipeSlug?: string
  recipeSlot?: number
  updatedAt?: string
  createdAt?: string
  targetSource?: string
}
// M-101 (Simulações): never linked to any real Transaction/Account — see types/index.ts.
export type RawHypothesisItem = {
  id: string
  kind: string
  description: string
  type: string
  amount: number
  startDate: string
  installmentCount?: number
  frequency?: string
  endDate?: string
  categoryId?: string
}
export type RawHypothesis = {
  id: string
  name: string
  enabled: boolean
  items: RawHypothesisItem[]
  createdAt: string
  updatedAt?: string
}
type RawDataFile = {
  user: RawUser
  settings: RawSettings
  accounts: RawAccount[]
  categories: RawCategory[]
  tags: RawTag[]
  transactions: RawTransaction[]
  valuations: RawValuation[]
  auditLog: RawAuditEntry[]
  deletedIds: string[]
  savedPeriods: RawSavedPeriod[]
  budgets: RawBudget[]
  devices: RawDevice[]
  hypotheses: RawHypothesis[]
}

// ─── SQLite state ─────────────────────────────────────────────────────────────

// `SQLiteAPI` is declared globally by wa-sqlite's ambient types.
let sqlite3: SQLiteAPI
let db: number // opaque database pointer returned by open_v2

// SEC-06: só o resgate consulta isto. `db`/`sqlite3` ficam indefinidos se o `init()` falhar, e é
// exatamente nesse cenário que o resgate precisa rodar — daí uma flag em vez de checar `db`.
let dbReady = false

// M-73/PERFORMANCE.md: teto real de parâmetros ligados que esta build do SQLite aceita numa
// query só — descoberto no init() via sqlite3.limit(), não chutado, com 10% de margem. Usado
// pra dimensionar os lotes de applyTransactionDelta(). Fallback conservador se a consulta falhar
// ou devolver algo implausível.
let maxBoundParams = 900

// SQLITE_LIMIT_VARIABLE_NUMBER — constante pública da API C do SQLite (não muda entre versões),
// não reexportada pelo módulo principal do wa-sqlite (só por sqlite-constants.js, que não
// importamos só por isto). Ver node_modules/wa-sqlite/src/sqlite-constants.js.
const SQLITE_LIMIT_VARIABLE_NUMBER = 9

const DB_FILENAME = 'gimbo.db'

// Highest PRAGMA user_version this build knows how to migrate. CS-15 (folderSyncService)
// compares a peer's raw version against this before attempting to read it — a peer ahead of
// this number was written by a newer app build and must be skipped, not partially migrated.
// Bump this alongside every new migrations/vN.sql (same trap as data/sync_gimbo.py — see
// CLAUDE.md "Armadilha recorrente").
const MAX_KNOWN_DB_VERSION = 19

// ─── Initialization ───────────────────────────────────────────────────────────

// M-87: detalhamento do init, publicado ao final dele (ver `bootPerf` em WorkerResponse). O init
// inteiro roda antes de qualquer consulta — a fila encadeia a partir dele —, então tudo aqui está
// no caminho crítico do boot, e nenhuma das quatro fases tem o mesmo remédio: `wasm` é bundle,
// `openDb` é a VFS do OPFS, `migrations` é DDL pendente e `tableHashes` é o backfill do CS-34/CS-39
// (que faz uma leitura completa do cofre, mas só uma vez por banco/versão de hash).
const bootPerf: { metric: string; ms: number }[] = []

async function measureInit<T>(metric: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    return await fn()
  } finally {
    bootPerf.push({ metric, ms: performance.now() - start })
  }
}

async function init(): Promise<void> {
  const startedAt = performance.now()

  await measureInit('boot.worker.wasm', async () => {
    // SQLiteESMFactory returns the opaque Emscripten module typed as `any`.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const module = await SQLiteESMFactory()
    sqlite3 = SQLite.Factory(module)
  })

  await measureInit('boot.worker.openDb', async () => {
    // Ensure OPFS root is available before the VFS tries to use it
    await navigator.storage.getDirectory()

    // OriginPrivateFileSystemVFS stores files under their virtual filename directly
    // in the OPFS root, making export/import straightforward.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const vfs = new OriginPrivateFileSystemVFS() as SQLiteVFS
    sqlite3.vfs_register(vfs, /* makeDefault */ true)

    db = await openDbExclusive(DB_FILENAME)
  })

  await measureInit('boot.worker.migrations', () => runMigrationsOn(db))
  await measureInit('boot.worker.tableHashes', () => ensureTableHashesCurrent(db))

  const queriedLimit = sqlite3.limit(db, SQLITE_LIMIT_VARIABLE_NUMBER, -1)
  if (queriedLimit > 0) maxBoundParams = Math.floor(queriedLimit * 0.9)

  dbReady = true
  bootPerf.push({ metric: 'boot.worker.total', ms: performance.now() - startedAt })
  self.postMessage({ id: '', bootPerf } satisfies WorkerResponse)
}

// Ordem de aplicação das migrations. Substituiu uma escada de 12 `if (version < N)` para que a
// aplicação seja um laço — é o que torna viável envolver cada passo numa transação (SEC-06).
// Ao adicionar `vN.sql`: incluir aqui E bumpar MAX_KNOWN_DB_VERSION acima (e o sync_gimbo.py,
// ver "Armadilha recorrente" no CLAUDE.md).
const MIGRATIONS: ReadonlyArray<readonly [version: number, sql: string]> = [
  [1, v1Schema],
  [2, v2Schema],
  [3, v3Schema],
  [4, v4Schema],
  [5, v5Schema],
  [6, v6Schema],
  [7, v7Schema],
  [8, v8Schema],
  [9, v9Schema],
  [10, v10Schema],
  [11, v11Schema],
  [12, v12Schema],
  [13, v13Schema],
  [14, v14Schema],
  [15, v15Schema],
  [16, v16Schema],
  [17, v17Schema],
  [18, v18Schema],
  [19, v19Schema],
]

// Applies pending migrations to an arbitrary db pointer — the main `db` on every open, or a
// scratch db opened from a peer's bytes (CS-15's readForeignDataFile, which never touches `db`),
// ou a cópia em staging de um import (SEC-05).
//
// SEC-06 — duas garantias que a versão anterior não dava:
//
// 1. **Cada migration roda numa transação.** Os arquivos `vN.sql` usam `ALTER TABLE ... ADD COLUMN`,
//    que o SQLite não suporta com `IF NOT EXISTS`, e terminam com `PRAGMA user_version = N`. Sem
//    transação, uma interrupção entre o ALTER e o PRAGMA (aba fechada, quota de OPFS, crash do
//    worker) deixava a coluna criada e a versão desatualizada — no boot seguinte o mesmo ALTER
//    rodava de novo e falhava com `duplicate column name`, **em definitivo**, com o cofre trancado
//    no OPFS. O SQLite tem DDL transacional e o `user_version` vive no header do arquivo, então
//    ambos entram no mesmo COMMIT: ou a migration inteira valeu, ou nada dela valeu.
//    (Verificado que nenhum `vN.sql` abre transação própria — envolvê-los é seguro.)
//
// 2. **Guarda de versão futura.** Antes só o caminho de peer comparava contra MAX_KNOWN_DB_VERSION;
//    o boot e o import abriam um arquivo de versão desconhecida e liam com o schema velho.
/**
 * Abre um banco e retém o bloqueio exclusivo **antes de qualquer leitura**.
 *
 * A ordem não é estilo. Desde o `HY-20` o cofre é gravado em WAL, e um arquivo com cabeçalho de
 * WAL não pode sequer ser lido por esta VFS em modo de bloqueio normal — ela não implementa
 * `xShmMap`/`xShmLock`, e sem memória compartilhada o SQLite recusa a abertura. Um único
 * `PRAGMA user_version` disparado antes deste pragma derruba a leitura inteira: foi o que quebrou
 * a leitura de peer quando o WAL entrou, porque `readForeignDataFile` inspecionava a versão do
 * arquivo antes de rodar as migrations.
 *
 * O bloqueio exclusivo também é a maior alavanca de leitura do projeto — ver `runMigrationsOn`.
 */
async function openDbExclusive(name: string): Promise<number> {
  const dbPtr = await sqlite3.open_v2(name)
  await sqlite3.run(dbPtr, 'PRAGMA locking_mode=EXCLUSIVE')
  return dbPtr
}

async function runMigrationsOn(dbPtr: number): Promise<void> {
  // HY-19/HY-20: o WAL só pega porque `openDbExclusive` já reteve o bloqueio exclusivo. Sem ele
  // esta linha é um **no-op silencioso** — `OriginPrivateFileSystemVFS` não implementa
  // `xShmMap`/`xShmLock`, e sem memória compartilhada o SQLite recusa o WAL devolvendo o modo
  // atual, sem erro. O cofre rodou em `delete` desde sempre, apesar desta linha existir (`HY-19`).
  //
  // O par (bloqueio exclusivo + WAL) é a maior alavanca de desempenho que este projeto encontrou.
  // A VFS só abre o `SyncAccessHandle` no lock exclusivo e o **fecha** quando o lock cai, então em
  // modo normal toda leitura de página cai no caminho lento — `getFile()` + `Blob.slice()` +
  // `arrayBuffer()`, três operações assíncronas por página de 4KB. E em `delete` toda transação
  // cria, escreve e apaga um arquivo de journal no OPFS, pela mesma VFS cara.
  //
  // Medido no cofre real (26.576 transações, `plan/MONITORING.md`): leitura completa 1.974ms →
  // 770ms, e update de uma linha 24,3ms → 0,4ms. Custo aceito: uma segunda aba não consegue abrir
  // o mesmo cofre — tratado em `lib/vaultOwnership.ts`, com aviso e opção de assumir o controle.
  await sqlite3.run(dbPtr, 'PRAGMA journal_mode=WAL')

  // M-71/PERFORMANCE.md: sem isto, b-trees temporárias de GROUP BY/ORDER BY (ex.:
  // getTransactions(), que agrupa por t.id e ordena por t.date/created_at — chaves diferentes)
  // espirram para "arquivo", e como a VFS registrada é assíncrona (OriginPrivateFileSystemVFS),
  // cada página do temporário vira uma operação assíncrona contra o OPFS. temp_store não é
  // persistido no arquivo do banco — precisa ser setado a cada conexão, por isso mora aqui, ao
  // lado do journal_mode, que já roda em toda abertura.
  await sqlite3.run(dbPtr, 'PRAGMA temp_store = MEMORY')

  const { rows } = await sqlite3.execWithParams(dbPtr, 'PRAGMA user_version')
  const version = (rows[0]?.[0] ?? 0) as number

  if (version > MAX_KNOWN_DB_VERSION) {
    throw new Error(
      `${ERR_SCHEMA_TOO_NEW}: banco na versão ${version}, este build migra até ${MAX_KNOWN_DB_VERSION}`
    )
  }

  for (const [target, sql] of MIGRATIONS) {
    if (version >= target) continue

    await sqlite3.run(dbPtr, 'BEGIN')
    try {
      await sqlite3.run(dbPtr, sql)
      await sqlite3.run(dbPtr, 'COMMIT')
    } catch (err) {
      try {
        await sqlite3.run(dbPtr, 'ROLLBACK')
      } catch {
        // Já desfeita pelo próprio erro, ou transação nunca aberta — nada a liberar.
      }
      throw err
    }
  }
}

// ─── Export / Import ──────────────────────────────────────────────────────────

async function exportDb(): Promise<ArrayBuffer> {
  // Flush all committed WAL frames into the main database file so the
  // snapshot we read is consistent and complete.
  await sqlite3.run(db, 'PRAGMA wal_checkpoint(FULL)')

  // OriginPrivateFileSystemVFS maps `gimbo.db` → OPFS file named `gimbo.db`.
  const root = await navigator.storage.getDirectory()
  const fileHandle = await root.getFileHandle(DB_FILENAME)
  const file = await fileHandle.getFile()
  return file.arrayBuffer()
}

// Remove um arquivo do OPFS junto de seus acompanhantes de journal. Best-effort: a ausência de
// `-wal`/`-journal` é o caso comum, não um erro.
async function removeDbFiles(root: FileSystemDirectoryHandle, name: string): Promise<void> {
  for (const suffix of ['', '-wal', '-journal'] as const) {
    try {
      await root.removeEntry(name + suffix)
    } catch {
      // Não existe — nada a fazer.
    }
  }
}

async function readFileBytes(root: FileSystemDirectoryHandle, name: string): Promise<ArrayBuffer> {
  const handle = await root.getFileHandle(name)
  return (await handle.getFile()).arrayBuffer()
}

async function writeFileBytes(
  root: FileSystemDirectoryHandle,
  name: string,
  bytes: ArrayBuffer
): Promise<void> {
  const handle = await root.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(bytes)
  await writable.close()
}

/**
 * Import de backup — **replace total** do cofre.
 *
 * SEC-05: a versão anterior fechava o banco e sobrescrevia `gimbo.db` no OPFS **antes** de saber
 * se os bytes recebidos eram sequer um SQLite válido. Um `.db` truncado, corrompido, ou capturado
 * no meio de uma escrita do cliente de nuvem apagava permanentemente todo o histórico financeiro,
 * e a UI só exibia "arquivo corrompido" depois que os dados já tinham sumido.
 *
 * Agora o cofre atual só é tocado depois que a cópia recebida provou, num arquivo separado, que:
 * abre como SQLite, não vem de uma versão futura do schema, migra até a atual, e contém um
 * DataFile efetivamente legível (não só um arquivo que "abre"). É o mesmo padrão que
 * `readForeignDataFile` (CS-15) já usava para peers — este caminho é que não o reusava.
 *
 * A promoção final ainda copia bytes, então guarda-se um snapshot do cofre atual como rede: se a
 * troca falhar no meio, o snapshot é restaurado e o usuário fica exatamente como estava.
 */
async function importDb(data: ArrayBuffer): Promise<void> {
  const root = await navigator.storage.getDirectory()
  const stagingName = `import-staging-${crypto.randomUUID()}.db`
  const rollbackName = `import-rollback-${crypto.randomUUID()}.db`

  // ── 1. Materializa os bytes recebidos fora do caminho do cofre ───────────────
  try {
    await writeFileBytes(root, stagingName, data)
  } catch (err) {
    await removeDbFiles(root, stagingName)
    throw new Error(`${ERR_DB_UNREADABLE}: falha ao gravar o arquivo recebido (${String(err)})`)
  }

  // ── 2. Valida a cópia: abre, guarda de versão, migra e lê de verdade ─────────
  let stagingDb: number
  try {
    stagingDb = await openDbExclusive(stagingName)
  } catch {
    await removeDbFiles(root, stagingName)
    throw new Error(`${ERR_DB_UNREADABLE}: o arquivo não é um banco SQLite válido`)
  }

  let migratedBytes: ArrayBuffer
  try {
    // `runMigrationsOn` já lança ERR_SCHEMA_TOO_NEW quando o user_version é maior que este build
    // conhece, e cada migration roda em transação (SEC-06).
    await runMigrationsOn(stagingDb)

    // Abrir não é o suficiente: um arquivo pode ser SQLite válido e mesmo assim não conter o
    // schema do Gimbo. Ler o DataFile é o que prova que a importação vai resultar em algo usável.
    const parsed = await readDataFileFromDb(stagingDb)
    if (!parsed) {
      throw new Error(`${ERR_DB_UNREADABLE}: o arquivo não contém dados do Gimbo`)
    }

    // Consolida o WAL da migração dentro do próprio arquivo, para promover um único blob coerente.
    await sqlite3.run(stagingDb, 'PRAGMA wal_checkpoint(FULL)')
    await sqlite3.close(stagingDb)
    migratedBytes = await readFileBytes(root, stagingName)
  } catch (err) {
    try {
      await sqlite3.close(stagingDb)
    } catch {
      // Já fechado pelo caminho feliz acima, ou nunca totalmente aberto.
    }
    await removeDbFiles(root, stagingName)
    throw err instanceof Error && String(err.message).startsWith('GIMBO_')
      ? err
      : new Error(`${ERR_DB_UNREADABLE}: ${String(err)}`)
  }

  // ── 3. Snapshot do cofre atual, para poder desfazer a troca ──────────────────
  await sqlite3.run(db, 'PRAGMA wal_checkpoint(FULL)')
  await sqlite3.close(db)
  let haveRollback = false
  try {
    await writeFileBytes(root, rollbackName, await readFileBytes(root, DB_FILENAME))
    haveRollback = true
  } catch {
    // Cofre ainda inexistente (import no onboarding) — não há o que desfazer.
  }

  // ── 4. Promove a cópia validada ──────────────────────────────────────────────
  try {
    await writeFileBytes(root, DB_FILENAME, migratedBytes)
    // WAL/journal antigos descrevem o banco anterior; deixá-los corromperia a próxima abertura.
    for (const suffix of ['-wal', '-journal'] as const) {
      try {
        await root.removeEntry(DB_FILENAME + suffix)
      } catch {
        // Não existe — nada a fazer.
      }
    }
    db = await openDbExclusive(DB_FILENAME)
    await runMigrationsOn(db)
    // CS-34: importDb() reabre `db` fora do caminho de boot de init() — sem isto, um .db
    // importado sem table_hashes só ganharia o backfill no próximo reload da página, não neste
    // mesmo carregamento (a UI já segue usando o cofre importado sem reload, ver handleImportDb
    // em Settings/Onboarding).
    await ensureTableHashesCurrent(db)
  } catch (err) {
    // A troca falhou no meio. Devolve o cofre ao estado anterior antes de propagar.
    if (haveRollback) {
      try {
        await writeFileBytes(root, DB_FILENAME, await readFileBytes(root, rollbackName))
        for (const suffix of ['-wal', '-journal'] as const) {
          try {
            await root.removeEntry(DB_FILENAME + suffix)
          } catch {
            // Não existe — nada a fazer.
          }
        }
        db = await openDbExclusive(DB_FILENAME)
        await runMigrationsOn(db)
      } catch {
        // Restauração falhou também. Preserva o snapshot em disco em vez de apagá-lo no `finally`
        // — é a única cópia dos dados do usuário neste ponto, e o resgate do SEC-06 a alcança.
        await removeDbFiles(root, stagingName)
        throw new Error(
          `${ERR_DB_UNREADABLE}: falha ao importar e ao restaurar; cópia do cofre anterior preservada em "${rollbackName}" no OPFS`
        )
      }
    } else {
      // Sem snapshot (não havia cofre antes — import no onboarding). Nada a restaurar, mas o
      // ponteiro `db` acabou de ser fechado na fase 3: sem reabrir, toda operação seguinte
      // falharia até um reload, mesmo o erro sendo recuperável. Best-effort de propósito — se
      // nem isso funcionar, o erro original abaixo continua sendo o que descreve a falha.
      try {
        db = await openDbExclusive(DB_FILENAME)
        await runMigrationsOn(db)
      } catch {
        // Worker segue inutilizável até um reload; o erro propagado abaixo já diz ao usuário
        // que o import falhou, e não havia dados a perder neste caminho.
      }
    }
    await removeDbFiles(root, stagingName)
    await removeDbFiles(root, rollbackName)
    throw err
  }

  await removeDbFiles(root, stagingName)
  await removeDbFiles(root, rollbackName)
}

// ─── Hash de partição (CS-30/CS-31 Fase 2) ─────────────────────────────────────

// Upsert de uma linha de table_hashes contra o `db` local — sempre o `db` módulo-level, nunca um
// dbPtr de peer/scratch/staging, porque a tabela de hash existe pra o sync decidir o que ler
// *deste* dispositivo, não pra descrever um banco alheio.
async function upsertTableHash(
  tableName: string,
  partitionKey: string,
  hash: number,
  rowCount: number
): Promise<void> {
  await sqlite3.run(
    db,
    `INSERT INTO table_hashes (table_name, partition_key, hash_value, row_count) VALUES (?, ?, ?, ?)
     ON CONFLICT(table_name, partition_key) DO UPDATE SET hash_value = excluded.hash_value, row_count = excluded.row_count`,
    [tableName, partitionKey, hash, rowCount]
  )
}

// As tabelas "pequenas" — sempre hasheadas como um todo (partition_key = ''), nunca
// particionadas por ano como transactions. settings/users ficam de fora: são singleton, sempre
// lidos, comparar hash não economiza nada. deleted_ids entra aqui (não em transactions) porque um
// tombstone pode apagar qualquer tipo de entidade, não só transações.
async function refreshSmallTableHashes(d: RawDataFile, ts: string): Promise<void> {
  // accounts/categories/tags/budgets persistem `updatedAt ?? ts` (abaixo, nas próprias inserções)
  // quando o objeto em memória não traz um `updatedAt` — hashear o valor *não normalizado* faria
  // o hash mudar sozinho no primeiro round-trip por loadDataFile() (que sempre volta com o
  // fallback já preenchido), mesmo sem nenhuma edição real. Normalizar aqui do mesmo jeito que a
  // escrita normaliza mantém o hash estável através de leitura-e-escrita-de-volta — achado via
  // e2e/tableHashSync.spec.ts (o hash de accounts mudava sozinho depois de um applyMutation que
  // só tocava transactions).
  await upsertTableHash(
    'accounts',
    '',
    combineHashes(
      d.accounts.map((a) => hashRow(accountRowKey({ ...a, updatedAt: a.updatedAt ?? ts })))
    ),
    d.accounts.length
  )
  await upsertTableHash(
    'categories',
    '',
    combineHashes(
      d.categories.map((c) => hashRow(categoryRowKey({ ...c, updatedAt: c.updatedAt ?? ts })))
    ),
    d.categories.length
  )
  await upsertTableHash(
    'tags',
    '',
    combineHashes(d.tags.map((t) => hashRow(tagRowKey({ ...t, updatedAt: t.updatedAt ?? ts })))),
    d.tags.length
  )
  await upsertTableHash(
    'budgets',
    '',
    combineHashes(
      (d.budgets ?? []).map((b) => hashRow(budgetRowKey({ ...b, updatedAt: b.updatedAt ?? ts })))
    ),
    (d.budgets ?? []).length
  )
  await upsertTableHash(
    'valuations',
    '',
    combineHashes((d.valuations ?? []).map((v) => hashRow(valuationRowKey(v)))),
    (d.valuations ?? []).length
  )
  await upsertTableHash(
    'saved_periods',
    '',
    combineHashes((d.savedPeriods ?? []).map((p) => hashRow(savedPeriodRowKey(p)))),
    (d.savedPeriods ?? []).length
  )
  await upsertTableHash(
    'audit_log',
    '',
    combineHashes(d.auditLog.map((e) => hashRow(auditEntryRowKey(e)))),
    d.auditLog.length
  )
  await upsertTableHash(
    'deleted_ids',
    '',
    combineHashes(d.deletedIds.map((id) => hashRow(deletedIdRowKey(id)))),
    d.deletedIds.length
  )
  await upsertTableHash(
    'devices',
    '',
    combineHashes(
      (d.devices ?? []).map((dev) =>
        hashRow(deviceRowKey({ ...dev, updatedAt: dev.updatedAt ?? ts }))
      )
    ),
    (d.devices ?? []).length
  )
  await upsertTableHash(
    'hypotheses',
    '',
    combineHashes(
      (d.hypotheses ?? []).map((h) =>
        hashRow(hypothesisRowKey({ ...h, updatedAt: h.updatedAt ?? ts }))
      )
    ),
    (d.hypotheses ?? []).length
  )
  // CS-39: quem escreve hash também registra sob qual esquema escreveu. Esta função roda em toda
  // mutação (via writeSmallTables) e em todo replaceAll, então a sentinela nunca fica atrás das
  // partições que ela descreve — sem isto, um replaceAll (import, restauração, merge de sync)
  // repopularia todas as partições deixando a sentinela ausente/velha, e o boot seguinte jogaria
  // fora um trabalho recém-feito para recomputar exatamente os mesmos valores.
  await upsertTableHash(HASH_META_TABLE, HASH_VERSION_KEY, HASH_VERSION, 0)
}

async function upsertTransactionYearHash(year: string, txs: RawTransaction[]): Promise<void> {
  // combineHashes([]) === 0 — um ano que esvaziou por completo (última transação apagada) grava
  // (hash=0, row_count=0), nunca deixa a entrada antiga (agora errada) parada em table_hashes.
  await upsertTableHash(
    'transactions',
    year,
    combineHashes(txs.map((t) => hashRow(transactionRowKey(t)))),
    txs.length
  )
}

// Usado por replaceAll(): já tem o array completo de transações em mãos (reescreveu tudo), então
// agrupa por ano em memória. Precisa ainda assim consultar quais anos já tinham entrada em
// table_hashes — um ano que existia antes e não aparece mais no array novo (todas as transações
// daquele ano vieram deletadas pelo merge) tem que ser zerado, não deixado com o hash antigo.
//
// `ts`: mesma normalização de refreshSmallTableHashes — a escrita logo abaixo persiste
// `tx.updatedAt ?? ts`/`tx.createdAt ?? ts` quando o objeto em memória não traz esses campos;
// hashear o valor pré-fallback faria o hash mudar sozinho no primeiro round-trip por
// loadDataFile()/refreshTransactionYearHashesFromDb (que sempre voltam com o fallback já
// preenchido). Só relevante aqui: a variante "FromDb" já lê o estado persistido, já normalizado.
async function refreshTransactionYearHashesFromMemory(
  transactions: RawTransaction[],
  ts: string
): Promise<void> {
  const byYear = new Map<string, RawTransaction[]>()
  for (const raw of transactions) {
    const tx: RawTransaction = {
      ...raw,
      updatedAt: raw.updatedAt ?? ts,
      createdAt: raw.createdAt ?? ts,
    }
    const year = tx.date.slice(0, 4)
    const list = byYear.get(year)
    if (list) list.push(tx)
    else byYear.set(year, [tx])
  }
  const { rows: existingYearRows } = await sqlite3.execWithParams(
    db,
    "SELECT DISTINCT partition_key FROM table_hashes WHERE table_name = 'transactions'"
  )
  const years = new Set<string>(byYear.keys())
  for (const [year] of existingYearRows) years.add(year as string)
  for (const year of years) {
    await upsertTransactionYearHash(year, byYear.get(year) ?? [])
  }
}

/**
 * CS-51: intervalo semiaberto de um ano, para filtrar `transactions` **pelo índice**.
 *
 * `date LIKE '2026%'` parece um filtro de prefixo, mas o `EXPLAIN QUERY PLAN` real (medido em
 * 2026-08-27, Chrome, wa-sqlite/OPFS) mostra `SCAN t` — varredura completa da tabela. A otimização
 * de prefixo do SQLite não se aplica aqui porque `LIKE` é case-insensitive por padrão e o índice
 * usa colação BINARY; nem literal nem parâmetro vinculado ativam o índice. Já
 * `date >= ? AND date < ?` dá `SEARCH t USING INDEX idx_transactions_date_created`.
 *
 * Importa porque as duas formas estavam em caminhos quentes: `refreshTransactionYearHashesFromDb`
 * roda a cada mutação (uma varredura completa por ano tocado) e `readTransactionsForYears` roda a
 * cada leitura de partição.
 */
function yearRange(year: string): [string, string] {
  return [`${year}-01-01`, `${Number(year) + 1}-01-01`]
}

// Usado por applyTransactionDelta(): só os anos de fato afetados por esta mutação (fetchOldYears
// + anos novos dos upserts) — relê cada um do `db` (já com o delta aplicado) em vez de manter um
// array completo em memória, porque o delta não carrega o estado das linhas não tocadas.
async function refreshTransactionYearHashesFromDb(years: Iterable<string>): Promise<void> {
  for (const year of years) {
    const txRows = await queryRows(
      db,
      'SELECT * FROM transactions WHERE date >= ? AND date < ?',
      yearRange(year)
    )
    const ids = txRows.map((r) => r.id as string)
    const idBatchSize = Math.max(1, maxBoundParams)
    const tagsByTx = new Map<string, string[]>()
    const budgetsByTx = new Map<string, string[]>()
    for (const idBatch of chunk(ids, idBatchSize)) {
      if (idBatch.length === 0) continue
      const placeholders = idBatch.map(() => '?').join(',')
      const tagRows = await queryRows(
        db,
        `SELECT transaction_id, tag_id FROM transaction_tags WHERE transaction_id IN (${placeholders})`,
        idBatch
      )
      const budgetRows = await queryRows(
        db,
        `SELECT transaction_id, budget_id FROM transaction_budgets WHERE transaction_id IN (${placeholders})`,
        idBatch
      )
      for (const [id, list] of groupJoinIds(tagRows, 'tag_id')) tagsByTx.set(id, list)
      for (const [id, list] of groupJoinIds(budgetRows, 'budget_id')) budgetsByTx.set(id, list)
    }
    const txs = txRows.map((r) =>
      sqlRowToRawTransaction(
        r,
        tagsByTx.get(r.id as string) ?? [],
        budgetsByTx.get(r.id as string) ?? []
      )
    )
    await upsertTransactionYearHash(year, txs)
  }
}

// ─── replaceAll ───────────────────────────────────────────────────────────────

// M-73/PERFORMANCE.md: tudo que replaceAll() reescreve por completo EXCETO
// transactions/transaction_tags/transaction_budgets — extraído pra ser reaproveitado por
// applyMutation() (M-73), que troca só a parte de transações por um diff direcionado. Estas
// tabelas são pequenas (dezenas/centenas de linhas, nunca a mesma ordem de grandeza de
// transactions) — o custo de reescrever tudo nelas a cada mutação já é baixo, não vale o risco
// de dar CRUD direcionado pra cada uma.
async function writeSmallTables(d: RawDataFile, ts: string): Promise<void> {
  // Clear in dependency order (junction tables and leaves first)
  await sqlite3.run(db, 'DELETE FROM audit_log')
  await sqlite3.run(db, 'DELETE FROM deleted_ids')
  await sqlite3.run(db, 'DELETE FROM devices')
  await sqlite3.run(db, 'DELETE FROM valuations')
  await sqlite3.run(db, 'DELETE FROM saved_periods')
  await sqlite3.run(db, 'DELETE FROM budgets')
  // `ON DELETE CASCADE` never fires here — this connection never runs `PRAGMA foreign_keys = ON`
  // (SQLite defaults it off), so the child table needs its own explicit DELETE, same as
  // transaction_tags/transaction_budgets before transactions elsewhere in this file.
  await sqlite3.run(db, 'DELETE FROM hypothesis_items')
  await sqlite3.run(db, 'DELETE FROM hypotheses')
  await sqlite3.run(db, 'DELETE FROM categories')
  await sqlite3.run(db, 'DELETE FROM tags')
  await sqlite3.run(db, 'DELETE FROM accounts')
  await sqlite3.run(db, 'DELETE FROM settings')
  await sqlite3.run(db, 'DELETE FROM users')

  // user — `email` column kept physically (no DDL change) but never populated anymore, M-69
  await sqlite3.run(
    db,
    "INSERT INTO users (id, name, email, created_at, updated_at) VALUES ('singleton', ?, '', ?, ?)",
    [d.user.name, d.user.createdAt, d.user.updatedAt]
  )

  // settings
  await sqlite3.run(
    db,
    "INSERT INTO settings (id, file_created_at, file_updated_at, audit_log_retention_limit, quadrantes_enabled, quadrantes_infer_from_history) VALUES ('singleton', ?, ?, ?, ?, ?)",
    [
      d.settings.fileCreatedAt,
      d.settings.fileUpdatedAt,
      d.settings.auditLogRetentionLimit,
      d.settings.quadrantesEnabled ? 1 : 0,
      d.settings.quadrantesInferFromHistory ? 1 : 0,
    ]
  )

  // accounts
  for (const acc of d.accounts) {
    await sqlite3.run(
      db,
      `INSERT INTO accounts
           (id, name, type, balance, include_in_balance,
            credit_limit, credit_closing_day, credit_due_day,
            loan_outstanding_balance, loan_monthly_payment, loan_remaining_installments, loan_interest_rate,
            is_reserve, issuer_icon, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        acc.id,
        acc.name,
        acc.type,
        acc.balance,
        acc.includeInBalance ? 1 : 0,
        acc.creditMetadata?.limit ?? null,
        acc.creditMetadata?.closingDay ?? null,
        acc.creditMetadata?.dueDay ?? null,
        acc.loanMetadata?.outstandingBalance ?? null,
        acc.loanMetadata?.monthlyPayment ?? null,
        acc.loanMetadata?.remainingInstallments ?? null,
        acc.loanMetadata?.interestRate ?? null,
        acc.reserveMetadata ? 1 : 0,
        acc.issuerIcon ?? null,
        acc.archived ? 1 : 0,
        ts,
        acc.updatedAt ?? ts,
      ]
    )
  }

  // categories — parents before children to respect the self-referential FK
  const parents = d.categories.filter((c) => !c.parentId)
  const children = d.categories.filter((c) => c.parentId)
  for (const cat of [...parents, ...children]) {
    await sqlite3.run(
      db,
      `INSERT INTO categories (id, parent_id, name, icon, color, type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cat.id,
        cat.parentId ?? null,
        cat.name,
        cat.icon,
        cat.color,
        cat.type,
        ts,
        cat.updatedAt ?? ts,
      ]
    )
  }

  // tags
  for (const tag of d.tags) {
    await sqlite3.run(
      db,
      'INSERT INTO tags (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [tag.id, tag.name, tag.color, ts, tag.updatedAt ?? ts]
    )
  }

  // budgets (F-30/BX-03)
  for (const b of d.budgets ?? []) {
    await sqlite3.run(
      db,
      `INSERT INTO budgets
           (id, name, emoji, color, kind, target, period_mode, period_date, period_start, period_end,
            archived_at, recipe_slug, recipe_slot, created_at, updated_at, target_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        b.id,
        b.name,
        b.emoji,
        b.color,
        b.kind,
        b.target,
        b.period.mode,
        b.period.mode === 'date' ? b.period.date : null,
        b.period.mode === 'range' ? b.period.start : null,
        b.period.mode === 'range' ? b.period.end : null,
        b.archivedAt ?? null,
        b.recipeSlug ?? null,
        b.recipeSlot ?? null,
        b.createdAt ?? ts,
        b.updatedAt ?? ts,
        b.targetSource ?? null,
      ]
    )
  }

  // valuations
  for (const v of d.valuations ?? []) {
    await sqlite3.run(
      db,
      'INSERT INTO valuations (id, account_id, date, market_value) VALUES (?, ?, ?, ?)',
      [v.id, v.accountId, v.date, v.marketValue]
    )
  }

  // saved periods (M-45)
  for (const p of d.savedPeriods ?? []) {
    await sqlite3.run(
      db,
      'INSERT INTO saved_periods (id, name, start_date, end_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [p.id, p.name, p.start, p.end, ts, ts]
    )
  }

  // audit log
  for (const entry of d.auditLog) {
    await sqlite3.run(
      db,
      'INSERT INTO audit_log (id, timestamp, action, entity, entity_id, summary, device_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        entry.id,
        entry.timestamp,
        entry.action,
        entry.entity,
        entry.entityId,
        entry.summary,
        entry.deviceId ?? null,
      ]
    )
  }

  // tombstones
  for (const id of d.deletedIds) {
    await sqlite3.run(db, 'INSERT OR IGNORE INTO deleted_ids (id) VALUES (?)', [id])
  }

  // devices (M-96/M-97)
  for (const dev of d.devices ?? []) {
    await sqlite3.run(db, 'INSERT INTO devices (id, name, updated_at) VALUES (?, ?, ?)', [
      dev.id,
      dev.name,
      dev.updatedAt ?? ts,
    ])
  }

  // hypotheses + items (M-101/Simulações) — never linked to any real Transaction/Account
  for (const h of d.hypotheses ?? []) {
    await sqlite3.run(
      db,
      'INSERT INTO hypotheses (id, name, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [h.id, h.name, h.enabled ? 1 : 0, h.createdAt, h.updatedAt ?? ts]
    )
    for (const item of h.items) {
      await sqlite3.run(
        db,
        `INSERT INTO hypothesis_items
             (id, hypothesis_id, kind, description, type, amount, start_date,
              installment_count, frequency, end_date, category_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id,
          h.id,
          item.kind,
          item.description,
          item.type,
          item.amount,
          item.startDate,
          item.installmentCount ?? null,
          item.frequency ?? null,
          item.endDate ?? null,
          item.categoryId ?? null,
        ]
      )
    }
  }

  await refreshSmallTableHashes(d, ts)
}

async function replaceAll(raw: unknown): Promise<void> {
  const d = raw as RawDataFile
  // Use the settings timestamp as a stable fallback for entities that lack one
  const ts = d.settings.fileCreatedAt || new Date().toISOString()

  await sqlite3.run(db, 'BEGIN')
  try {
    // Clear in dependency order (junction tables and leaves first)
    await sqlite3.run(db, 'DELETE FROM transaction_tags')
    await sqlite3.run(db, 'DELETE FROM transaction_budgets')
    await sqlite3.run(db, 'DELETE FROM transactions')

    await writeSmallTables(d, ts)

    // transactions + junction rows
    for (const tx of d.transactions) {
      await sqlite3.run(
        db,
        `INSERT INTO transactions
           (id, account_id, category_id, amount, type, description, date, is_paid,
            transfer_account_id, installment_parent_id, installment_index, installment_total,
            installment_purchase_date,
            recurrence_parent_id, recurrence_frequency, recurrence_end_date, reference_month,
            invoice_due_date, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tx.id,
          tx.accountId,
          tx.categoryId || null,
          tx.amount,
          tx.type,
          tx.description,
          tx.date,
          tx.isPaid ? 1 : 0,
          tx.transferAccountId ?? null,
          tx.installment?.parentId ?? null,
          tx.installment?.currentIndex ?? null,
          tx.installment?.total ?? null,
          tx.installment?.purchaseDate ?? null,
          tx.recurrence?.parentId ?? null,
          tx.recurrence?.frequency ?? null,
          tx.recurrence?.endDate ?? null,
          tx.referenceMonth ?? null,
          tx.invoiceDueDate ?? null,
          tx.notes ?? null,
          tx.createdAt ?? ts,
          tx.updatedAt ?? ts,
        ]
      )
      for (const tagId of tx.tags) {
        await sqlite3.run(
          db,
          'INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)',
          [tx.id, tagId]
        )
      }
      for (const budgetId of tx.budgetIds ?? []) {
        await sqlite3.run(
          db,
          'INSERT INTO transaction_budgets (transaction_id, budget_id) VALUES (?, ?)',
          [tx.id, budgetId]
        )
      }
    }

    await refreshTransactionYearHashesFromMemory(d.transactions, ts)

    await sqlite3.run(db, 'COMMIT')
  } catch (err) {
    try {
      await sqlite3.run(db, 'ROLLBACK')
    } catch {
      // Ignore rollback errors
    }
    throw err
  }
}

// ─── Mutação por diff (M-73/PERFORMANCE.md) ────────────────────────────────────
//
// replaceAll() reescreve a tabela transactions inteira a cada mutação — para o cofre real do
// usuário (~25 mil transações), ~29 mil INSERTs sequenciais por edição, cada um reprocessando o
// SQL do zero (sqlite3.run() prepara e finaliza a cada chamada, sem cache de statement).
// applyMutation() troca isso por um diff: só as linhas de transactions/transaction_tags/
// transaction_budgets que de fato mudaram viram INSERT/UPDATE/DELETE, em lotes multi-linha.

type RawTransactionDelta = { upserts: RawTransaction[]; deletedIds: string[] }

const TRANSACTION_COLUMNS = 21

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function applyTransactionDelta(delta: RawTransactionDelta, ts: string): Promise<void> {
  const idBatchSize = Math.max(1, maxBoundParams)
  const touchedIds = [...delta.deletedIds, ...delta.upserts.map((t) => t.id)]

  // CS-30/CS-31 Fase 2: precisa saber o ano *antigo* de cada linha tocada que já existia, antes
  // de qualquer DELETE/INSERT — é a única forma de saber de qual partição de hash tirar a
  // contribuição antiga se uma transação mudou de ano (ex.: editar a data de 31/dez pra jan do
  // ano seguinte). Sem isso, o hash do ano antigo ficaria parado, incorreto.
  const oldYearById = new Map<string, string>()
  for (const idBatch of chunk(touchedIds, idBatchSize)) {
    if (idBatch.length === 0) continue
    const placeholders = idBatch.map(() => '?').join(',')
    const rows = await queryRows(
      db,
      `SELECT id, date FROM transactions WHERE id IN (${placeholders})`,
      idBatch
    )
    for (const r of rows) oldYearById.set(r.id as string, (r.date as string).slice(0, 4))
  }

  // Junction rows são sempre apagadas e reinseridas para toda transação tocada (upsert ou
  // delete) — mais simples que diffar associação de tag/budget separadamente, e ainda barato:
  // o fan-out por transação é pequeno (medido no cofre real: ~0,15 tag/transação).
  for (const idBatch of chunk(touchedIds, idBatchSize)) {
    const placeholders = idBatch.map(() => '?').join(',')
    await sqlite3.run(
      db,
      `DELETE FROM transaction_tags WHERE transaction_id IN (${placeholders})`,
      idBatch
    )
    await sqlite3.run(
      db,
      `DELETE FROM transaction_budgets WHERE transaction_id IN (${placeholders})`,
      idBatch
    )
  }

  for (const idBatch of chunk(delta.deletedIds, idBatchSize)) {
    const placeholders = idBatch.map(() => '?').join(',')
    await sqlite3.run(db, `DELETE FROM transactions WHERE id IN (${placeholders})`, idBatch)
  }

  const transactionBatchSize = Math.max(1, Math.floor(maxBoundParams / TRANSACTION_COLUMNS))
  const junctionBatchSize = Math.max(1, Math.floor(maxBoundParams / 2))

  for (const rows of chunk(delta.upserts, transactionBatchSize)) {
    const rowPlaceholders = rows.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')
    const params: SQLiteCompatibleType[] = []
    for (const tx of rows) {
      params.push(
        tx.id,
        tx.accountId,
        tx.categoryId || null,
        tx.amount,
        tx.type,
        tx.description,
        tx.date,
        tx.isPaid ? 1 : 0,
        tx.transferAccountId ?? null,
        tx.installment?.parentId ?? null,
        tx.installment?.currentIndex ?? null,
        tx.installment?.total ?? null,
        tx.installment?.purchaseDate ?? null,
        tx.recurrence?.parentId ?? null,
        tx.recurrence?.frequency ?? null,
        tx.recurrence?.endDate ?? null,
        tx.referenceMonth ?? null,
        tx.invoiceDueDate ?? null,
        tx.notes ?? null,
        tx.createdAt ?? ts,
        tx.updatedAt ?? ts
      )
    }
    await sqlite3.run(
      db,
      `INSERT INTO transactions
         (id, account_id, category_id, amount, type, description, date, is_paid,
          transfer_account_id, installment_parent_id, installment_index, installment_total,
          installment_purchase_date,
          recurrence_parent_id, recurrence_frequency, recurrence_end_date, reference_month,
          invoice_due_date, notes, created_at, updated_at)
       VALUES ${rowPlaceholders}
       ON CONFLICT(id) DO UPDATE SET
         account_id=excluded.account_id, category_id=excluded.category_id,
         amount=excluded.amount, type=excluded.type, description=excluded.description,
         date=excluded.date, is_paid=excluded.is_paid,
         transfer_account_id=excluded.transfer_account_id,
         installment_parent_id=excluded.installment_parent_id,
         installment_index=excluded.installment_index,
         installment_total=excluded.installment_total,
         installment_purchase_date=excluded.installment_purchase_date,
         recurrence_parent_id=excluded.recurrence_parent_id,
         recurrence_frequency=excluded.recurrence_frequency,
         recurrence_end_date=excluded.recurrence_end_date,
         reference_month=excluded.reference_month, invoice_due_date=excluded.invoice_due_date,
         notes=excluded.notes,
         updated_at=excluded.updated_at`,
      params
    )

    const tagPairs: SQLiteCompatibleType[] = []
    const budgetPairs: SQLiteCompatibleType[] = []
    for (const tx of rows) {
      for (const tagId of tx.tags) tagPairs.push(tx.id, tagId)
      for (const budgetId of tx.budgetIds ?? []) budgetPairs.push(tx.id, budgetId)
    }
    for (const pairBatch of chunk(tagPairs, junctionBatchSize * 2)) {
      const placeholders = Array(pairBatch.length / 2)
        .fill('(?,?)')
        .join(',')
      await sqlite3.run(
        db,
        `INSERT INTO transaction_tags (transaction_id, tag_id) VALUES ${placeholders}`,
        pairBatch
      )
    }
    for (const pairBatch of chunk(budgetPairs, junctionBatchSize * 2)) {
      const placeholders = Array(pairBatch.length / 2)
        .fill('(?,?)')
        .join(',')
      await sqlite3.run(
        db,
        `INSERT INTO transaction_budgets (transaction_id, budget_id) VALUES ${placeholders}`,
        pairBatch
      )
    }
  }

  // Anos afetados: união dos anos antigos das linhas tocadas (upsert ou delete) com os anos
  // novos dos upserts — tipicamente 1, raramente 2 (uma transação mudando de ano). Nunca o
  // histórico inteiro, diferente de refreshTransactionYearHashesFromMemory (replaceAll).
  const affectedYears = new Set<string>()
  for (const id of delta.deletedIds) {
    const year = oldYearById.get(id)
    if (year) affectedYears.add(year)
  }
  for (const tx of delta.upserts) {
    affectedYears.add(tx.date.slice(0, 4))
    const oldYear = oldYearById.get(tx.id)
    if (oldYear) affectedYears.add(oldYear)
  }
  await refreshTransactionYearHashesFromDb(affectedYears)
}

async function applyMutation(rawData: unknown, rawDelta: unknown): Promise<void> {
  const d = rawData as RawDataFile
  const delta = rawDelta as RawTransactionDelta
  const ts = d.settings.fileCreatedAt || new Date().toISOString()

  await sqlite3.run(db, 'BEGIN')
  try {
    await writeSmallTables(d, ts)
    await applyTransactionDelta(delta, ts)
    await sqlite3.run(db, 'COMMIT')
  } catch (err) {
    try {
      await sqlite3.run(db, 'ROLLBACK')
    } catch {
      // Ignore rollback errors
    }
    throw err
  }
}

// ─── Reading a foreign .db in memory (CS-15) ───────────────────────────────────
//
// folderSyncService needs to read a peer's device-<id>.db bytes into a DataFile-shaped object
// without ever touching the local gimbo.db. wa-sqlite has no pure in-memory VFS, so the closest
// safe approximation is: write the peer's bytes to a scratch OPFS file with its own name, open a
// *second* db pointer against it, read every table, then delete the scratch file. `db` (the
// local database) is never migrated or written to during this process — CS-30/CS-31/CS-32 Fase
// 2b does read it once (`table_hashes` only, via readTableHashes(db)) to decide which of the
// peer's partitions are actually worth reading, but that read happens inside the same enqueue()'d
// task that processes the peer, so there's no window for a concurrent write to race it (see the
// CS-28 note on readTransactionsForYears above — the same "stay inside one dequeued task"
// invariant this whole file depends on).

async function queryRows(
  dbPtr: number,
  sql: string,
  params?: SQLiteCompatibleType[]
): Promise<Record<string, unknown>[]> {
  const { rows, columns } = await sqlite3.execWithParams(dbPtr, sql, params)
  return rows.map((row) => {
    const obj: Record<string, unknown> = {}
    columns.forEach((col, i) => {
      obj[col] = row[i]
    })
    return obj
  })
}

// Mirrors StorageService's groupIds() — duplicated rather than imported because that module
// instantiates the main-thread Worker wrapper and can't be pulled into the worker bundle itself.
function groupJoinIds(rows: Record<string, unknown>[], valueCol: string): Map<string, string[]> {
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

// Maps one raw SQL row (snake_case columns, as queryRows() returns) plus its already-joined
// tag/budget ids into a RawTransaction. Extracted out of readDataFileFromDb (CS-30/CS-31 Fase 2)
// so applyTransactionDelta's per-year hash recompute can reuse the exact same mapping instead of
// a second, easily-drifting reimplementation — the canonical shape a hash is computed from must
// match the shape read from the peer/local db bit for bit.
function sqlRowToRawTransaction(
  r: Record<string, unknown>,
  tags: string[],
  budgetIds: string[]
): RawTransaction {
  const tx: RawTransaction = {
    id: r.id as string,
    accountId: r.account_id as string,
    categoryId: (r.category_id as string | null) ?? '',
    amount: r.amount as number,
    type: r.type as string,
    description: r.description as string,
    date: r.date as string,
    isPaid: Boolean(r.is_paid),
    tags,
    budgetIds,
  }
  if (r.updated_at !== null && r.updated_at !== undefined) tx.updatedAt = r.updated_at as string
  if (r.created_at !== null && r.created_at !== undefined) tx.createdAt = r.created_at as string
  if (r.transfer_account_id !== null && r.transfer_account_id !== undefined) {
    tx.transferAccountId = r.transfer_account_id as string
  }
  if (r.reference_month !== null && r.reference_month !== undefined) {
    tx.referenceMonth = r.reference_month as string
  }
  if (r.invoice_due_date !== null && r.invoice_due_date !== undefined) {
    tx.invoiceDueDate = r.invoice_due_date as string
  }
  if (r.notes !== null && r.notes !== undefined) {
    tx.notes = r.notes as string
  }
  if (r.installment_parent_id !== null && r.installment_parent_id !== undefined) {
    tx.installment = {
      parentId: r.installment_parent_id as string,
      currentIndex: r.installment_index as number,
      total: r.installment_total as number,
      ...(r.installment_purchase_date !== null && r.installment_purchase_date !== undefined
        ? { purchaseDate: r.installment_purchase_date as string }
        : {}),
    }
  }
  if (r.recurrence_parent_id !== null && r.recurrence_parent_id !== undefined) {
    tx.recurrence = {
      frequency: r.recurrence_frequency as string,
      parentId: r.recurrence_parent_id as string,
      ...(r.recurrence_end_date !== null && r.recurrence_end_date !== undefined
        ? { endDate: r.recurrence_end_date as string }
        : {}),
    }
  }
  return tx
}

// Mirrors StorageService's rowTo* mappers, but against an arbitrary db pointer instead of the
// message-passing `this.query()` — necessary because this runs inside the worker itself, on a
// scratch db that StorageService (main thread) never sees.
//
// CS-30/CS-31/CS-32 Fase 2b: cada tabela vira um leitor próprio, chamado incondicionalmente por
// readDataFileFromDb() (leitura completa, usada por importDb() — validação de um import não pode
// depender de hash) e condicionalmente por readDataFileFromDbSelective() (leitura seletiva do
// peer, usada só pelo sync via readForeignDataFile()) — uma partição cujo hash bate com o local
// nunca chega a rodar seu leitor.

async function readAccounts(dbPtr: number): Promise<RawAccount[]> {
  const accountRows = await queryRows(dbPtr, 'SELECT * FROM accounts ORDER BY name')
  return accountRows.map((r) => {
    const acc: RawAccount = {
      id: r.id as string,
      name: r.name as string,
      type: r.type as string,
      balance: r.balance as number,
      includeInBalance: Boolean(r.include_in_balance),
    }
    if (r.credit_limit !== null && r.credit_limit !== undefined) {
      acc.creditMetadata = {
        limit: r.credit_limit as number,
        closingDay: r.credit_closing_day as number,
        dueDay: r.credit_due_day as number,
      }
    }
    if (r.loan_outstanding_balance !== null && r.loan_outstanding_balance !== undefined) {
      acc.loanMetadata = {
        outstandingBalance: r.loan_outstanding_balance as number,
        monthlyPayment: r.loan_monthly_payment as number,
        remainingInstallments: r.loan_remaining_installments as number,
        ...(r.loan_interest_rate !== null && r.loan_interest_rate !== undefined
          ? { interestRate: r.loan_interest_rate as number }
          : {}),
      }
    }
    if (r.is_reserve) acc.reserveMetadata = {}
    if (r.issuer_icon !== null && r.issuer_icon !== undefined)
      acc.issuerIcon = r.issuer_icon as string
    if (r.archived) acc.archived = true
    if (r.updated_at !== null && r.updated_at !== undefined) acc.updatedAt = r.updated_at as string
    return acc
  })
}

async function readCategories(dbPtr: number): Promise<RawCategory[]> {
  const categoryRows = await queryRows(dbPtr, 'SELECT * FROM categories ORDER BY name')
  return categoryRows.map((r) => ({
    id: r.id as string,
    parentId: (r.parent_id as string | null) ?? null,
    name: r.name as string,
    icon: r.icon as string,
    color: r.color as string,
    type: r.type as string,
    ...(r.updated_at !== null && r.updated_at !== undefined
      ? { updatedAt: r.updated_at as string }
      : {}),
  }))
}

async function readTags(dbPtr: number): Promise<RawTag[]> {
  const tagRows = await queryRows(dbPtr, 'SELECT * FROM tags ORDER BY name')
  return tagRows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    color: r.color as string,
    ...(r.updated_at !== null && r.updated_at !== undefined
      ? { updatedAt: r.updated_at as string }
      : {}),
  }))
}

// `years === null` lê o histórico inteiro (readDataFileFromDb, usa um único SELECT sem filtro
// pras junções — igual ao comportamento de sempre). `years` não-nulo lê só as transações daqueles
// anos (readDataFileFromDbSelective) e busca as junções batelada por id, já que não faz sentido
// puxar transaction_tags/transaction_budgets inteiras pra filtrar depois em memória.
//
// M-72/PERFORMANCE.md: o formato antigo (LEFT JOIN duplo + GROUP_CONCAT(DISTINCT) + GROUP BY
// t.id) custava ~224s num cofre real de ~25 mil transações sob wa-sqlite/WASM + VFS assíncrona do
// OPFS — o agregado em si era o gargalo, não o volume de linhas. Reescrito pra três queries
// simples unidas em JS — mesmo padrão de StorageService.getTransactions() (StorageService.ts).
//
// CS-28: sequential, NOT Promise.all — StorageService.getTransactions() roda suas três queries
// concorrentemente com segurança porque cada uma passa por `this.query()` → postMessage → a fila
// `enqueue()` do próprio worker (dispatch), que as serializa antes de qualquer uma chegar no
// wa-sqlite. Esta função já roda *dentro* de uma tarefa já retirada da fila, chamando
// `queryRows()` direto contra a instância wasm — o build async só suporta uma chamada Asyncify em
// voo por vez, e disparar três ao mesmo tempo corrompeu o estado interno do unwind, travando com
// "NotFoundError: Entry not found" → "RuntimeError: unreachable executed" na próxima chamada OPFS
// de *qualquer* operação seguinte (ex.: o import seguinte). Confirmado reproduzível.
async function readTransactionsForYears(
  dbPtr: number,
  years: string[] | null
): Promise<RawTransaction[]> {
  let txRows: Record<string, unknown>[]
  if (years === null) {
    txRows = await queryRows(
      dbPtr,
      'SELECT t.* FROM transactions t ORDER BY t.date DESC, t.created_at DESC'
    )
  } else if (years.length === 0) {
    return []
  } else {
    const conds = years.map(() => '(t.date >= ? AND t.date < ?)').join(' OR ')
    txRows = await queryRows(
      dbPtr,
      `SELECT t.* FROM transactions t WHERE ${conds} ORDER BY t.date DESC, t.created_at DESC`,
      years.flatMap(yearRange)
    )
  }
  if (txRows.length === 0) return []

  const tagsByTx = new Map<string, string[]>()
  const budgetsByTx = new Map<string, string[]>()
  if (years === null) {
    const txTagRows = await queryRows(dbPtr, 'SELECT transaction_id, tag_id FROM transaction_tags')
    const txBudgetRows = await queryRows(
      dbPtr,
      'SELECT transaction_id, budget_id FROM transaction_budgets'
    )
    for (const [id, list] of groupJoinIds(txTagRows, 'tag_id')) tagsByTx.set(id, list)
    for (const [id, list] of groupJoinIds(txBudgetRows, 'budget_id')) budgetsByTx.set(id, list)
  } else {
    const ids = txRows.map((r) => r.id as string)
    const idBatchSize = Math.max(1, maxBoundParams)
    for (const idBatch of chunk(ids, idBatchSize)) {
      const placeholders = idBatch.map(() => '?').join(',')
      const txTagRows = await queryRows(
        dbPtr,
        `SELECT transaction_id, tag_id FROM transaction_tags WHERE transaction_id IN (${placeholders})`,
        idBatch
      )
      const txBudgetRows = await queryRows(
        dbPtr,
        `SELECT transaction_id, budget_id FROM transaction_budgets WHERE transaction_id IN (${placeholders})`,
        idBatch
      )
      for (const [id, list] of groupJoinIds(txTagRows, 'tag_id')) tagsByTx.set(id, list)
      for (const [id, list] of groupJoinIds(txBudgetRows, 'budget_id')) budgetsByTx.set(id, list)
    }
  }

  return txRows.map((r) =>
    sqlRowToRawTransaction(
      r,
      tagsByTx.get(r.id as string) ?? [],
      budgetsByTx.get(r.id as string) ?? []
    )
  )
}

async function readValuations(dbPtr: number): Promise<RawValuation[]> {
  const valuationRows = await queryRows(
    dbPtr,
    'SELECT id, account_id, date, market_value FROM valuations'
  )
  return valuationRows.map((r) => ({
    id: r.id as string,
    accountId: r.account_id as string,
    date: r.date as string,
    marketValue: r.market_value as number,
  }))
}

async function readSavedPeriods(dbPtr: number): Promise<RawSavedPeriod[]> {
  const savedPeriodRows = await queryRows(
    dbPtr,
    'SELECT id, name, start_date, end_date FROM saved_periods ORDER BY created_at'
  )
  return savedPeriodRows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    start: r.start_date as string,
    end: r.end_date as string,
  }))
}

async function readBudgets(dbPtr: number): Promise<RawBudget[]> {
  const budgetRows = await queryRows(dbPtr, 'SELECT * FROM budgets ORDER BY created_at')
  return budgetRows.map((r) => {
    const period: RawBudget['period'] =
      r.period_mode === 'date'
        ? { mode: 'date', date: r.period_date as string }
        : { mode: 'range', start: r.period_start as string, end: r.period_end as string }
    const b: RawBudget = {
      id: r.id as string,
      name: r.name as string,
      emoji: r.emoji as string,
      color: r.color as string,
      kind: r.kind as string,
      target: r.target as number,
      period,
    }
    if (r.archived_at !== null && r.archived_at !== undefined)
      b.archivedAt = r.archived_at as string
    if (r.recipe_slug !== null && r.recipe_slug !== undefined)
      b.recipeSlug = r.recipe_slug as string
    if (r.recipe_slot !== null && r.recipe_slot !== undefined)
      b.recipeSlot = r.recipe_slot as number
    if (r.updated_at !== null && r.updated_at !== undefined) b.updatedAt = r.updated_at as string
    if (r.created_at !== null && r.created_at !== undefined) b.createdAt = r.created_at as string
    if (r.target_source !== null && r.target_source !== undefined)
      b.targetSource = r.target_source as string
    return b
  })
}

async function readAuditLog(dbPtr: number): Promise<RawAuditEntry[]> {
  const auditRows = await queryRows(dbPtr, 'SELECT * FROM audit_log ORDER BY timestamp ASC')
  return auditRows.map((r) => ({
    id: r.id as string,
    timestamp: r.timestamp as string,
    action: r.action as string,
    entity: r.entity as string,
    entityId: r.entity_id as string,
    summary: r.summary as string,
    ...(r.device_id !== null && r.device_id !== undefined
      ? { deviceId: r.device_id as string }
      : {}),
  }))
}

async function readDeletedIds(dbPtr: number): Promise<string[]> {
  const deletedRows = await queryRows(dbPtr, 'SELECT id FROM deleted_ids')
  return deletedRows.map((r) => r.id as string)
}

async function readDevices(dbPtr: number): Promise<RawDevice[]> {
  const deviceRows = await queryRows(dbPtr, 'SELECT * FROM devices ORDER BY updated_at')
  return deviceRows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    updatedAt: r.updated_at as string,
  }))
}

// M-101 (Simulações): duas queries simples + join em JS, nunca GROUP_CONCAT/GROUP BY (M-72/CS-26).
async function readHypotheses(dbPtr: number): Promise<RawHypothesis[]> {
  const hypothesisRows = await queryRows(dbPtr, 'SELECT * FROM hypotheses ORDER BY created_at')
  const itemRows = await queryRows(dbPtr, 'SELECT * FROM hypothesis_items ORDER BY hypothesis_id')
  const itemsByHypothesis = new Map<string, RawHypothesisItem[]>()
  for (const r of itemRows) {
    const item: RawHypothesisItem = {
      id: r.id as string,
      kind: r.kind as string,
      description: r.description as string,
      type: r.type as string,
      amount: r.amount as number,
      startDate: r.start_date as string,
    }
    if (r.installment_count !== null && r.installment_count !== undefined)
      item.installmentCount = r.installment_count as number
    if (r.frequency !== null && r.frequency !== undefined) item.frequency = r.frequency as string
    if (r.end_date !== null && r.end_date !== undefined) item.endDate = r.end_date as string
    if (r.category_id !== null && r.category_id !== undefined)
      item.categoryId = r.category_id as string
    const hypothesisId = r.hypothesis_id as string
    const list = itemsByHypothesis.get(hypothesisId) ?? []
    list.push(item)
    itemsByHypothesis.set(hypothesisId, list)
  }
  return hypothesisRows.map((r) => {
    const h: RawHypothesis = {
      id: r.id as string,
      name: r.name as string,
      enabled: Boolean(r.enabled),
      items: itemsByHypothesis.get(r.id as string) ?? [],
      createdAt: r.created_at as string,
    }
    if (r.updated_at !== null && r.updated_at !== undefined) h.updatedAt = r.updated_at as string
    return h
  })
}

async function readUserAndSettings(
  dbPtr: number
): Promise<{ user: RawUser; settings: RawSettings } | null> {
  const userRows = await queryRows(dbPtr, "SELECT * FROM users WHERE id = 'singleton'")
  if (userRows.length === 0) return null
  const settingsRows = await queryRows(dbPtr, "SELECT * FROM settings WHERE id = 'singleton'")
  if (settingsRows.length === 0) return null
  const u = userRows[0]
  const s = settingsRows[0]
  return {
    user: {
      name: u.name as string,
      createdAt: u.created_at as string,
      updatedAt: u.updated_at as string,
    },
    settings: {
      fileCreatedAt: s.file_created_at as string,
      fileUpdatedAt: s.file_updated_at as string,
      auditLogRetentionLimit: s.audit_log_retention_limit as number | null,
      quadrantesEnabled: Boolean(s.quadrantes_enabled),
      quadrantesInferFromHistory: Boolean(s.quadrantes_infer_from_history),
    },
  }
}

// Full, unconditional read of every table — used by importDb() (validating an import can't
// depend on hash comparisons) and by the readers above when called without a hash gate.
async function readDataFileFromDb(dbPtr: number): Promise<RawDataFile | null> {
  const base = await readUserAndSettings(dbPtr)
  if (!base) return null

  const accounts = await readAccounts(dbPtr)
  const categories = await readCategories(dbPtr)
  const tags = await readTags(dbPtr)
  const transactions = await readTransactionsForYears(dbPtr, null)
  const valuations = await readValuations(dbPtr)
  const savedPeriods = await readSavedPeriods(dbPtr)
  const budgets = await readBudgets(dbPtr)
  const auditLog = await readAuditLog(dbPtr)
  const deletedIds = await readDeletedIds(dbPtr)
  const devices = await readDevices(dbPtr)
  const hypotheses = await readHypotheses(dbPtr)

  return {
    ...base,
    accounts,
    categories,
    tags,
    transactions,
    valuations,
    auditLog,
    deletedIds,
    savedPeriods,
    budgets,
    devices,
    hypotheses,
  }
}

type HashEntry = { hash: number; count: number }

// CS-39: linha-sentinela que grava o HASH_VERSION que produziu as demais linhas. Mora dentro da
// própria `table_hashes` (em vez de uma coluna nova) de propósito: sem DDL novo, `MAX_KNOWN_DB_VERSION`
// fica onde está e `scripts/sync_gimbo.py` não precisa de bump — a armadilha de "bumpar em três
// lugares" que o CLAUDE.md marca como recorrente. `table_name` é reservado e nunca colide com uma
// tabela real; `readTableHashes` o filtra.
const HASH_META_TABLE = '__meta'
const HASH_VERSION_KEY = 'hash_version'

async function readTableHashes(dbPtr: number): Promise<Map<string, HashEntry>> {
  const rows = await queryRows(
    dbPtr,
    'SELECT table_name, partition_key, hash_value, row_count FROM table_hashes WHERE table_name != ?',
    [HASH_META_TABLE]
  )
  const map = new Map<string, HashEntry>()
  for (const r of rows) {
    map.set(`${r.table_name as string}:${r.partition_key as string}`, {
      hash: r.hash_value as number,
      count: r.row_count as number,
    })
  }
  return map
}

/** Lê o HASH_VERSION que gravou as linhas atuais; null se a sentinela não existe (pré-CS-39). */
async function readStoredHashVersion(dbPtr: number): Promise<number | null> {
  const { rows } = await sqlite3.execWithParams(
    dbPtr,
    'SELECT hash_value FROM table_hashes WHERE table_name = ? AND partition_key = ?',
    [HASH_META_TABLE, HASH_VERSION_KEY]
  )
  const value: unknown = rows[0]?.[0]
  return typeof value === 'number' ? value : null
}

// Ausente de qualquer lado (peer pré-v16, ou local antes de qualquer escrita) = sempre diverge —
// nunca tratado como "igual" por omissão. É o mesmo comportamento seguro de hoje, só sem a
// otimização de pular a leitura.
function hashesMatch(
  peerHashes: Map<string, HashEntry>,
  localHashes: Map<string, HashEntry>,
  key: string
): boolean {
  const peer = peerHashes.get(key)
  const local = localHashes.get(key)
  if (!peer || !local) return false
  return peer.hash === local.hash && peer.count === local.count
}

// CS-30/CS-31/CS-32 Fase 2b: só usada pelo caminho de sync (readForeignDataFile), nunca por
// importDb() — comparar hashes antes de ler é uma otimização de leitura, não uma decisão que
// afete se um import é válido. `localHashes` vem de uma leitura do `db` local, feita pelo chamador
// dentro da mesma invocação enfileirada que processa o peer (nunca um snapshot anterior — a
// mesma disciplina do CS-24/CS-29 de nunca comparar contra estado desatualizado).
// CS-36: contagem de partições puladas vs. lidas, pra a próxima rodada de dado real dizer de
// forma inequívoca se o hash-skip da Fase 2b está de fato pulando algo ou se — pré-existente,
// primeiro sync de um par de dispositivos com estado divergente, hash colidindo por engano — o
// peer inteiro está sendo relido de qualquer forma. Sem isso, `worker.readPeer`/`sync.readPeerBlob`
// continuavam altos e não havia telemetria pra distinguir as duas causas (achado ao investigar o
// CS-34: "sem ganho de velocidade" tinha mais de uma explicação candidata e só uma tinha fix).
export type SelectiveReadStats = {
  tablesSkipped: number
  tablesTotal: number
  yearsSkipped: number
  yearsTotal: number
}

async function readDataFileFromDbSelective(
  dbPtr: number,
  localHashes: Map<string, HashEntry>
): Promise<{ data: RawDataFile; stats: SelectiveReadStats } | null> {
  const base = await readUserAndSettings(dbPtr)
  if (!base) return null

  const peerHashes = await readTableHashes(dbPtr)
  let tablesSkipped = 0
  const smallTables = [
    'accounts',
    'categories',
    'tags',
    'valuations',
    'saved_periods',
    'budgets',
    'audit_log',
    'deleted_ids',
    'devices',
    'hypotheses',
  ] as const
  const matches = (table: string) => {
    const skip = hashesMatch(peerHashes, localHashes, `${table}:`)
    if (skip) tablesSkipped++
    return skip
  }

  const accounts = matches('accounts') ? [] : await readAccounts(dbPtr)
  const categories = matches('categories') ? [] : await readCategories(dbPtr)
  const tags = matches('tags') ? [] : await readTags(dbPtr)
  const valuations = matches('valuations') ? [] : await readValuations(dbPtr)
  const savedPeriods = matches('saved_periods') ? [] : await readSavedPeriods(dbPtr)
  const budgets = matches('budgets') ? [] : await readBudgets(dbPtr)
  const auditLog = matches('audit_log') ? [] : await readAuditLog(dbPtr)
  const deletedIds = matches('deleted_ids') ? [] : await readDeletedIds(dbPtr)
  const devices = matches('devices') ? [] : await readDevices(dbPtr)
  const hypotheses = matches('hypotheses') ? [] : await readHypotheses(dbPtr)

  // Descobre os anos que o peer de fato tem (nunca lê um ano que só existe localmente — não há
  // nada pra buscar dele) e lê só os que divergirem do hash local.
  const yearRows = await queryRows(
    dbPtr,
    'SELECT DISTINCT substr(date, 1, 4) AS year FROM transactions'
  )
  const years = yearRows.map((r) => r.year as string)
  const divergingYears = years.filter(
    (year) => !hashesMatch(peerHashes, localHashes, `transactions:${year}`)
  )
  const transactions = await readTransactionsForYears(dbPtr, divergingYears)

  return {
    data: {
      ...base,
      accounts,
      categories,
      tags,
      transactions,
      valuations,
      auditLog,
      deletedIds,
      savedPeriods,
      budgets,
      devices,
      hypotheses,
    },
    stats: {
      tablesSkipped,
      tablesTotal: smallTables.length,
      yearsSkipped: years.length - divergingYears.length,
      yearsTotal: years.length,
    },
  }
}

// CS-30/CS-31/CS-32/CS-33 — achado ao validar a Fase 2b contra dado real: `table_hashes` é uma
// tabela nova (v16) e só é mantida *incrementalmente* — `applyTransactionDelta` só recomputa o
// hash dos anos que o delta de fato tocou. Um ano de histórico que nunca sofreu uma mutação
// diffada desde que esta feature existe **nunca ganha uma linha em `table_hashes`**, então
// `hashesMatch()` o vê como ausente dos dois lados e trata como "sempre diverge" — pra sempre,
// já que nada além de uma mutação naquele ano específico o preencheria. Resultado observado:
// nenhum ganho de velocidade (o histórico inteiro continua sendo lido a cada sync), com o custo
// extra da própria comparação de hash por cima. Correção: quando `table_hashes` está vazia (a
// checagem mais barata possível — uma tabela já backfilled nunca volta a ficar vazia), calcula o
// hash do estado *atual* inteiro de uma vez, do mesmo jeito que `replaceAll()`/`writeSmallTables()`
// já fariam se tivessem rodado depois do v16 existir. Custo de leitura completa, uma vez por
// banco (local no boot; peer/scratch antes de comparar) — depois disso, a manutenção incremental
// já existente mantém tudo em dia.
//
// CS-39 estende isto de "vazia?" para "vazia **ou** produzida por outro HASH_VERSION?". A checagem
// original (`COUNT(*) === 0`) não cobria o caso de o próprio esquema de hash mudar entre versões do
// app: as linhas continuavam lá, calculadas pelas funções antigas de `rowHash.ts`, e nada as
// recomputava exceto uma escrita naquela partição. Localmente isso só custava performance; com o
// transporte particionado, esses hashes viram um manifesto que outro dispositivo compara com o
// dele, então dois dispositivos em versões diferentes nunca convergiriam no hash-skip. Recomputar
// tudo uma vez por bump é barato e acontece no máximo uma vez por versão do app.
async function ensureTableHashesCurrent(dbPtr: number): Promise<void> {
  const { rows } = await sqlite3.execWithParams(dbPtr, 'SELECT COUNT(*) FROM table_hashes')
  const count = (rows[0]?.[0] ?? 0) as number
  const storedVersion = count > 0 ? await readStoredHashVersion(dbPtr) : null
  if (count > 0 && storedVersion === HASH_VERSION) return

  // Esquema de hash mudou (ou a sentinela é de antes do CS-39): as linhas existentes descrevem o
  // banco sob regras antigas e não são comparáveis com as novas — apagar e recomputar do zero.
  if (count > 0) await sqlite3.run(dbPtr, 'DELETE FROM table_hashes')

  const data = await readDataFileFromDb(dbPtr)
  if (!data) return
  const ts = data.settings.fileCreatedAt || new Date().toISOString()

  const upsert = (tableName: string, partitionKey: string, hash: number, rowCount: number) =>
    sqlite3.run(
      dbPtr,
      `INSERT INTO table_hashes (table_name, partition_key, hash_value, row_count) VALUES (?, ?, ?, ?)
       ON CONFLICT(table_name, partition_key) DO UPDATE SET hash_value = excluded.hash_value, row_count = excluded.row_count`,
      [tableName, partitionKey, hash, rowCount]
    )

  // Mesma normalização de updatedAt/createdAt que refreshSmallTableHashes/
  // refreshTransactionYearHashesFromMemory já fazem (CS-32) — sem ela, o backfill produziria um
  // hash que muda sozinho no próximo round-trip por loadDataFile(), mesmo achado daquele fix.
  await upsert(
    'accounts',
    '',
    combineHashes(
      data.accounts.map((a) => hashRow(accountRowKey({ ...a, updatedAt: a.updatedAt ?? ts })))
    ),
    data.accounts.length
  )
  await upsert(
    'categories',
    '',
    combineHashes(
      data.categories.map((c) => hashRow(categoryRowKey({ ...c, updatedAt: c.updatedAt ?? ts })))
    ),
    data.categories.length
  )
  await upsert(
    'tags',
    '',
    combineHashes(data.tags.map((t) => hashRow(tagRowKey({ ...t, updatedAt: t.updatedAt ?? ts })))),
    data.tags.length
  )
  await upsert(
    'budgets',
    '',
    combineHashes(
      data.budgets.map((b) => hashRow(budgetRowKey({ ...b, updatedAt: b.updatedAt ?? ts })))
    ),
    data.budgets.length
  )
  await upsert(
    'valuations',
    '',
    combineHashes(data.valuations.map((v) => hashRow(valuationRowKey(v)))),
    data.valuations.length
  )
  await upsert(
    'saved_periods',
    '',
    combineHashes(data.savedPeriods.map((p) => hashRow(savedPeriodRowKey(p)))),
    data.savedPeriods.length
  )
  await upsert(
    'audit_log',
    '',
    combineHashes(data.auditLog.map((e) => hashRow(auditEntryRowKey(e)))),
    data.auditLog.length
  )
  await upsert(
    'deleted_ids',
    '',
    combineHashes(data.deletedIds.map((id) => hashRow(deletedIdRowKey(id)))),
    data.deletedIds.length
  )
  await upsert(
    'devices',
    '',
    combineHashes(
      data.devices.map((d) => hashRow(deviceRowKey({ ...d, updatedAt: d.updatedAt ?? ts })))
    ),
    data.devices.length
  )
  await upsert(
    'hypotheses',
    '',
    combineHashes(
      data.hypotheses.map((h) => hashRow(hypothesisRowKey({ ...h, updatedAt: h.updatedAt ?? ts })))
    ),
    data.hypotheses.length
  )

  const byYear = new Map<string, RawTransaction[]>()
  for (const raw of data.transactions) {
    const tx: RawTransaction = {
      ...raw,
      updatedAt: raw.updatedAt ?? ts,
      createdAt: raw.createdAt ?? ts,
    }
    const year = tx.date.slice(0, 4)
    const list = byYear.get(year)
    if (list) list.push(tx)
    else byYear.set(year, [tx])
  }
  for (const [year, txs] of byYear) {
    await upsert(
      'transactions',
      year,
      combineHashes(txs.map((t) => hashRow(transactionRowKey(t)))),
      txs.length
    )
  }

  // CS-39: por último, e só depois de tudo ter sido recomputado com sucesso — se algo acima falhar
  // ou sair cedo, a sentinela não é escrita e o próximo boot tenta de novo, em vez de dar a tabela
  // por atualizada.
  await upsert(HASH_META_TABLE, HASH_VERSION_KEY, HASH_VERSION, 0)
}

// ─── CS-41: superfície de leitura por partição (transporte particionado) ──────

export type PartitionHashRow = { key: string; hash: number; count: number }

export type SyncManifestBase = {
  user: RawUser
  settings: RawSettings
  hashes: PartitionHashRow[]
}

/**
 * Tudo o que o publicador precisa para montar seu manifesto, numa **única task enfileirada**:
 * os singletons (que nunca são particionados) e o mapa de hashes por partição.
 *
 * Uma chamada só, e não duas, porque o par tem que descrever o mesmo instante do banco — separá-las
 * abriria uma janela para uma mutação landar no meio e publicar um manifesto cujo `fileUpdatedAt`
 * não corresponde aos hashes ao lado dele.
 */
async function readSyncManifestBase(): Promise<SyncManifestBase | null> {
  const base = await readUserAndSettings(db)
  if (!base) return null
  const hashes = await readTableHashes(db)
  return {
    user: base.user,
    settings: base.settings,
    hashes: [...hashes].map(([key, entry]) => ({ key, hash: entry.hash, count: entry.count })),
  }
}

/**
 * Lê as partições pedidas do cofre local, para publicação.
 *
 * **Sequencial, nunca `Promise.all` — CS-28.** Esta função roda *dentro* de uma task já retirada da
 * fila `enqueue()` do worker, chamando os leitores direto contra a instância wasm. O build
 * `wa-sqlite-async` é Asyncify e só suporta uma chamada em voo por vez; disparar várias em paralelo
 * corrompe o módulo inteiro de forma irrecuperável sem reload. `StorageService` pode usar
 * `Promise.all` porque lá cada chamada passa por postMessage e é serializada antes de chegar no
 * wasm — aqui não há mais nenhuma serialização abaixo.
 */
/**
 * Acima deste número de anos pedidos, ler `transactions` inteiro de uma vez sai mais barato que
 * montar um `WHERE date LIKE ? OR …` com um termo por ano — a leitura completa é uma query por
 * tabela, enquanto a filtrada ainda paga a busca em lote das junções por id.
 *
 * Medido contra dado real (2026-08-27, cofre de 26.577 transações): 23 partições lidas uma a uma
 * somavam ~13s no Chrome e ~9s no Firefox, contra ~2,5s de uma leitura completa. O ponto de virada
 * exato não foi medido; 4 é conservador e cobre com folga o caso comum (1-2 anos por sync).
 */
const FULL_TRANSACTION_READ_THRESHOLD = 4

async function readPartitions(keys: string[]): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}

  const years: string[] = []
  for (const key of keys) {
    const separator = key.indexOf(':')
    if (key.slice(0, separator === -1 ? undefined : separator) === 'transactions') {
      years.push(separator === -1 ? '' : key.slice(separator + 1))
    }
  }

  // Uma única leitura de `transactions` para *todos* os anos pedidos, agrupada por ano em JS —
  // antes era uma chamada por ano, cada uma com seu próprio SELECT, e todas serializadas pela fila
  // do worker (a paralelização do chamador não ajuda: a fila existe justamente para não haver duas
  // chamadas Asyncify em voo, CS-28). Era o gargalo do primeiro sync.
  const byYear = new Map<string, RawTransaction[]>()
  if (years.length > 0) {
    const rows = await readTransactionsForYears(
      db,
      years.length > FULL_TRANSACTION_READ_THRESHOLD ? null : years
    )
    for (const year of years) byYear.set(year, [])
    for (const tx of rows) {
      const bucket = byYear.get(tx.date.slice(0, 4))
      // Com a leitura completa vêm anos que ninguém pediu; descarta em vez de devolver a mais.
      if (bucket) bucket.push(tx)
    }
  }

  for (const key of keys) {
    const separator = key.indexOf(':')
    const table = separator === -1 ? key : key.slice(0, separator)
    const partition = separator === -1 ? '' : key.slice(separator + 1)

    switch (table) {
      case 'accounts':
        out[key] = await readAccounts(db)
        break
      case 'categories':
        out[key] = await readCategories(db)
        break
      case 'tags':
        out[key] = await readTags(db)
        break
      case 'valuations':
        out[key] = await readValuations(db)
        break
      case 'saved_periods':
        out[key] = await readSavedPeriods(db)
        break
      case 'budgets':
        out[key] = await readBudgets(db)
        break
      case 'audit_log':
        out[key] = await readAuditLog(db)
        break
      case 'deleted_ids':
        out[key] = await readDeletedIds(db)
        break
      case 'devices':
        out[key] = await readDevices(db)
        break
      case 'hypotheses':
        out[key] = await readHypotheses(db)
        break
      case 'transactions':
        out[key] = byYear.get(partition) ?? []
        break
      default:
        throw new Error(`[storage-worker] Unknown partition key: ${key}`)
    }
  }
  return out
}

type ReadPeerResult =
  | { ok: true; data: RawDataFile; stats: SelectiveReadStats }
  | { ok: false; reason: 'unreadable' | 'newer-schema' }

async function readForeignDataFile(buffer: ArrayBuffer): Promise<ReadPeerResult> {
  const root = await navigator.storage.getDirectory()
  const tempName = `peer-scratch-${crypto.randomUUID()}.db`

  const cleanup = async () => {
    for (const suffix of ['', '-wal', '-journal'] as const) {
      try {
        await root.removeEntry(tempName + suffix)
      } catch {
        // Best-effort — a missing suffix file is expected most of the time.
      }
    }
  }

  try {
    const fileHandle = await root.getFileHandle(tempName, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(buffer)
    await writable.close()
  } catch {
    return { ok: false, reason: 'unreadable' }
  }

  let tempDb: number
  try {
    tempDb = await openDbExclusive(tempName)
  } catch {
    await cleanup()
    return { ok: false, reason: 'unreadable' }
  }

  try {
    const { rows } = await sqlite3.execWithParams(tempDb, 'PRAGMA user_version')
    const version = (rows[0]?.[0] ?? 0) as number
    if (version > MAX_KNOWN_DB_VERSION) {
      await sqlite3.close(tempDb)
      await cleanup()
      return { ok: false, reason: 'newer-schema' }
    }

    await runMigrationsOn(tempDb)
    // O peer pode ser um upload de antes desta feature existir (ou de um dispositivo que ainda
    // não rodou o backfill do lado dele) — sem isso, `table_hashes` do peer viria vazia e toda
    // partição pareceria divergir pra sempre, mesmo quando o conteúdo é idêntico (ver o comentário
    // de `ensureTableHashesCurrent`). CS-39: também recomputa quando o peer foi gerado por um
    // HASH_VERSION diferente, que é o caso de um dispositivo numa versão mais antiga do app.
    await ensureTableHashesCurrent(tempDb)
    // CS-30/CS-31/CS-32 Fase 2b: lê o hash local *agora*, dentro desta mesma task enfileirada —
    // nunca um valor obtido antes do download/parse do peer, que poderia levar segundos a
    // minutos (mesma disciplina do CS-24/CS-29: comparar sempre contra o estado atual, não um
    // snapshot anterior a uma operação potencialmente longa).
    const localHashes = await readTableHashes(db)
    const selective = await readDataFileFromDbSelective(tempDb, localHashes)
    await sqlite3.close(tempDb)
    await cleanup()
    return selective
      ? { ok: true, data: selective.data, stats: selective.stats }
      : { ok: false, reason: 'unreadable' }
  } catch {
    try {
      await sqlite3.close(tempDb)
    } catch {
      // Already closed, or never fully opened — nothing further to release.
    }
    await cleanup()
    return { ok: false, reason: 'unreadable' }
  }
}

// ─── clearAll ─────────────────────────────────────────────────────────────────

async function clearAll(): Promise<void> {
  await sqlite3.run(db, 'BEGIN')
  try {
    await sqlite3.run(db, 'DELETE FROM transaction_tags')
    await sqlite3.run(db, 'DELETE FROM transaction_budgets')
    await sqlite3.run(db, 'DELETE FROM audit_log')
    await sqlite3.run(db, 'DELETE FROM deleted_ids')
    await sqlite3.run(db, 'DELETE FROM devices')
    await sqlite3.run(db, 'DELETE FROM transactions')
    await sqlite3.run(db, 'DELETE FROM valuations')
    await sqlite3.run(db, 'DELETE FROM saved_periods')
    await sqlite3.run(db, 'DELETE FROM budgets')
    await sqlite3.run(db, 'DELETE FROM hypothesis_items') // FK cascade never fires, see writeSmallTables
    await sqlite3.run(db, 'DELETE FROM hypotheses')
    await sqlite3.run(db, 'DELETE FROM categories')
    await sqlite3.run(db, 'DELETE FROM tags')
    await sqlite3.run(db, 'DELETE FROM accounts')
    await sqlite3.run(db, 'DELETE FROM settings')
    await sqlite3.run(db, 'DELETE FROM users')
    await sqlite3.run(db, 'COMMIT')
  } catch (err) {
    try {
      await sqlite3.run(db, 'ROLLBACK')
    } catch {
      // Ignore rollback errors
    }
    throw err
  }
}

/**
 * SEC-06 — resgate: lê os bytes crus de `gimbo.db` direto do OPFS.
 *
 * Existe para o cenário em que o app não inicializa: schema de uma versão futura, migration que
 * não aplica, arquivo corrompido. Antes disso, um boot quebrado deixava o cofre trancado no OPFS
 * sem nenhuma superfície para tirá-lo de lá.
 *
 * Por isso não depende de nada que o `init()` produz — nem do ponteiro `db`, nem do `sqlite3` —
 * e é despachada **fora da fila** (ver o message handler abaixo): `_queue` encadeia a partir do
 * `initPromise`, então um init rejeitado envenena a fila justamente quando o resgate é necessário.
 *
 * Ressalva: sem o SQLite disponível não dá para consolidar o WAL, então o arquivo pode não conter
 * as últimas transações se elas ainda estiverem só no `-wal`. Quando o banco está saudável faz-se
 * o checkpoint antes de ler; quando não está, os bytes crus são o melhor disponível — e muito
 * melhor do que nada.
 */
async function exportRawBytes(): Promise<ArrayBuffer> {
  if (dbReady) {
    try {
      await sqlite3.run(db, 'PRAGMA wal_checkpoint(FULL)')
    } catch {
      // Best-effort: se o checkpoint falhar, seguimos com os bytes que houver em disco.
    }
  }
  const root = await navigator.storage.getDirectory()
  return readFileBytes(root, DB_FILENAME)
}

// ─── HY/Fase 0 — benchmark de colunas ─────────────────────────────────────────

/**
 * Roda o A/B de `lib/storage/columnBench.ts` contra o cofre local e devolve **só números** — nunca
 * as linhas, que num cofre real são dezenas de MB e transformariam a medição no seu próprio
 * gargalo (o `postMessage` de volta).
 *
 * Mede aqui dentro, e não na thread principal, porque é aqui que o custo está: o `M-91` atribuiu
 * ~95% do `loadDataFile` ao SQLite materializando linha, ~4% ao `postMessage` e ~5% à montagem de
 * objeto do outro lado. A ida e volta completa é medida separadamente pelo `StorageService`.
 *
 * Segura a fila do worker por vários minutos num cofre grande — é uma ferramenta de medição
 * deliberada, disparada à mão por `?bench`, nunca por caminho de produto.
 */
async function benchColumns(rounds: number): Promise<{
  rows: number
  yearSpan: [number, number]
  samples: BenchSample[]
}> {
  // Busca de índice, não varredura — o intervalo de anos define as fatias das variantes em lotes.
  const { rows: spanRows } = await sqlite3.execWithParams(
    db,
    'SELECT MIN(date), MAX(date) FROM transactions'
  )
  const minDate = (spanRows[0]?.[0] as string | null) ?? `${new Date().getFullYear()}-01-01`
  const maxDate = (spanRows[0]?.[1] as string | null) ?? minDate
  const yearSpan: [number, number] = [Number(minDate.slice(0, 4)), Number(maxDate.slice(0, 4))]

  const variants = benchVariants(new Date().getFullYear(), yearSpan[0], yearSpan[1])
  const collected = new Map<string, number[]>()
  const rowCount = new Map<string, number>()

  const runVariant = async (variant: BenchVariant): Promise<{ ms: number; rows: number }> => {
    const startedAt = performance.now()
    let total = 0
    for (const step of variant.steps) {
      const { rows } = await sqlite3.execWithParams(db, step.sql, step.params)
      total += rows.length
    }
    return { ms: performance.now() - startedAt, rows: total }
  }

  // Aquecimento descartado: a primeira leitura de cada consulta paga o cache de página do OPFS.
  for (const variant of variants) await runVariant(variant)

  for (let round = 0; round < rounds; round++) {
    for (const variant of permute(variants, round)) {
      // Uma pausa curta entre variantes. Não força coleta de lixo — nada em JS força —, mas dá ao
      // runtime a janela ociosa em que ele recolhe o resultado anterior, em vez de cobrá-la da
      // próxima consulta. É a mesma contaminação que a permutação acima ataca, por outro lado.
      await new Promise((resolve) => setTimeout(resolve, 150))
      const { ms, rows } = await runVariant(variant)
      const list = collected.get(variant.name)
      if (list) list.push(ms)
      else collected.set(variant.name, [ms])
      rowCount.set(variant.name, rows)
    }
  }

  const samples: BenchSample[] = variants.map((variant) => {
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

  // O ajuste de custo e o teste de linearidade ficam do lado do `StorageService`, que é quem tem as
  // duas metades (worker e ida-e-volta) para relatar juntas.
  return { rows: samples.find((s) => s.name === 'all20')?.rows ?? 0, yearSpan, samples }
}

/**
 * HY-16 — mede o custo por **página lida**, isolando-o do custo por linha.
 *
 * Roda sempre sobre uma **cópia** do cofre num arquivo de rascunho (a mesma mecânica de
 * `readForeignDataFile`), nunca sobre o `db` real: uma das variantes precisa rodar `VACUUM` para
 * reescrever o banco com páginas de 64KB, e isso jamais deve tocar o cofre do usuário a partir de
 * uma ferramenta de medição.
 *
 * Três entradas, e a comparação entre elas responde uma pergunta cada:
 * - `p4096` — controle: o cofre como está hoje. `coldMs` é o que o boot paga.
 * - `p4096+cache` — mesmo banco, cache grande o bastante para tudo. `warmMs` sem páginas para ler
 *   isola o custo puro de materializar linha; a diferença para `coldMs` é a conta das páginas.
 * - `p65536` — o mesmo conteúdo com 16x menos páginas. Se o gargalo é a travessia por página, é
 *   aqui que ele desaparece.
 */
/**
 * Executa `body` contra uma **cópia** do cofre num arquivo de rascunho, e apaga tudo no fim.
 *
 * Compartilhado pelas duas ferramentas de medição de página. Nada aqui toca o `db` real: uma das
 * variantes roda `VACUUM` para reescrever o banco, e uma ferramenta de medição jamais deve fazer
 * isso no cofre do usuário.
 *
 * `prepare` roda antes de um fecha-e-reabre e vale para o que fica **no arquivo** (`page_size` +
 * `VACUUM`); `body` recebe uma conexão nova, de cache vazio — a condição do boot. Confundir os dois
 * momentos faz uma variante de cache medir o cache padrão, porque `cache_size` é por conexão.
 */
async function withScratchDb<T>(
  bytes: ArrayBuffer,
  prepare: (dbPtr: number) => Promise<void>,
  body: (dbPtr: number, name: string) => Promise<T>
): Promise<T> {
  const root = await navigator.storage.getDirectory()
  const name = `bench-scratch-${crypto.randomUUID()}.db`
  const cleanup = async () => {
    for (const suffix of ['', '-wal', '-journal'] as const) {
      try {
        await root.removeEntry(name + suffix)
      } catch {
        // Best-effort — o sufixo pode nem existir.
      }
    }
  }

  const fileHandle = await root.getFileHandle(name, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(bytes)
  await writable.close()

  try {
    const prepared = await sqlite3.open_v2(name)
    try {
      // O cofre exportado vem em formato WAL, que esta VFS não abre em bloqueio normal. Normaliza
      // toda cópia para rollback aqui, para a conexão que mede poder escolher livremente o seu
      // modo — inclusive `normal`, que é justamente o controle da medição.
      // `execWithParams` e não `run`: estes pragmas devolvem linha, e converter WAL→rollback com
      // a linha por drenar deixa o statement sem finalizar — o `close` seguinte falha com
      // "unable to close due to unfinalized statements".
      await sqlite3.execWithParams(prepared, 'PRAGMA locking_mode=EXCLUSIVE')
      await sqlite3.execWithParams(prepared, 'PRAGMA journal_mode=DELETE')
      await prepare(prepared)
    } finally {
      await sqlite3.close(prepared)
    }

    const reopened = await sqlite3.open_v2(name)
    try {
      return await body(reopened, name)
    } finally {
      await sqlite3.close(reopened)
    }
  } finally {
    await cleanup()
  }
}

async function benchScalar(dbPtr: number, sql: string): Promise<number> {
  const { rows } = await sqlite3.execWithParams(dbPtr, sql)
  return (rows[0]?.[0] as number | null) ?? 0
}

async function benchTimedRead(
  dbPtr: number,
  sql: string,
  params?: SQLiteCompatibleType[]
): Promise<{ ms: number; rows: number }> {
  const startedAt = performance.now()
  const { rows } = await sqlite3.execWithParams(dbPtr, sql, params)
  return { ms: performance.now() - startedAt, rows: rows.length }
}

/**
 * HY-16 — mede o custo por **página lida**, isolando-o do custo por linha.
 *
 * - `p4096` — controle: o cofre como está hoje. `coldMs` é o que o boot paga.
 * - `p4096+cache` — mesmo banco, cache grande o bastante para tudo. `warmMs` sem páginas para ler
 *   isola o custo puro de materializar linha; a diferença para `coldMs` é a conta das páginas.
 * - `p65536` — o mesmo conteúdo com 16x menos páginas.
 */
async function benchPageSize(): Promise<PageSizeBenchResult> {
  const bytes = await exportDb()
  const entries: PageSizeBenchEntry[] = []
  let vacuumMs = 0

  const measure = async (
    label: string,
    prepare: (dbPtr: number) => Promise<void>,
    configure?: (dbPtr: number) => Promise<void>
  ): Promise<void> => {
    const entry = await withScratchDb(bytes, prepare, async (dbPtr) => {
      // Antes da leitura fria: o cache continua vazio, só maior.
      if (configure) await configure(dbPtr)
      const pageSize = await benchScalar(dbPtr, 'PRAGMA page_size')
      const pageCount = await benchScalar(dbPtr, 'PRAGMA page_count')
      const cacheSizeKb = -(await benchScalar(dbPtr, 'PRAGMA cache_size'))
      const cold = await benchTimedRead(dbPtr, PAGE_BENCH_READ)
      const warm = await benchTimedRead(dbPtr, PAGE_BENCH_READ)
      return {
        label,
        pageSize,
        pageCount,
        cacheSizeKb,
        coldMs: cold.ms,
        warmMs: warm.ms,
        rows: cold.rows,
      } satisfies PageSizeBenchEntry
    })
    entries.push(entry)
  }

  await measure('p4096', async () => {
    // Controle: nada a preparar — é o cofre exatamente como está hoje.
  })

  await measure(
    'p4096+cache',
    async () => {
      // Nada muda no arquivo — só na conexão que mede.
    },
    async (dbPtr) => {
      await sqlite3.run(dbPtr, 'PRAGMA cache_size = -65536')
    }
  )

  await measure('p65536', async (dbPtr) => {
    const startedAt = performance.now()
    await sqlite3.run(dbPtr, 'PRAGMA page_size = 65536')
    await sqlite3.run(dbPtr, 'VACUUM')
    vacuumMs = performance.now() - startedAt
  })

  return { entries, vacuumMs }
}

/**
 * HY-17 — o outro lado da moeda do `HY-16`: quanto a escrita piora com página maior.
 *
 * Varre 4 tamanhos porque a decisão provavelmente não é binária. Todas as cópias passam por
 * `VACUUM`, inclusive a de 4KB, para que a única diferença entre elas seja o tamanho da página e
 * não o grau de fragmentação.
 */
async function benchWrite(rounds: number): Promise<WriteBenchResult> {
  const bytes = await exportDb()
  const entries: WriteBenchEntry[] = []

  for (const variant of WRITE_BENCH_VARIANTS) {
    let vacuumMs = 0
    const entry = await withScratchDb(
      bytes,
      async (dbPtr) => {
        if (!variant.vacuum) return
        const startedAt = performance.now()
        // `page_size` não muda por `VACUUM` com o banco em WAL — silenciosamente. Por isso o
        // journal mode só é escolhido depois, na conexão que mede.
        await sqlite3.run(dbPtr, `PRAGMA page_size = ${variant.pageSize}`)
        await sqlite3.run(dbPtr, 'VACUUM')
        vacuumMs = performance.now() - startedAt
      },
      async (dbPtr, name) => {
        // Sem `locking_mode=EXCLUSIVE` o WAL não pega nesta VFS (sem `xShmMap`), e o SQLite
        // devolve o modo atual sem erro — foi assim que o `journal_mode=WAL` do `init()` passou
        // despercebido por tanto tempo. Lê de volta o modo efetivo em vez de assumir o pedido.
        const lockingMode = variant.wal ? 'exclusive' : 'normal'
        await sqlite3.run(dbPtr, `PRAGMA locking_mode = ${lockingMode}`)
        if (variant.wal) await sqlite3.run(dbPtr, 'PRAGMA journal_mode = WAL')
        const { rows: modeRows } = await sqlite3.execWithParams(dbPtr, 'PRAGMA journal_mode')
        const journalMode = String(modeRows[0]?.[0] ?? 'unknown')
        const pageSize = await benchScalar(dbPtr, 'PRAGMA page_size')
        const pageCount = await benchScalar(dbPtr, 'PRAGMA page_count')

        const cold = await benchTimedRead(dbPtr, PAGE_BENCH_READ)

        // Ids espalhados por todos os anos, colhidos pelo índice de data — updates concentrados
        // numa página só mediriam o melhor caso e não a forma de um merge de sync.
        const { rows: spanRows } = await sqlite3.execWithParams(
          dbPtr,
          'SELECT MIN(date), MAX(date) FROM transactions'
        )
        const minYear = Number(String(spanRows[0]?.[0] ?? '2026-01-01').slice(0, 4))
        const maxYear = Number(String(spanRows[0]?.[1] ?? '2026-01-01').slice(0, 4))
        const ids: string[] = []
        for (let year = minYear; year <= maxYear; year++) {
          const { rows } = await sqlite3.execWithParams(
            dbPtr,
            'SELECT id FROM transactions WHERE date >= ? AND date < ? LIMIT 10',
            yearRange(String(year))
          )
          for (const row of rows) ids.push(row[0] as string)
        }

        // A releitura de um ano que toda mutação paga depois de gravar (CS-32).
        const rehash = await benchTimedRead(
          dbPtr,
          'SELECT * FROM transactions WHERE date >= ? AND date < ?',
          yearRange(String(maxYear))
        )

        const stamp = new Date().toISOString()
        const updateIds = async (batch: string[]): Promise<number> => {
          const startedAt = performance.now()
          await sqlite3.run(dbPtr, 'BEGIN')
          for (const id of batch) {
            await sqlite3.run(dbPtr, 'UPDATE transactions SET updated_at = ? WHERE id = ?', [
              stamp,
              id,
            ])
          }
          await sqlite3.run(dbPtr, 'COMMIT')
          return performance.now() - startedAt
        }

        const singles: number[] = []
        for (let round = 0; round < rounds; round++) {
          const id = ids[round % ids.length]
          if (id !== undefined) singles.push(await updateIds([id]))
        }

        // Lotes disjuntos enquanto houver id para isso — repetir o mesmo lote mediria páginas já
        // sujas e já em cache, que é o melhor caso, não o caso.
        const batchSize = Math.min(50, ids.length)
        const batches: number[] = []
        for (let batch = 0; batch < 3 && batchSize > 0; batch++) {
          const offset = (batch * batchSize) % ids.length
          const slice = [...ids.slice(offset), ...ids.slice(0, offset)].slice(0, batchSize)
          batches.push(await updateIds(slice))
        }

        // Antes do checkpoint, que trunca o WAL: é o tamanho dele que mede a amplificação. Em
        // `delete` não existe `-wal`; o campo `journalMode` explica o zero.
        let walBytes = 0
        try {
          const root = await navigator.storage.getDirectory()
          const walHandle = await root.getFileHandle(`${name}-wal`)
          walBytes = (await walHandle.getFile()).size
        } catch {
          // Sem arquivo de WAL — 0 é a resposta honesta.
        }

        const checkpointStart = performance.now()
        await sqlite3.run(dbPtr, 'PRAGMA wal_checkpoint(FULL)')
        const checkpointMs = performance.now() - checkpointStart

        return {
          label: variant.label,
          vacuumed: variant.vacuum,
          pageSize,
          pageCount,
          journalMode,
          lockingMode,
          vacuumMs,
          coldReadMs: cold.ms,
          yearRehashMs: rehash.ms,
          update1Ms: median(singles),
          update50Ms: median(batches),
          walBytes,
          checkpointMs,
        } satisfies WriteBenchEntry
      }
    )
    entries.push(entry)
  }

  return { rounds, entries }
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * HY-21 — fecha o banco e larga tudo que ele segura: o `SyncAccessHandle` do OPFS e o lock interno
 * da VFS. É o que permite a outra aba assumir o cofre; sem isto, ceder a posse no nível do app
 * deixaria o arquivo preso mesmo assim.
 *
 * `db` vai a 0 para que qualquer chamada posterior falhe alto em vez de usar um ponteiro morto — a
 * aba que cedeu a posse não deve continuar operando, ela mostra a tela de "aberto em outra aba".
 */
async function closeDb(): Promise<void> {
  if (db === 0) return
  const closing = db
  db = 0
  await sqlite3.close(closing)
}

async function dispatch(method: string, args: unknown[]): Promise<unknown> {
  if (db === 0 && method !== 'close') {
    throw new Error('[storage-worker] cofre fechado: outra aba assumiu o controle')
  }
  switch (method) {
    // M-87: no-op cuja única função é resolver depois do `init()` — a fila encadeia a partir dele,
    // então a duração desta chamada, medida na thread principal, é o tempo de partida do storage.
    case 'ready':
      return undefined
    case 'query':
      return sqlite3.execWithParams(
        db,
        args[0] as string,
        args[1] as SQLiteCompatibleType[] | undefined
      )
    case 'run':
      return sqlite3.run(db, args[0] as string, args[1] as SQLiteCompatibleType[] | undefined)
    case 'export':
      return exportDb()
    case 'import':
      return importDb(args[0] as ArrayBuffer)
    case 'replaceAll':
      return replaceAll(args[0])
    case 'applyMutation':
      return applyMutation(args[0], args[1])
    case 'clearAll':
      return clearAll()
    case 'close':
      return closeDb()
    case 'readPeer':
      return readForeignDataFile(args[0] as ArrayBuffer)
    case 'syncManifestBase':
      return readSyncManifestBase()
    case 'readPartitions':
      return readPartitions(args[0] as string[])
    // HY/Fase 0 — ferramenta de medição, disparada só por `?bench` (ver services/storage/index.ts)
    case 'benchColumns':
      return benchColumns(args[0] as number)
    case 'benchPageSize':
      return benchPageSize()
    case 'benchWrite':
      return benchWrite(args[0] as number)
    default:
      throw new Error(`[storage-worker] Unknown method: ${method}`)
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

const initPromise = init()

// Sequential operation queue — ensures mutations don't interleave across awaits.
// Each incoming message is appended to the tail of the chain so that dispatch
// calls execute one at a time, preserving SQLite write ordering.
let _queue: Promise<void> = initPromise.then(() => undefined)

function enqueue(fn: () => Promise<unknown>): Promise<unknown> {
  const task = _queue.then(fn)
  // Advance the queue tail; swallow errors so a failed task doesn't stall the queue.
  _queue = task.then(
    () => undefined,
    () => undefined
  )
  return task
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const { id, method, args } = event.data
  const startedAt = import.meta.env.DEV ? performance.now() : 0

  // SEC-06: o resgate contorna a fila de propósito. `_queue` encadeia a partir do `initPromise`,
  // então um `init()` rejeitado — o exato cenário em que o resgate é chamado — faria a tarefa
  // nunca rodar. Também não toca em `sqlite3`/`db` quando o init não completou.
  if (method === 'exportRawBytes') {
    void exportRawBytes()
      .then((result) => self.postMessage({ id, result } satisfies WorkerResponse, [result]))
      .catch((err: unknown) => {
        self.postMessage({ id, error: String(err) } satisfies WorkerResponse)
      })
    return
  }

  void enqueue(() => dispatch(method, args))
    .then((result) => {
      const msg: WorkerResponse = { id, result }
      if (import.meta.env.DEV) {
        // Diferencia queries dentro de 'query'/'run' pelo início do SQL — sem isso, todo SELECT
        // vira o mesmo rótulo genérico 'worker.query' e não dá pra saber qual statement é lento.
        const sql = args[0]
        const sqlHint =
          (method === 'query' || method === 'run') && typeof sql === 'string'
            ? `:${sql.trim().slice(0, 60).replace(/\s+/g, ' ')}`
            : ''
        msg.perf = { metric: `worker.${method}${sqlHint}`, ms: performance.now() - startedAt }
      }
      if (result instanceof ArrayBuffer) {
        // Transfer ownership to avoid a costly copy across the worker boundary.
        self.postMessage(msg, [result])
      } else {
        self.postMessage(msg)
      }
    })
    .catch((err: unknown) => {
      self.postMessage({ id, error: String(err) } satisfies WorkerResponse)
    })
})
