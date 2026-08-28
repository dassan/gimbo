import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// CS-49 — sync particionado entre dois cofres reais, cada um no seu OPFS.
//
// A lacuna que este spec fecha: **tudo o que envolvia um segundo cofre real testava o caminho
// antigo** (`readPeerBlob`, um `.db` inteiro). O transporte particionado só era exercitado com o
// `storage` mockado (unitário) ou dentro de um cofre só — e ali o "peer" é montado a partir do
// mesmo banco que o lê, o que torna a igualdade de hash tautológica.
//
// O que precisa de prova, e só um segundo cofre real dá: a decisão de **não buscar** uma partição
// depende de o hash que o cofre A publica bater com o que o cofre B calcula do seu próprio banco.
// Se divergirem, o skip nunca dispara (o transporte inteiro perde o sentido); se baterem com
// conteúdo diferente, o dado do peer some em silêncio — a pior falha que esta otimização pode
// produzir.
//
// Escopo deliberado: a camada de partição + storage reais, sem a camada HTTP. A orquestração do
// Drive já é coberta por `driveTreeSyncService.test.ts` contra o `FakeDrive`, que é estrito de
// propósito; reexercitá-la aqui custaria um parser multipart sem fechar risco novo.

type Win = Record<string, unknown>

interface PublishedTree {
  manifest: Record<string, unknown>
  files: Record<string, string> // chave de partição → bytes em base64
}

interface MergeOutcome {
  fetchedKeys: string[]
  skipped: number
  total: number
  txIds: string[]
  accountIds: string[]
}

const SHARED_ACCOUNTS = [
  {
    id: 'acc-1',
    name: 'Conta Corrente',
    type: 'RETAIL',
    balance: 1000,
    includeInBalance: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

const SHARED_CATEGORIES = [
  {
    id: 'cat-1',
    name: 'Mercado',
    icon: 'cart',
    color: '#f00',
    type: 'EXPENSE',
    parentId: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

/**
 * `createdAt` é parâmetro separado de propósito. Amarrá-lo a `updatedAt` (o atalho óbvio) faz
 * qualquer teste que varie só o `updatedAt` variar os dois — e aí o hash diverge pelo campo errado,
 * mascarando exatamente o que se quer provar. Aconteceu ao escrever este spec.
 */
function tx(
  id: string,
  date: string,
  amount: number,
  updatedAt: string,
  createdAt = FIXED_CREATED_AT
) {
  return {
    id,
    accountId: 'acc-1',
    categoryId: 'cat-1',
    amount,
    type: 'EXPENSE',
    date,
    description: `Lançamento ${id}`,
    isPaid: true,
    tags: [],
    budgetIds: [],
    updatedAt,
    createdAt,
  }
}

/** Data de criação comum, para que só o campo em teste varie entre cofres. */
const FIXED_CREATED_AT = '2024-01-01T00:00:00.000Z'

/** Transação que os dois cofres compartilham desde o início — a base já convergida. */
const SHARED_TX = tx('tx-compartilhada', '2024-07-15', 50, '2024-07-15T10:00:00.000Z')

/**
 * `fileCreatedAt` **diferente por cofre**, de propósito: é o valor que a normalização
 * `updatedAt ?? ts` usa ao gravar hashes, então dois cofres com histórico idêntico mas datas de
 * criação distintas são o cenário onde uma divergência espúria apareceria.
 */
function vaultFixture(fileCreatedAt: string, transactions: unknown[]) {
  return {
    schemaVersion: 4,
    user: { name: 'E2E User', createdAt: fileCreatedAt, updatedAt: fileCreatedAt },
    settings: { fileCreatedAt, fileUpdatedAt: fileCreatedAt, auditLogRetentionLimit: 200 },
    accounts: SHARED_ACCOUNTS,
    categories: SHARED_CATEGORIES,
    tags: [],
    transactions,
    valuations: [],
    auditLog: [],
    deletedIds: [],
    savedPeriods: [],
    budgets: [],
  }
}

async function seed(page: Page, data: unknown) {
  await page.goto('/onboarding')
  await page.waitForFunction(() => !!(window as Win).__storage)
  await page.evaluate((d) => (window as Win).__storage.replaceAll(d), data)
}

/** Publica a árvore deste cofre exatamente como o `publishOwnTree` faria: hashes reais do banco. */
async function publishTree(page: Page, deviceId: string): Promise<PublishedTree> {
  return page.evaluate(async (id) => {
    const win = window as Win
    const base = await win.__storage.getSyncManifestBase()
    const localHashes = new Map(
      base.hashes.map((h: { key: string; hash: number; count: number }) => [
        h.key,
        { hash: h.hash, count: h.count },
      ])
    )
    const manifest = win.__syncTest.partitions.buildManifest({
      deviceId: id,
      user: base.user,
      settings: base.settings,
      localHashes,
      fileIdsByName: new Map(),
      publishedAt: new Date().toISOString(),
    })

    const keys = Object.keys(manifest.partitions)
    const rowsByKey = await win.__storage.readPartitions(keys)
    const files: Record<string, string> = {}
    for (const key of keys) {
      const { bytes } = await win.__syncTest.partitions.encodePartition(rowsByKey[key])
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      files[key] = btoa(binary)
    }
    return { manifest, files }
  }, deviceId)
}

/**
 * Consome a árvore de um peer: decide pelo hash o que buscar, decodifica **só isso**, mescla e
 * persiste. É o caminho de `driveTreeSyncService.mergeOnePeer`, sem a camada de rede.
 */
async function mergePeerTree(page: Page, tree: PublishedTree): Promise<MergeOutcome> {
  return page.evaluate(async (peer) => {
    const win = window as Win
    const { partitions } = win.__syncTest

    const base = await win.__storage.getSyncManifestBase()
    const localHashes = new Map(
      base.hashes.map((h: { key: string; hash: number; count: number }) => [
        h.key,
        { hash: h.hash, count: h.count },
      ])
    )

    const plan = partitions.planFetch(peer.manifest, localHashes)

    const fetched = new Map()
    for (const key of plan.keys) {
      const binary = atob(peer.files[key])
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      fetched.set(
        key,
        await partitions.decodePartition(bytes.buffer, peer.manifest.partitions[key].file)
      )
    }

    const assembled = partitions.assemblePeerDataFile(peer.manifest, fetched)
    const local = await win.__storage.loadDataFile()
    const merged = win.__syncTest.mergeForSync(local, assembled)
    // Diff completo aqui de propósito: o baseline escopado por ano (CS-50 B) tem cobertura
    // unitária própria, e usá-lo aqui só acrescentaria uma variável ao que este spec quer provar.
    const delta = win.__syncTest.diffTransactions(local.transactions, merged.transactions)
    await win.__storage.applyMutation(merged, delta)

    return {
      fetchedKeys: plan.keys,
      skipped: plan.skipped,
      total: plan.total,
      txIds: merged.transactions.map((t: { id: string }) => t.id).sort(),
      accountIds: merged.accounts.map((a: { id: string }) => a.id).sort(),
    }
  }, tree)
}

async function readVault(page: Page): Promise<{ txIds: string[]; accountIds: string[] }> {
  return page.evaluate(async () => {
    const data = await (window as Win).__storage.loadDataFile()
    return {
      txIds: data.transactions.map((t: { id: string }) => t.id).sort(),
      accountIds: data.accounts.map((a: { id: string }) => a.id).sort(),
    }
  })
}

test.describe('CS-49 — dois cofres reais trocando uma árvore de partições', () => {
  let peerContext: BrowserContext
  let peerPage: Page

  test.beforeEach(async ({ browser }) => {
    // Um contexto próprio = um OPFS próprio = um cofre de verdade, independente do outro.
    peerContext = await browser.newContext()
    peerPage = await peerContext.newPage()
  })

  test.afterEach(async () => {
    await peerContext.close()
  })

  test('o cofre local ganha o dado do peer e não perde nada do seu', async ({ page }) => {
    await seed(
      peerPage,
      vaultFixture('2026-01-01T00:00:00.000Z', [
        SHARED_TX,
        tx('tx-so-do-peer', '2025-05-01', 80, '2025-05-01T10:00:00.000Z'),
      ])
    )
    await seed(
      page,
      vaultFixture('2026-06-30T00:00:00.000Z', [
        SHARED_TX,
        tx('tx-so-local', '2026-03-10', 120, '2026-03-10T10:00:00.000Z'),
      ])
    )

    const outcome = await mergePeerTree(page, await publishTree(peerPage, 'device-peer'))

    // A propriedade central: nada some, e o que veio do peer chegou.
    expect(outcome.txIds).toEqual(['tx-compartilhada', 'tx-so-do-peer', 'tx-so-local'])
    expect(await readVault(page)).toEqual({
      txIds: ['tx-compartilhada', 'tx-so-do-peer', 'tx-so-local'],
      accountIds: ['acc-1'],
    })
  })

  test('o hash-skip dispara entre cofres independentes: só o ano divergente é buscado', async ({
    page,
  }) => {
    await seed(
      peerPage,
      vaultFixture('2026-01-01T00:00:00.000Z', [
        SHARED_TX,
        tx('tx-so-do-peer', '2025-05-01', 80, '2025-05-01T10:00:00.000Z'),
      ])
    )
    await seed(page, vaultFixture('2026-06-30T00:00:00.000Z', [SHARED_TX]))

    const outcome = await mergePeerTree(page, await publishTree(peerPage, 'device-peer'))

    // 2024 é idêntico nos dois cofres, construídos separadamente — se os hashes não convergissem,
    // esta partição seria buscada à toa e o transporte inteiro perderia o sentido.
    expect(outcome.fetchedKeys).toEqual(['transactions:2025'])
    expect(outcome.skipped).toBeGreaterThan(0)
    expect(outcome.fetchedKeys).not.toContain('transactions:2024')
    expect(outcome.fetchedKeys).not.toContain('accounts:')
  })

  // A prova de convergência, e o coração deste spec: depois de trocarem dados, dois cofres
  // construídos de forma independente têm de produzir hashes **idênticos** para todo o conteúdo.
  test('depois de convergirem, uma nova rodada não busca partição nenhuma', async ({ page }) => {
    await seed(
      peerPage,
      vaultFixture('2026-01-01T00:00:00.000Z', [
        SHARED_TX,
        tx('tx-so-do-peer', '2025-05-01', 80, '2025-05-01T10:00:00.000Z'),
      ])
    )
    await seed(
      page,
      vaultFixture('2026-06-30T00:00:00.000Z', [
        SHARED_TX,
        tx('tx-so-local', '2026-03-10', 120, '2026-03-10T10:00:00.000Z'),
      ])
    )

    // Rodada 1: local absorve o peer. Rodada 2: peer absorve o local. Agora os dois têm tudo.
    await mergePeerTree(page, await publishTree(peerPage, 'device-peer'))
    await mergePeerTree(peerPage, await publishTree(page, 'device-local'))

    const convergido = ['tx-compartilhada', 'tx-so-do-peer', 'tx-so-local']
    expect((await readVault(page)).txIds).toEqual(convergido)
    expect((await readVault(peerPage)).txIds).toEqual(convergido)

    // Rodada 3, nos dois sentidos: nada a buscar.
    const local = await mergePeerTree(page, await publishTree(peerPage, 'device-peer'))
    expect(local.fetchedKeys).toEqual([])
    expect(local.skipped).toBe(local.total)
    expect(local.total).toBeGreaterThan(0)

    const peer = await mergePeerTree(peerPage, await publishTree(page, 'device-local'))
    expect(peer.fetchedKeys).toEqual([])
    expect(peer.skipped).toBe(peer.total)
  })

  test('um ano que só existe no peer é buscado por inteiro', async ({ page }) => {
    await seed(
      peerPage,
      vaultFixture('2026-01-01T00:00:00.000Z', [
        SHARED_TX,
        tx('tx-2019-a', '2019-02-01', 10, '2019-02-01T10:00:00.000Z'),
        tx('tx-2019-b', '2019-11-20', 20, '2019-11-20T10:00:00.000Z'),
      ])
    )
    await seed(page, vaultFixture('2026-06-30T00:00:00.000Z', [SHARED_TX]))

    const outcome = await mergePeerTree(page, await publishTree(peerPage, 'device-peer'))

    expect(outcome.fetchedKeys).toEqual(['transactions:2019'])
    expect(outcome.txIds).toEqual(['tx-2019-a', 'tx-2019-b', 'tx-compartilhada'])
  })

  // A pré-condição de que todo o hash-skip depende, provada de ponta a ponta: duas linhas
  // **idênticas em todo campo exceto `updatedAt`** têm de produzir hashes diferentes. Se não
  // produzissem, a partição seria pulada, a versão mais nova nunca chegaria, e o LWW simplesmente
  // não aconteceria — perda silenciosa, sem erro em lugar nenhum. Só o campo em teste varia aqui:
  // qualquer outra diferença faria o hash divergir por outro motivo e mascararia a falha.
  test('diverge quando a ÚNICA diferença entre os cofres é o updatedAt', async ({ page }) => {
    const base = { id: 'tx-disputada', date: '2026-03-10', amount: 500 }
    await seed(
      peerPage,
      vaultFixture('2026-01-01T00:00:00.000Z', [
        tx(base.id, base.date, base.amount, '2026-08-20T10:00:00.000Z'),
      ])
    )
    await seed(
      page,
      vaultFixture('2026-06-30T00:00:00.000Z', [
        tx(base.id, base.date, base.amount, '2026-01-05T10:00:00.000Z'),
      ])
    )

    const outcome = await mergePeerTree(page, await publishTree(peerPage, 'device-peer'))

    expect(outcome.fetchedKeys).toEqual(['transactions:2026'])
    const updatedAt = await page.evaluate(async () => {
      const data = await (window as Win).__storage.loadDataFile()
      return data.transactions.find((t: { id: string }) => t.id === 'tx-disputada').updatedAt
    })
    expect(updatedAt).toBe('2026-08-20T10:00:00.000Z')
  })

  // Conteúdo idêntico com `updatedAt` diferente **deve** divergir: o merge é LWW por esse campo, e
  // tratar as duas versões como iguais escolheria uma arbitrariamente. É o fenômeno que apareceu na
  // telemetria do CS-36 (o `sync_gimbo.py` carimba `updated_at` a cada execução), aqui fixado como
  // comportamento correto em vez de suspeita.
  test('mesma transação com updatedAt diferente diverge, e o mais novo vence', async ({ page }) => {
    await seed(
      peerPage,
      vaultFixture('2026-01-01T00:00:00.000Z', [
        tx('tx-disputada', '2026-03-10', 999, '2026-08-20T10:00:00.000Z'),
      ])
    )
    await seed(
      page,
      vaultFixture('2026-06-30T00:00:00.000Z', [
        tx('tx-disputada', '2026-03-10', 111, '2026-01-05T10:00:00.000Z'),
      ])
    )

    const outcome = await mergePeerTree(page, await publishTree(peerPage, 'device-peer'))

    expect(outcome.fetchedKeys).toEqual(['transactions:2026'])
    const amount = await page.evaluate(async () => {
      const data = await (window as Win).__storage.loadDataFile()
      return data.transactions.find((t: { id: string }) => t.id === 'tx-disputada').amount
    })
    expect(amount).toBe(999)
  })

  /**
   * **Registra um achado real, não o comportamento desejado.** Este teste foi escrito esperando
   * convergência e falhou — o que ele fixa agora é o bug, e ele deve falhar de novo quando o bug
   * for corrigido (ver `CS-56` no BACKLOG).
   *
   * Uma linha que chega sem `createdAt` recebe o `fileCreatedAt` **do cofre que a gravou**, que é
   * diferente em cada dispositivo. O merge é LWW por `updatedAt`, então esse campo converge — mas
   * o upsert de `applyTransactionDelta` tem `created_at` **fora** do `ON CONFLICT DO UPDATE SET`,
   * de propósito (data de criação não deveria mudar). Como `transactionRowKey` inclui `createdAt`,
   * o hash da partição nunca converge: os dois dispositivos rebuscam aquele ano a cada sync, para
   * sempre.
   *
   * Efeito é de performance, não de perda de dado — o merge continua correto. E há uma
   * inconsistência mais funda por trás: `diffTransactions` trata diferença de `createdAt` como
   * "mudou" e emite um upsert que a escrita então ignora, silenciosamente.
   */
  test('CS-56: linha sem createdAt nunca converge de hash entre cofres (bug registrado)', async ({
    page,
  }) => {
    const semTimestamp = {
      id: 'tx-sem-timestamps',
      accountId: 'acc-1',
      categoryId: 'cat-1',
      amount: 42,
      type: 'EXPENSE',
      date: '2026-04-01',
      description: 'Sem updatedAt nem createdAt',
      isPaid: true,
      tags: [],
      budgetIds: [],
    }
    await seed(peerPage, vaultFixture('2026-01-01T00:00:00.000Z', [semTimestamp]))
    await seed(page, vaultFixture('2026-06-30T00:00:00.000Z', [semTimestamp]))

    // Primeira rodada: divergem de verdade (são versões distintas pelo LWW) e o mais novo vence.
    expect((await mergePeerTree(page, await publishTree(peerPage, 'peer'))).fetchedKeys).toEqual([
      'transactions:2026',
    ])
    await mergePeerTree(peerPage, await publishTree(page, 'local'))

    const rows = async (target: Page) =>
      target.evaluate(async () => {
        const t = (await (window as Win).__storage.loadDataFile()).transactions[0]
        return { updatedAt: t.updatedAt, createdAt: t.createdAt }
      })
    const [localRow, peerRow] = [await rows(page), await rows(peerPage)]

    // `updatedAt` convergiu — o LWW funcionou.
    expect(localRow.updatedAt).toBe(peerRow.updatedAt)
    // `createdAt` não, porque o upsert o preserva. É a causa do que vem a seguir.
    expect(localRow.createdAt).not.toBe(peerRow.createdAt)

    // Consequência: mesmo conteúdo lógico, hash eternamente divergente.
    const terceira = await mergePeerTree(page, await publishTree(peerPage, 'peer'))
    expect(terceira.fetchedKeys).toEqual(['transactions:2026'])
  })
})
