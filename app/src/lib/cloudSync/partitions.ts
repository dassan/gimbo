// CS-40 — camada pura do transporte particionado de sync (Fase 3 do épico CS).
//
// Contexto: `CS-30`/`CS-35` resolveram o custo de *escrever* o merge localmente, e
// `CS-32`/`CS-33`/`CS-36` o de *ler/parsear* o `.db` do peer já baixado. Nenhuma das duas toca o
// custo de **transferir** o `gimbo.db` inteiro (~14MB) a cada sync — nem no pull, nem no push (que
// hoje roda a cada mutação debounced, via `_triggerLocalBackup`). Este módulo é o vocabulário
// comum para publicar/consumir o cofre em partições pequenas, decidindo pela rede o que já se
// conhece antes de baixar.
//
// Deliberadamente **puro**: nada de rede, storage ou telemetria. Quem orquestra
// (`driveTreeSyncService.ts`) mede e faz I/O; aqui só há decisão e codificação, o que torna o
// grosso da lógica testável sem mock nenhum.
//
// Formato: JSON gzipado, não `.db` por partição. Um `.db` carregaria o DDL completo do schema em
// *cada* arquivo, exigiria um mecanismo de export de subconjunto que não existe no código, e
// forçaria N aberturas de wa-sqlite (serializadas pela fila Asyncify do worker) para ler o peer.
// Com JSON o peer é reconstruído inteiramente na main thread, sem tocar o worker.

import type { DataFile, Settings, User } from '@/types'
import {
  CURRENT_SCHEMA_VERSION,
  ManifestBaseSchema,
  PARTITION_SCHEMAS,
  SchemaVersionError,
  migrateDataFile,
} from '@/lib/storage/schema'
import {
  HASH_VERSION,
  accountRowKey,
  auditEntryRowKey,
  budgetRowKey,
  categoryRowKey,
  combineHashes,
  deletedIdRowKey,
  deviceRowKey,
  hashRow,
  hypothesisRowKey,
  savedPeriodRowKey,
  tagRowKey,
  transactionRowKey,
  valuationRowKey,
} from '@/lib/storage/rowHash'

/**
 * Versão do *layout remoto* (nomes de arquivo, forma do manifesto) — independente de
 * `HASH_VERSION` (o esquema de hash) e de `CURRENT_SCHEMA_VERSION` (a forma do `DataFile`).
 * Um peer com `formatVersion` maior é pulado, como já se faz com schema mais novo (S-20).
 */
export const PARTITION_FORMAT_VERSION = 1

/** Tabelas hasheadas por inteiro (`partition_key = ''`), espelhando `table_hashes` do CS-32. */
export const SMALL_TABLES = [
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

export type SmallTable = (typeof SMALL_TABLES)[number]
export type PartitionTable = SmallTable | 'transactions'

/** `${table}:${partitionKey}` — idêntico à chave do mapa de `readTableHashes` (worker.ts). */
export type PartitionKey = string

export interface HashEntry {
  hash: number
  count: number
}

export interface PartitionEntry extends HashEntry {
  /** Nome do arquivo na árvore do dispositivo; a extensão determina o codec. */
  file: string
  /** Id do arquivo no Drive, para o leitor baixar direto sem listar a pasta do peer. */
  fileId?: string
}

export interface SyncManifest {
  formatVersion: number
  hashVersion: number
  schemaVersion: number
  deviceId: string
  publishedAt: string
  // Singletons: nunca particionados, e `settings.fileUpdatedAt` é load-bearing no merge
  // (`merge.ts` faz maxIso entre local e remoto). `user` nunca é lido pelo merge — viaja só para o
  // objeto do peer ser válido sozinho, sem precisar emprestar estado local.
  user: User
  settings: Settings
  partitions: Record<PartitionKey, PartitionEntry>
}

// ─── Chaves e nomes de arquivo ────────────────────────────────────────────────

export function partitionKey(table: PartitionTable, partition = ''): PartitionKey {
  return `${table}:${partition}`
}

export function parsePartitionKey(key: PartitionKey): { table: string; partition: string } {
  const index = key.indexOf(':')
  if (index === -1) throw new Error(`partitions: malformed key ${JSON.stringify(key)}`)
  return { table: key.slice(0, index), partition: key.slice(index + 1) }
}

/**
 * Base do nome do arquivo, sem extensão. Injetivo por construção: `transactions` é a única tabela
 * particionada, e sua partição é sempre um ano de 4 dígitos, então `transactions-2026` nunca colide
 * com o nome de uma tabela pequena (nenhuma contém `-` seguido de dígitos). A validação abaixo é o
 * que mantém isso verdadeiro se alguém particionar outra tabela no futuro.
 */
function partitionFileBase(key: PartitionKey): string {
  const { table, partition } = parsePartitionKey(key)
  if (!partition) return table
  if (table !== 'transactions' || !/^\d{4}$/.test(partition)) {
    throw new Error(`partitions: unsupported partitioned key ${JSON.stringify(key)}`)
  }
  return `${table}-${partition}`
}

export function partitionFileName(key: PartitionKey, gzip = true): string {
  return `${partitionFileBase(key)}${gzip ? '.json.gz' : '.json'}`
}

export function partitionKeyFromFileName(file: string): PartitionKey | null {
  const base = file.replace(/\.json(\.gz)?$/, '')
  if (base === file) return null // sem extensão reconhecida
  const yearMatch = /^transactions-(\d{4})$/.exec(base)
  if (yearMatch) return partitionKey('transactions', yearMatch[1])
  if ((SMALL_TABLES as readonly string[]).includes(base)) return partitionKey(base as SmallTable)
  return null
}

// ─── Decisão: o que baixar, o que publicar ────────────────────────────────────

export interface FetchPlan {
  /** Partições do peer que divergem do local e precisam ser baixadas. */
  keys: PartitionKey[]
  skipped: number
  total: number
  /** Peer usa outro esquema de hash — nada é comparável, tudo é buscado. */
  hashVersionMismatch: boolean
}

/**
 * Mesma regra do `hashesMatch()` do worker: ausente de qualquer lado = diverge, nunca "igual por
 * omissão".
 *
 * **Itera as chaves do manifesto, nunca as locais.** Uma chave local ausente do manifesto significa
 * "o peer não tem nada ali" — contribui nada para o merge, então não há o que buscar. Isso importa
 * na prática porque `table_hashes` acumula entradas `{hash:0,count:0}` de anos que esvaziaram
 * (`upsertTransactionYearHash`, worker.ts), e tratá-las como divergentes faria buscar arquivos que
 * o peer nem publicou.
 *
 * Por que pular é seguro mesmo com mutação local concorrente: hash e contagem iguais implicam
 * multiconjunto de linhas idêntico **incluindo `updatedAt`** (garantido pelo teste-guarda de
 * `rowHash.test.ts`). Uma linha do peer omitida ou é idêntica à local — e o `unionByIdLWW` usa `>`
 * estrito, então a local é mantida — ou perdeu para uma edição local mais nova, que carimba
 * `updatedAt` maior. Em nenhum caso a omissão muda a saída do merge. A garantia é essa
 * monotonicidade, não o frescor do snapshot de hash.
 */
export function planFetch(
  manifest: SyncManifest,
  localHashes: Map<PartitionKey, HashEntry>
): FetchPlan {
  const hashVersionMismatch = manifest.hashVersion !== HASH_VERSION
  const entries = Object.entries(manifest.partitions)
  const keys: PartitionKey[] = []

  for (const [key, entry] of entries) {
    if (entry.count === 0) continue // partição vazia do peer: nada a contribuir
    if (hashVersionMismatch) {
      keys.push(key)
      continue
    }
    const local = localHashes.get(key)
    if (!local || local.hash !== entry.hash || local.count !== entry.count) keys.push(key)
  }

  const considered = entries.filter(([, e]) => e.count > 0).length
  return { keys, skipped: considered - keys.length, total: considered, hashVersionMismatch }
}

/**
 * O que este dispositivo precisa (re)publicar. `lastPublished` é **cache reconstruível**, não
 * estado autoritativo: se sumir (o Safari despeja localStorage depois de ~7 dias de PWA inativa,
 * enquanto o OPFS — e portanto o `deviceId` — sobrevive), o chamador rebaixa o próprio manifesto
 * remoto para reconstruí-lo, em vez de republicar a árvore inteira.
 *
 * `remoteFiles` é a lista de nomes que de fato existem na pasta deste dispositivo, e serve de
 * auto-cura: um arquivo que sumiu do Drive é republicado mesmo com o hash "batendo" no cache.
 * A guarda `count > 0` é obrigatória aí — sem ela, uma partição vazia (que nunca é publicada)
 * apareceria como "faltando" para sempre, num laço infinito de re-upload.
 */
export function planPublish(
  localHashes: Map<PartitionKey, HashEntry>,
  lastPublished: Record<PartitionKey, HashEntry>,
  remoteFiles: ReadonlySet<string>
): PartitionKey[] {
  const keys: PartitionKey[] = []
  for (const [key, entry] of localHashes) {
    if (entry.count === 0) continue // partição vazia nunca é publicada
    const published = lastPublished[key]
    const changed = !published || published.hash !== entry.hash || published.count !== entry.count
    const missingRemotely = !remoteFiles.has(partitionFileName(key))
    if (changed || missingRemotely) keys.push(key)
  }
  return keys
}

// ─── Codec ────────────────────────────────────────────────────────────────────

function hasCompressionStream(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'
}

/**
 * Serializa uma partição. Cai para JSON sem compressão quando `CompressionStream` não existe — com
 * o corte seco do layout remoto, uma API ausente significaria sync simplesmente quebrado, e o
 * receptor deriva o codec da extensão, então os dois lados não precisam concordar de antemão.
 */
export async function encodePartition(
  rows: unknown[]
): Promise<{ bytes: Uint8Array; gzip: boolean }> {
  const json = new TextEncoder().encode(JSON.stringify(rows))
  if (!hasCompressionStream()) return { bytes: json, gzip: false }
  return { bytes: await pipeThroughBytes(json, new CompressionStream('gzip')), gzip: true }
}

/** MIME correspondente, para o upload. */
export function partitionMimeType(gzip: boolean): string {
  return gzip ? 'application/gzip' : 'application/json'
}

/** Contraparte de `encodePartition`; o codec vem da extensão do nome do arquivo. */
export async function decodePartition(bytes: ArrayBuffer, file: string): Promise<unknown[]> {
  const raw = file.endsWith('.gz')
    ? await pipeThroughBytes(new Uint8Array(bytes), new DecompressionStream('gzip'))
    : new Uint8Array(bytes)
  const parsed: unknown = JSON.parse(new TextDecoder().decode(raw))
  if (!Array.isArray(parsed)) throw new Error(`partitions: ${file} is not a JSON array`)
  return parsed as unknown[]
}

/**
 * Passa bytes por um TransformStream e coleta o resultado.
 *
 * Escrito com `ReadableStream` + leitor manual em vez de `new Blob([b]).stream()` ou
 * `new Response(s).arrayBuffer()` de propósito: os dois faltam (ou variam) no jsdom, e este é o
 * único trecho do módulo que dependeria de API de plataforma além de `CompressionStream` — sem
 * isto, o codec só seria testável em e2e.
 */
async function pipeThroughBytes(
  // Uint8Array<ArrayBuffer>, não Uint8Array: desde o TS 5.7 os typed arrays são genéricos sobre o
  // buffer, e o BufferSource que os streams aceitam exclui SharedArrayBuffer.
  input: Uint8Array<ArrayBuffer>,
  // O par exato de CompressionStream/DecompressionStream: aceitam BufferSource na escrita e
  // emitem Uint8Array na leitura — não é um TransformStream<Uint8Array, Uint8Array> simétrico.
  transform: ReadableWritablePair<Uint8Array, BufferSource>
): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(input)
      controller.close()
    },
  })

  const reader = source.pipeThrough(transform).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

// ─── Integridade ──────────────────────────────────────────────────────────────

type RowKeyFn = (row: never) => string

const ROW_KEY_BY_TABLE: Record<PartitionTable, RowKeyFn> = {
  accounts: accountRowKey as RowKeyFn,
  categories: categoryRowKey as RowKeyFn,
  tags: tagRowKey as RowKeyFn,
  valuations: valuationRowKey as RowKeyFn,
  saved_periods: savedPeriodRowKey as RowKeyFn,
  budgets: budgetRowKey as RowKeyFn,
  audit_log: auditEntryRowKey as RowKeyFn,
  deleted_ids: deletedIdRowKey as RowKeyFn,
  devices: deviceRowKey as RowKeyFn,
  hypotheses: hypothesisRowKey as RowKeyFn,
  transactions: transactionRowKey as RowKeyFn,
}

/**
 * Recomputa o hash das linhas baixadas e compara com o que o manifesto prometeu. Valida a cadeia
 * inteira de uma vez: manifesto ↔ bytes do arquivo ↔ implementação de `rowHash` ↔ acordo de
 * `HASH_VERSION` ↔ a normalização `updatedAt ?? ts` do CS-32.
 *
 * **Nunca bloqueia o merge.** Devolve o veredito para o chamador emitir telemetria; o merge é
 * LWW-seguro independente do que o hash diga, e deixar um checksum de camada de otimização
 * descartar dado real seria trocar um problema de performance por um de perda de dado.
 */
export function verifyPartition(key: PartitionKey, rows: unknown[], entry: HashEntry): boolean {
  const { table } = parsePartitionKey(key)
  const rowKey = ROW_KEY_BY_TABLE[table as PartitionTable]
  if (!rowKey) return false
  if (rows.length !== entry.count) return false
  return combineHashes(rows.map((row) => hashRow(rowKey(row as never)))) === entry.hash
}

// ─── Montagem do DataFile do peer ─────────────────────────────────────────────

const DATA_FILE_FIELD: Record<PartitionTable, keyof DataFile> = {
  accounts: 'accounts',
  categories: 'categories',
  tags: 'tags',
  valuations: 'valuations',
  saved_periods: 'savedPeriods',
  budgets: 'budgets',
  audit_log: 'auditLog',
  deleted_ids: 'deletedIds',
  devices: 'devices',
  hypotheses: 'hypotheses',
  transactions: 'transactions',
}

/**
 * Monta um `DataFile` do peer a partir das partições baixadas. Partição não baixada vira `[]` — o
 * contrato que `mergeForSync` já honra desde o CS-33 (união por id: array vazio não contribui e
 * nunca apaga), fixado pelo teste em `merge.test.ts`.
 *
 * Valida **por partição** (só o que veio da rede) e depois roda a escada de migração do `DataFile`,
 * que é como um peer numa versão de schema anterior é normalizado. Um peer à frente lança
 * `SchemaVersionError`, e o chamador o pula em vez de mesclar — mesma regra do S-20.
 */
export function assemblePeerDataFile(
  manifest: SyncManifest,
  fetched: Map<PartitionKey, unknown[]>
): DataFile {
  if (manifest.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new SchemaVersionError(manifest.schemaVersion)
  }

  const base = ManifestBaseSchema.parse({ user: manifest.user, settings: manifest.settings })

  const collections: Record<string, unknown[]> = {
    accounts: [],
    categories: [],
    tags: [],
    transactions: [],
    valuations: [],
    savedPeriods: [],
    budgets: [],
    auditLog: [],
    deletedIds: [],
    devices: [],
    hypotheses: [],
  }

  for (const [key, rows] of fetched) {
    const { table } = parsePartitionKey(key)
    const schema = PARTITION_SCHEMAS[table as keyof typeof PARTITION_SCHEMAS]
    const field = DATA_FILE_FIELD[table as PartitionTable]
    if (!schema || !field) throw new Error(`partitions: unknown table ${JSON.stringify(table)}`)
    // `transactions` chega em várias partições (uma por ano) e precisa acumular, não substituir.
    collections[field] = collections[field].concat(schema.parse(rows))
  }

  return migrateDataFile({
    schemaVersion: manifest.schemaVersion,
    user: base.user,
    settings: base.settings,
    ...collections,
  } as unknown as DataFile)
}

// ─── CS-53: manifesto embarcado em appProperties ──────────────────────────────
//
// O `files.list` da raiz já devolve `appProperties` quando pedidas em `fields`. Se a tabela de
// partições couber lá, o leitor descobre tudo o que precisa **na mesma chamada que lista os peers**
// — o download do manifesto (~1s, medido, para 3,5 KB) desaparece. Bytes não são o custo aqui;
// round-trips são.
//
// Limites da API: **30 propriedades privadas por app por arquivo, 124 bytes por propriedade**
// (chave + valor, UTF-8). Uma entrada `2026,hash,count,fileId` dá ~52 bytes, então cabem duas por
// propriedade — 24 partições viram 12 propriedades, com folga para ~50 anos de histórico. Acima
// disso a codificação devolve `null` e o publicador simplesmente não anuncia; o leitor cai para o
// download do manifesto, que continua sendo publicado como sempre.

const PROP_MAX_COUNT = 29 // 30 do limite, menos a propriedade de metadados
const PROP_MAX_BYTES = 124
const PROP_ENTRIES_PREFIX = 'q'
const PROP_META = 'm'

/**
 * Códigos curtos por tabela. Nenhum colide com um ano (4 dígitos), o que mantém a codificação
 * injetiva sem precisar de um separador de tipo. Testado.
 */
const TABLE_CODE: Record<SmallTable, string> = {
  accounts: 'a',
  categories: 'c',
  tags: 'g',
  valuations: 'v',
  saved_periods: 's',
  budgets: 'b',
  audit_log: 'l',
  deleted_ids: 'd',
  devices: 'e',
  hypotheses: 'h',
}
const CODE_TABLE: Record<string, SmallTable> = Object.fromEntries(
  Object.entries(TABLE_CODE).map(([table, code]) => [code, table as SmallTable])
) as Record<string, SmallTable>

function encodePartitionCode(key: PartitionKey): string {
  const { table, partition } = parsePartitionKey(key)
  if (table === 'transactions') return partition
  return TABLE_CODE[table as SmallTable]
}

function decodePartitionCode(code: string): PartitionKey | null {
  if (/^\d{4}$/.test(code)) return partitionKey('transactions', code)
  const table = CODE_TABLE[code]
  return table ? partitionKey(table) : null
}

/**
 * Serializa o manifesto em `appProperties`. Devolve `null` quando não cabe — caso em que o
 * publicador não anuncia e o leitor usa o manifesto baixado, sem perda de funcionalidade.
 */
export function encodeManifestProperties(manifest: SyncManifest): Record<string, string> | null {
  const entries: string[] = []
  for (const [key, entry] of Object.entries(manifest.partitions)) {
    const code = encodePartitionCode(key)
    if (!code || !entry.fileId) return null // sem código ou sem id, o leitor não conseguiria buscar
    entries.push([code, entry.hash.toString(36), entry.count.toString(36), entry.fileId].join(','))
  }

  const props: Record<string, string> = {
    [PROP_META]: [
      manifest.formatVersion,
      manifest.hashVersion,
      manifest.schemaVersion,
      manifest.settings.fileUpdatedAt,
    ].join('|'),
  }
  if (byteLength(PROP_META) + byteLength(props[PROP_META]) > PROP_MAX_BYTES) return null

  let bucket: string[] = []
  let index = 0
  const flush = (): boolean => {
    if (bucket.length === 0) return true
    const name = `${PROP_ENTRIES_PREFIX}${index++}`
    const value = bucket.join('|')
    if (byteLength(name) + byteLength(value) > PROP_MAX_BYTES) return false
    props[name] = value
    bucket = []
    return true
  }

  for (const entry of entries) {
    const candidate = [...bucket, entry].join('|')
    if (byteLength(`${PROP_ENTRIES_PREFIX}${index}`) + byteLength(candidate) > PROP_MAX_BYTES) {
      if (!flush()) return null
    }
    bucket.push(entry)
  }
  if (!flush()) return null

  return Object.keys(props).length - 1 > PROP_MAX_COUNT ? null : props
}

/**
 * Reconstrói o manifesto a partir das `appProperties`. `user`/`settings` não viajam aqui — o
 * chamador os completa com os seus (o merge só lê `remote.settings.fileUpdatedAt`, que vem no
 * bloco de metadados, e nunca lê `remote.user`).
 */
export function decodeManifestProperties(
  props: Record<string, string> | undefined,
  deviceId: string
): (Omit<SyncManifest, 'user' | 'settings'> & { fileUpdatedAt: string }) | null {
  const meta = props?.[PROP_META]
  if (!meta) return null
  const [formatVersion, hashVersion, schemaVersion, fileUpdatedAt] = meta.split('|')
  if (!fileUpdatedAt) return null

  const partitions: Record<PartitionKey, PartitionEntry> = {}
  for (let i = 0; ; i++) {
    const raw = props?.[`${PROP_ENTRIES_PREFIX}${i}`]
    if (raw === undefined) break
    for (const entry of raw.split('|')) {
      const [code, hash, count, fileId] = entry.split(',')
      const key = decodePartitionCode(code)
      if (!key || !fileId) return null
      partitions[key] = {
        hash: parseInt(hash, 36),
        count: parseInt(count, 36),
        file: partitionFileName(key),
        fileId,
      }
    }
  }

  return {
    formatVersion: Number(formatVersion),
    hashVersion: Number(hashVersion),
    schemaVersion: Number(schemaVersion),
    deviceId,
    publishedAt: fileUpdatedAt,
    partitions,
    fileUpdatedAt,
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

/** Manifesto que este dispositivo publica, a partir dos hashes locais. */
export function buildManifest(params: {
  deviceId: string
  user: User
  settings: Settings
  localHashes: Map<PartitionKey, HashEntry>
  /** Ids já conhecidos no Drive, por nome de arquivo — preserva o `fileId` de quem não mudou. */
  fileIdsByName: ReadonlyMap<string, string>
  publishedAt: string
}): SyncManifest {
  const partitions: Record<PartitionKey, PartitionEntry> = {}
  for (const [key, entry] of params.localHashes) {
    if (entry.count === 0) continue
    const file = partitionFileName(key)
    partitions[key] = { ...entry, file, fileId: params.fileIdsByName.get(file) }
  }
  return {
    formatVersion: PARTITION_FORMAT_VERSION,
    hashVersion: HASH_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    deviceId: params.deviceId,
    publishedAt: params.publishedAt,
    user: params.user,
    settings: params.settings,
    partitions,
  }
}
