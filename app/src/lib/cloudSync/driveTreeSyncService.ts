// CS-44/CS-45 — transporte particionado sobre o Google Drive, substituindo o `gimbo.db`
// monolítico de `syncService.ts`.
//
// O que muda, e por quê: o transporte anterior baixava e re-subia o cofre inteiro (~14MB) a cada
// sync. Pior: `_triggerLocalBackup` chama `pushIfNeeded` a **cada mutação debounced**, então cada
// salvamento subia 14MB. `CS-30`/`CS-35` já tinham resolvido o custo de escrita local e
// `CS-32`/`CS-33` o de leitura/parse — sobrou a rede, e era a maior fatia.
//
// Layout remoto:
//
//   Gimbo/
//     manifest-<deviceId>.json      ← escritor único; TODOS num só files.list da raiz
//     device-<deviceId>/
//       accounts.json.gz  …  transactions-2026.json.gz
//
// Dois desvios deliberados da proposta original, ambos para cortar round-trips: o manifesto fica
// na raiz (um `files.list` devolve o de todos os peers com `modifiedTime`, então a checagem de
// watermark de todos sai de graça), e cada entrada de partição carrega o `fileId`, então o leitor
// nunca lista a pasta do peer — vai direto no `alt=media`.
//
// **Corte seco:** este módulo não lê nem escreve o `Gimbo/gimbo.db` legado. Um dispositivo ainda
// não atualizado continua no formato antigo e não é lido; nada se perde (o merge é aditivo e
// idempotente), só atrasa até ele atualizar.

import { CURRENT_SCHEMA_VERSION, SchemaVersionError } from '@/lib/storage/schema'
import { diffTransactions, type TransactionDelta } from '@/lib/storage/transactionDiff'
import { storage } from '@/services/storage'
import type { DataFile, Transaction } from '@/types'
import { getDeviceId } from './deviceId'
import { isGoogleConnected } from './googleAuth'
import {
  downloadFileById,
  ensureSubfolder,
  getRootFolderId,
  listFolderChildren,
  mapWithConcurrency,
  reportDriveApiCallCount,
  resetDriveApiCallCount,
  uploadFileToFolder,
  type DriveFile,
} from './googleDrive'
import { mergeForSync } from './merge'
import {
  PARTITION_FORMAT_VERSION,
  assemblePeerDataFile,
  buildManifest,
  decodePartition,
  encodePartition,
  partitionFileName,
  partitionMimeType,
  planFetch,
  planPublish,
  verifyPartition,
  type HashEntry,
  type PartitionKey,
  type SyncManifest,
} from './partitions'
import type { SyncResult } from './provider'
import { measureSync, measureSyncCompute, trackSyncBytes } from './syncMetrics'

const MANIFEST_PREFIX = 'manifest-'
const MANIFEST_EXT = '.json'
const DEVICE_FOLDER_PREFIX = 'device-'

/**
 * Marca d'água por peer, **chaveada pelo id do arquivo no Drive, não pelo nome do dispositivo**:
 * o Drive permite nomes duplicados, e uma corrida de criação entre dispositivos pode deixar dois
 * `manifest-<id>.json`. Chaveando por id, duplicatas viram simplesmente dois peers — e mesclar os
 * dois é inofensivo, porque o merge é idempotente.
 */
const PEER_WATERMARK_PREFIX = 'gimbo_sync_peer_mtime_'
const PUBLISHED_KEY = 'gimbo_sync_published'

function manifestName(deviceId: string): string {
  return `${MANIFEST_PREFIX}${deviceId}${MANIFEST_EXT}`
}

function deviceFolderName(deviceId: string): string {
  return `${DEVICE_FOLDER_PREFIX}${deviceId}`
}

function isManifest(file: DriveFile): boolean {
  return file.name.startsWith(MANIFEST_PREFIX) && file.name.endsWith(MANIFEST_EXT)
}

// ─── Estado local (cache reconstruível, nunca autoritativo) ───────────────────

interface PublishedState {
  hashes: Record<PartitionKey, HashEntry>
  fileIds: Record<string, string>
  folderId?: string
  manifestFileId?: string
}

const EMPTY_PUBLISHED: PublishedState = { hashes: {}, fileIds: {} }

function loadPublished(): PublishedState {
  try {
    const raw = localStorage.getItem(PUBLISHED_KEY)
    if (!raw) return EMPTY_PUBLISHED
    const parsed = JSON.parse(raw) as Partial<PublishedState>
    return { ...parsed, hashes: parsed.hashes ?? {}, fileIds: parsed.fileIds ?? {} }
  } catch {
    return EMPTY_PUBLISHED
  }
}

function savePublished(state: PublishedState): void {
  try {
    localStorage.setItem(PUBLISHED_KEY, JSON.stringify(state))
  } catch {
    // Cota cheia ou storage bloqueado: o cache é reconstruível, seguir sem ele só custa uma
    // republicação a mais no próximo sync.
  }
}

function getPeerWatermark(fileId: string): string {
  return localStorage.getItem(PEER_WATERMARK_PREFIX + fileId) ?? ''
}

function setPeerWatermark(fileId: string, modifiedTime: string): void {
  localStorage.setItem(PEER_WATERMARK_PREFIX + fileId, modifiedTime)
}

/**
 * Limpa todo estado de sync deste transporte. Chamado quando o cofre local é substituído (import,
 * clear) ou a conta é desconectada — sem isso, importar um backup antigo faz o app pular para
 * sempre o peer que tem justamente o dado recém-descartado, porque a marca d'água diz "já vi essa
 * versão". Ver CS-47.
 */
export function clearDriveTreeSyncState(): void {
  const doomed: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(PEER_WATERMARK_PREFIX)) doomed.push(key)
  }
  for (const key of doomed) localStorage.removeItem(key)
  localStorage.removeItem(PUBLISHED_KEY)
}

function toHashMap(rows: { key: string; hash: number; count: number }[]): Map<string, HashEntry> {
  return new Map(rows.map((r) => [r.key, { hash: r.hash, count: r.count }]))
}

/**
 * Devolve o controle ao browser entre partições. A decodificação (gunzip + JSON.parse + zod) roda
 * na main thread; num primeiro sync grande, fazer tudo de uma vez congelaria a UI por ~1s.
 */
async function yieldToUi(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (typeof scheduler?.yield === 'function') return scheduler.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

/**
 * CS-52: publicação pendente, para o pull não esperar por ela.
 *
 * Medido contra dado real: de 8,5s de sync incremental, **4,0s eram publicação** — uploads que o
 * usuário não precisa ver para o dado do peer aparecer na tela. O caso que importa é o de voltar à
 * sessão: o celular registrou uma despesa, e o desktop deve mostrá-la assim que a tiver, não depois
 * de terminar de anunciar o próprio estado.
 *
 * Serializada, nunca concorrente: `publishOwnTree` lê e reescreve o cache de "último publicado", e
 * duas execuções simultâneas o corromperiam. O próximo pull espera a publicação anterior assentar
 * (na prática já assentou — syncs são separados por minutos).
 */
interface PendingPublish {
  rootId: string
  deviceId: string
  rootChildren: DriveFile[] | null
}

let _publishInFlight: Promise<void> | null = null

function settlePendingPublish(): Promise<void> {
  return _publishInFlight ?? Promise.resolve()
}

/**
 * Espera a publicação em background assentar. Exportada porque um chamador pode legitimamente
 * precisar de um ponto de sincronização — testes que afirmam o estado publicado, e qualquer fluxo
 * futuro que queira garantir a árvore anunciada antes de seguir (ex.: descarregar a página).
 */
export function whenPublishSettled(): Promise<void> {
  return settlePendingPublish()
}

function startBackgroundPublish(pending: PendingPublish): void {
  _publishInFlight = (async () => {
    // Contagem própria: as chamadas da publicação não pertencem ao orçamento do pull, que já foi
    // reportado. Sem sobreposição possível, porque o pull seguinte espera esta terminar.
    resetDriveApiCallCount()
    try {
      await measureSync('sync.drive.publish.total', () =>
        publishOwnTree(pending.rootId, pending.deviceId, pending.rootChildren)
      )
    } catch {
      // Falha de publicação nunca é fatal: o cache de "último publicado" só é gravado no caminho
      // de sucesso, então o próximo sync republica o que faltou. Mesmo argumento S-20.
    } finally {
      reportDriveApiCallCount('sync.drive.publish.apiCalls')
      _publishInFlight = null
    }
  })()
}

export async function pullAndMerge(local: DataFile): Promise<SyncResult> {
  if (!isGoogleConnected()) return { status: 'offline' }
  await settlePendingPublish()
  resetDriveApiCallCount()

  let pending: PendingPublish | null = null
  try {
    const outcome = await measureSync('sync.pullAndMerge.total', () => pullAndMergeInner(local))
    pending = outcome.publish
    return outcome.result
  } catch {
    return { status: 'offline' }
  } finally {
    // Reporta o orçamento do pull **antes** de soltar a publicação, para as duas contagens não se
    // misturarem. A ordem aqui é determinística: o `finally` roda antes de qualquer coisa que
    // `startBackgroundPublish` agende.
    reportDriveApiCallCount()
    if (pending) startBackgroundPublish(pending)
  }
}

async function pullAndMergeInner(
  local: DataFile
): Promise<{ result: SyncResult; publish: PendingPublish }> {
  const deviceId = await getDeviceId()
  const rootId = await getRootFolderId()
  const rootChildren = await listFolderChildren(rootId)

  const ownManifest = manifestName(deviceId)
  const peerManifests = rootChildren.filter((f) => isManifest(f) && f.name !== ownManifest)
  trackSyncBytes('sync.drive.peersTotal', peerManifests.length)

  const stale = peerManifests.filter((f) => f.modifiedTime > getPeerWatermark(f.id))
  trackSyncBytes('sync.drive.peersSkippedByWatermark', peerManifests.length - stale.length)

  let merged = local
  let peersMerged = 0
  let sawNewerSchema = false
  // CS-50 (B): anos de `transactions` que alguma partição buscada pode ter alterado, para diferir
  // só esses em vez de reler o cofre inteiro. `tombstonesFetched` força o caminho completo — uma
  // lápide pode remover uma transação de *qualquer* ano, e um diff escopado não a veria.
  const affectedYears = new Set<string>()
  let tombstonesFetched = false

  for (const manifestFile of stale) {
    const outcome = await mergeOnePeer(manifestFile, merged)
    if (outcome.status === 'newer-schema') {
      sawNewerSchema = true
      continue
    }
    // Falha de rede/decode **não avança a marca d'água**. Partição pulada e partição que falhou
    // contribuem ambas com `[]`; se o watermark avançasse, o peer nunca mais seria lido e o dado
    // dele sumiria em silêncio. A idempotência do merge torna a retentativa no boot seguinte
    // segura (mesmo argumento S-20 que o transporte de pasta já usa).
    if (outcome.status === 'failed') continue
    merged = outcome.data
    peersMerged++
    for (const key of outcome.fetchedKeys) {
      const { table, partition } = parseKey(key)
      if (table === 'transactions') affectedYears.add(partition)
      if (table === 'deleted_ids') tombstonesFetched = true
    }
    setPeerWatermark(manifestFile.id, manifestFile.modifiedTime)
  }

  if (peersMerged > 0) {
    const delta = await computeDelta(merged, affectedYears, tombstonesFetched)
    await measureSync('sync.applyMutation', () => storage.applyMutation(merged, delta))
  }

  // CS-52: a publicação é devolvida ao chamador para rodar em background, **depois** do
  // applyMutation — é ele que atualiza `table_hashes`, e o manifesto tem que descrever o estado já
  // mesclado. Como o `applyMutation` já concluiu aqui, o estado local está íntegro mesmo se a
  // publicação falhar; ela só anuncia esse estado aos peers.
  const publish: PendingPublish = { rootId, deviceId, rootChildren }

  if (peersMerged === 0) {
    const result: SyncResult = sawNewerSchema
      ? { status: 'skipped', reason: 'newer-schema' }
      : { status: 'synced' }
    return { result, publish }
  }
  // CS-35: devolve o DataFile já calculado, para o chamador não pagar um loadDataFile inteiro.
  return { result: { status: 'merged', peersMerged, data: merged }, publish }
}

function parseKey(key: PartitionKey): { table: string; partition: string } {
  const separator = key.indexOf(':')
  if (separator === -1) return { table: key, partition: '' }
  return { table: key.slice(0, separator), partition: key.slice(separator + 1) }
}

/**
 * O delta que `applyMutation` vai gravar, sempre contra o que está **no disco agora** — nunca
 * contra o snapshot pré-pull (CS-30/CS-24).
 *
 * Ler o cofre inteiro só para diferir custava 2,0-2,5s numa medição real (é o `CS-31`, que a Fase 2
 * não tinha resolvido). Mas o transporte particionado sabe exatamente quais partições vieram da
 * rede, e uma transação só pode ter mudado num ano cuja partição divergiu — se o ano do peer batia
 * com o nosso, o conteúdo era idêntico linha a linha e o merge não teve o que mudar ali. Então
 * basta ler e diferir esses anos.
 *
 * **A transação que muda de ano continua correta**, mas não pelo motivo que parece. Em geral as
 * duas pontas entram no conjunto (o ano novo do peer diverge do nosso, e o ano velho também), e o
 * diff sobre a união resolve. No caso limite em que o ano velho do peer fica *vazio*, porém, ele
 * nem é publicado — não está no manifesto e portanto não é buscado, então só o ano novo entra em
 * `affectedYears`. O resultado segue certo porque o delta é aplicado por **upsert por id**
 * (`applyTransactionDelta`): a linha antiga é atualizada no lugar, e a recomputação de hash de lá
 * já cobre o ano velho a partir do `oldYearById`. Um teste fixa exatamente esse caso limite.
 *
 * O caminho completo é obrigatório quando vieram lápides: `deleted_ids` remove por id, sem dizer
 * de que ano, e um diff escopado não veria a remoção num ano que ninguém buscou.
 *
 * Efeito colateral bem-vindo: uma edição local concorrente num ano *não* tocado deixa de ser
 * revertida-e-recuperada (o ciclo do CS-24/CS-29) e simplesmente sobrevive, porque nunca entra no
 * diff. A reconciliação em `runPeerSync` continua lá para os demais casos.
 */
async function computeDelta(
  merged: DataFile,
  affectedYears: Set<string>,
  tombstonesFetched: boolean
): Promise<TransactionDelta> {
  if (tombstonesFetched || affectedYears.size === 0) {
    const baseline = await measureSync('sync.loadBaseline', () => storage.loadDataFile())
    return baseline
      ? diffTransactions(baseline.transactions, merged.transactions)
      : { upserts: merged.transactions, deletedIds: [] }
  }

  const keys = [...affectedYears].map((year) => `transactions:${year}`)
  const rowsByKey = await measureSync('sync.loadBaseline', () => storage.readPartitions(keys))
  trackSyncBytes('sync.drive.baselineScopedYears', affectedYears.size)

  const before = keys.flatMap((key) => (rowsByKey[key] ?? []) as Transaction[])
  const after = merged.transactions.filter((tx) => affectedYears.has(tx.date.slice(0, 4)))
  return diffTransactions(before, after)
}

type PeerOutcome =
  | { status: 'ok'; data: DataFile; fetchedKeys: PartitionKey[] }
  | { status: 'newer-schema' }
  | { status: 'failed' }

async function mergeOnePeer(manifestFile: DriveFile, current: DataFile): Promise<PeerOutcome> {
  try {
    const bytes = await downloadFileById(manifestFile.id)
    if (!bytes) return { status: 'failed' }
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as SyncManifest

    // Peer à frente em formato de transporte ou em schema: pular, nunca mesclar às cegas (S-20).
    if (manifest.formatVersion > PARTITION_FORMAT_VERSION) return { status: 'newer-schema' }
    if (manifest.schemaVersion > CURRENT_SCHEMA_VERSION) return { status: 'newer-schema' }

    // Hashes locais lidos **agora**, depois do round-trip de rede — nunca um snapshot anterior
    // (mesma disciplina do CS-24/CS-29). A garantia de que pular é seguro é a monotonicidade
    // documentada em `planFetch`, mas ler fresco reduz buscas inúteis.
    const base = await storage.getSyncManifestBase()
    const localHashes = toHashMap(base?.hashes ?? [])

    const plan = planFetch(manifest, localHashes)
    trackSyncBytes('sync.drive.partitionsTotal', plan.total)
    trackSyncBytes('sync.drive.partitionsSkipped', plan.skipped)
    trackSyncBytes('sync.drive.partitionsFetched', plan.keys.length)
    if (plan.hashVersionMismatch) trackSyncBytes('sync.drive.hashVersionMismatch', 1)

    const fetched = await fetchPartitions(manifest, plan.keys)
    const peer = assemblePeerDataFile(manifest, fetched)
    return {
      status: 'ok',
      data: measureSyncCompute('sync.merge', () => mergeForSync(current, peer)),
      fetchedKeys: plan.keys,
    }
  } catch (err) {
    if (err instanceof SchemaVersionError) return { status: 'newer-schema' }
    return { status: 'failed' }
  }
}

async function fetchPartitions(
  manifest: SyncManifest,
  keys: PartitionKey[]
): Promise<Map<PartitionKey, unknown[]>> {
  const fetched = new Map<PartitionKey, unknown[]>()
  if (keys.length === 0) return fetched

  const downloaded = await mapWithConcurrency(keys, async (key) => {
    const entry = manifest.partitions[key]
    let buffer = entry.fileId ? await downloadFileById(entry.fileId) : null
    // Id obsoleto no manifesto do peer: cai para achar o arquivo pelo nome antes de desistir.
    buffer ??= await downloadPartitionByName(manifest.deviceId, entry.file)
    if (!buffer) throw new Error(`sync: partition ${key} not found on Drive`)
    return { key, entry, buffer }
  })

  let mismatches = 0
  await measureSync('sync.drive.decodePartitions', async () => {
    for (const { key, entry, buffer } of downloaded) {
      const rows = await decodePartition(buffer, entry.file)
      // CS-46: valida manifesto ↔ bytes ↔ rowHash ↔ HASH_VERSION ↔ normalização do CS-32 de uma
      // vez. **Reporta, nunca bloqueia** — o merge é LWW-seguro independente do hash, e deixar um
      // checksum de otimização descartar dado real trocaria performance por perda de dado.
      if (!verifyPartition(key, rows, entry)) mismatches++
      fetched.set(key, rows)
      await yieldToUi()
    }
  })
  if (mismatches > 0) trackSyncBytes('sync.drive.partitionHashMismatch', mismatches)

  return fetched
}

/** Auto-cura para um `fileId` obsoleto no manifesto do peer — custa uma listagem, quase nunca roda. */
async function downloadPartitionByName(
  peerDeviceId: string,
  fileName: string
): Promise<ArrayBuffer | null> {
  const rootId = await getRootFolderId()
  const rootChildren = await listFolderChildren(rootId)
  const folder = rootChildren.find((f) => f.name === deviceFolderName(peerDeviceId))
  if (!folder) return null
  const children = await listFolderChildren(folder.id)
  const match = children.find((f) => f.name === fileName)
  return match ? downloadFileById(match.id) : null
}

// ─── Publish ──────────────────────────────────────────────────────────────────

/**
 * Publica a árvore deste dispositivo. **Sem argumento, de propósito**: o transporte monolítico
 * recebia o `DataFile` para comparar `fileUpdatedAt` com o `modifiedTime` remoto, o que fazia dele
 * um snapshot que podia estar velho na hora do upload. Aqui a decisão vem dos hashes lidos frescos
 * do banco, então não há snapshot a envelhecer.
 */
export async function pushIfNeeded(): Promise<boolean> {
  if (!isGoogleConnected()) return false
  // Mesma serialização do pull: nunca duas publicações ao mesmo tempo (CS-52).
  await settlePendingPublish()
  resetDriveApiCallCount()
  try {
    const deviceId = await getDeviceId()
    const rootId = await getRootFolderId()
    await publishOwnTree(rootId, deviceId, null)
    return true
  } catch {
    return false
  } finally {
    reportDriveApiCallCount()
  }
}

/**
 * Publica as partições deste dispositivo que mudaram, e **o manifesto por último**.
 *
 * O manifesto é o commit: um leitor confia que todo arquivo que ele lista já está lá. Se a conexão
 * cair no meio dos uploads, o manifesto antigo continua válido (nunca aponta para arquivo que não
 * terminou de subir) e a próxima tentativa resolve sozinha, sem lock nem coordenação.
 *
 * `rootChildren` vem do pull quando disponível, para não pagar uma listagem a mais.
 */
async function publishOwnTree(
  rootId: string,
  deviceId: string,
  rootChildren: DriveFile[] | null
): Promise<void> {
  const base = await storage.getSyncManifestBase()
  if (!base) return
  const localHashes = toHashMap(base.hashes)

  const published = loadPublished()
  const hasCache = Object.keys(published.hashes).length > 0

  // Caminho rápido: com cache íntegro e nada mudado, não há sequer o que listar. É o que mantém um
  // sync em regime permanente em ~1 chamada.
  if (hasCache && !anythingChanged(localHashes, published.hashes)) return

  // CS-50 (C): com o cache íntegro, os nomes e ids da própria pasta já são conhecidos — listar de
  // novo custava um estágio sequencial de rede (~0,55s medidos) para reconfirmar o que acabamos de
  // escrever. Sem cache (dispositivo novo, localStorage despejado), lista.
  //
  // O que se perde: um arquivo apagado *fora* do app, cujo hash não mudou, deixa de ser detectado
  // como ausente. `uploadFileToFolder` já recria em 404 no que a gente sobe, e qualquer id que se
  // revelar morto invalida o cache abaixo, forçando a listagem completa no sync seguinte.
  const cachedFileIds = Object.entries(published.fileIds)
  const canUseCache = published.folderId !== undefined && cachedFileIds.length > 0

  const folderId = published.folderId ?? (await ensureSubfolder(rootId, deviceFolderName(deviceId)))
  const fileIdsByName = canUseCache
    ? new Map(cachedFileIds)
    : new Map((await listFolderChildren(folderId)).map((f) => [f.name, f.id]))

  const keys = planPublish(localHashes, published.hashes, new Set(fileIdsByName.keys()))

  // Uma única chamada ao worker para todas as partições. Antes era uma por partição dentro do laço
  // de concorrência: os uploads paralelizavam, mas as leituras não — a fila do worker as serializa
  // (corretamente, CS-28), e 23 leituras enfileiradas somavam ~13s no primeiro sync, mais que toda
  // a rede junta. Medido contra dado real em 2026-08-27.
  const rowsByKey = await measureSync('sync.drive.publish.readPartitions', () =>
    storage.readPartitions(keys)
  )

  const uploadedIds = await mapWithConcurrency(keys, async (key) => {
    const { bytes, gzip } = await encodePartition(rowsByKey[key] ?? [])
    const name = partitionFileName(key, gzip)
    const id = await uploadFileToFolder({
      parentId: folderId,
      name,
      blob: new Blob([bytes as BlobPart], { type: partitionMimeType(gzip) }),
      fileId: fileIdsByName.get(name),
    })
    return { name, id, recreated: id !== fileIdsByName.get(name) && fileIdsByName.has(name) }
  })

  // Um id em cache que se revelou morto (o upload teve de recriar o arquivo) significa que a pasta
  // no Drive divergiu do que guardamos — descarta o cache de ids para o próximo sync listar de
  // verdade, em vez de seguir confiando em entradas possivelmente obsoletas.
  const driveDrifted = uploadedIds.some((u) => u.recreated)
  for (const { name, id } of uploadedIds) fileIdsByName.set(name, id)
  trackSyncBytes('sync.drive.publish.partitionsUploaded', keys.length)
  if (driveDrifted) trackSyncBytes('sync.drive.publish.staleFileIds', 1)

  // Barreira dura: o manifesto só sobe depois que todos os uploads acima resolveram.
  const manifest = buildManifest({
    deviceId,
    user: base.user,
    settings: base.settings,
    localHashes,
    fileIdsByName,
    publishedAt: new Date().toISOString(),
  })
  const manifestFileId = await uploadFileToFolder({
    parentId: rootId,
    name: manifestName(deviceId),
    blob: new Blob([JSON.stringify(manifest)], { type: 'application/json' }),
    fileId:
      published.manifestFileId ?? rootChildren?.find((f) => f.name === manifestName(deviceId))?.id,
  })

  savePublished({
    hashes: Object.fromEntries(localHashes),
    fileIds: driveDrifted ? {} : Object.fromEntries(fileIdsByName),
    folderId,
    manifestFileId,
  })
}

function anythingChanged(
  localHashes: Map<PartitionKey, HashEntry>,
  published: Record<PartitionKey, HashEntry>
): boolean {
  const liveKeys = [...localHashes].filter(([, entry]) => entry.count > 0)
  if (liveKeys.length !== Object.keys(published).length) return true
  return liveKeys.some(([key, entry]) => {
    const prev = published[key]
    return !prev || prev.hash !== entry.hash || prev.count !== entry.count
  })
}
