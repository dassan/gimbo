import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

// SEC-05/SEC-06 — regressão do import destrutivo.
//
// Antes destas correções, `importBlob()` fechava o banco e sobrescrevia `gimbo.db` no OPFS
// **antes** de verificar se os bytes recebidos eram sequer um SQLite válido. Um arquivo truncado,
// corrompido, ou capturado no meio de uma escrita do cliente de nuvem apagava permanentemente
// todo o histórico financeiro, e a UI só dizia "arquivo corrompido" depois do dado ter sumido.
//
// Estes testes rodam contra o browser real de propósito: a camada de storage é um Web Worker com
// OPFS, que os testes unitários (jsdom, sem `Worker`) tratam como no-op — nenhum deles conseguiria
// pegar uma regressão aqui.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataFile = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures/dataFile.json'), 'utf-8')
) as Record<string, unknown>

type Win = Record<string, unknown>

async function seedSqlite(page: import('@playwright/test').Page, data: Record<string, unknown>) {
  await page.goto('/onboarding')
  await page.waitForFunction(() => !!(window as Win).__storage)
  await page.evaluate((d) => (window as Win).__storage.replaceAll(d), data)
}

/** Conta as transações que o cofre local devolve agora — a prova de que os dados sobreviveram. */
async function transactionCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(async () => {
    const file = await (window as Win).__storage.loadDataFile()
    return (file?.transactions as unknown[] | undefined)?.length ?? -1
  })
}

/** Tenta importar `bytes` e devolve a mensagem de erro, ou null se (indevidamente) tiver passado. */
async function importAndCaptureError(
  page: import('@playwright/test').Page,
  bytes: number[]
): Promise<string | null> {
  return page.evaluate(async (b) => {
    const blob = new Blob([new Uint8Array(b)], { type: 'application/x-sqlite3' })
    try {
      await (window as Win).__storage.importBlob(blob)
      return null
    } catch (err) {
      return String(err)
    }
  }, bytes)
}

test.describe('SEC-05 — import valida antes de tocar no cofre', () => {
  test('arquivo que não é SQLite é rejeitado e o cofre sobrevive intacto', async ({ page }) => {
    await seedSqlite(page, dataFile)
    const before = await transactionCount(page)
    expect(before).toBeGreaterThan(0)

    // Lixo puro: nem o header "SQLite format 3\0" está presente.
    const error = await importAndCaptureError(page, [...Buffer.from('isto nao e um banco de dados')])

    expect(error).not.toBeNull()
    expect(await transactionCount(page)).toBe(before)
  })

  test('SQLite válido porém sem o schema do Gimbo é rejeitado e o cofre sobrevive', async ({
    page,
  }) => {
    await seedSqlite(page, dataFile)
    const before = await transactionCount(page)

    // Header de SQLite correto seguido de lixo — abre como arquivo, mas não é um banco utilizável.
    // Cobre o caso que "checar só os magic bytes" deixaria passar.
    const header = [...Buffer.from('SQLite format 3\0', 'binary')]
    const error = await importAndCaptureError(page, [...header, ...new Array<number>(512).fill(0x41)])

    expect(error).not.toBeNull()
    expect(await transactionCount(page)).toBe(before)
  })

  test('arquivo truncado no meio é rejeitado e o cofre sobrevive', async ({ page }) => {
    await seedSqlite(page, dataFile)
    const before = await transactionCount(page)

    // Simula o cenário real que motivou o item: um `.db` lido enquanto o cliente de nuvem ainda
    // estava escrevendo. Exporta o cofre de verdade e corta os bytes pela metade.
    const truncated = await page.evaluate(async () => {
      const blob: Blob = await (window as Win).__storage.exportBlob()
      const buf = new Uint8Array(await blob.arrayBuffer())
      return [...buf.slice(0, Math.floor(buf.length / 2))]
    })

    const error = await importAndCaptureError(page, truncated)

    expect(error).not.toBeNull()
    expect(await transactionCount(page)).toBe(before)
  })

  test('import de um backup válido continua funcionando', async ({ page }) => {
    await seedSqlite(page, dataFile)

    // Guarda um export legítimo, sobrescreve o cofre com um estado diferente, e restaura — o
    // caminho feliz não pode ter sido quebrado pelo staging.
    const good = await page.evaluate(async () => {
      const blob: Blob = await (window as Win).__storage.exportBlob()
      return [...new Uint8Array(await blob.arrayBuffer())]
    })
    const before = await transactionCount(page)
    expect(before).toBeGreaterThan(0)

    // Substitui por um cofre sem lançamentos (em vez de `clearAll()`, que zera também `settings`
    // e faz `loadDataFile()` devolver null — estado que não distingue "vazio" de "ausente").
    await page.evaluate((d) => (window as Win).__storage.replaceAll({ ...d, transactions: [] }), dataFile)
    expect(await transactionCount(page)).toBe(0)

    const error = await importAndCaptureError(page, good)
    expect(error).toBeNull()
    expect(await transactionCount(page)).toBe(before)
  })
})

test.describe('SEC-06 — guarda de versão de schema', () => {
  test('backup de uma versão futura do app é recusado sem tocar no cofre', async ({ page }) => {
    await seedSqlite(page, dataFile)
    const before = await transactionCount(page)
    expect(before).toBeGreaterThan(0)

    // Exporta um backup legítimo e sobe o `user_version` para 99 — offset 60 do header do SQLite,
    // 4 bytes big-endian. Simula um `.db` escrito por um build mais novo, que este build não sabe
    // migrar: antes do SEC-06 ele era aberto e lido contra o schema velho, em silêncio.
    const fromFuture = await page.evaluate(async () => {
      const blob: Blob = await (window as Win).__storage.exportBlob()
      const buf = new Uint8Array(await blob.arrayBuffer())
      new DataView(buf.buffer).setUint32(60, 99, /* littleEndian */ false)
      return [...buf]
    })

    const error = await importAndCaptureError(page, fromFuture)

    expect(error).not.toBeNull()
    // Marcador dedicado: a UI usa isto para dizer "atualize o app", e não "arquivo corrompido".
    expect(error).toContain('GIMBO_SCHEMA_TOO_NEW')
    expect(await transactionCount(page)).toBe(before)
  })
})

test.describe('SEC-06 — resgate quando o banco não abre', () => {
  test('exportRawBlob devolve os bytes do cofre sem depender do caminho normal', async ({
    page,
  }) => {
    await seedSqlite(page, dataFile)

    const raw = await page.evaluate(async () => {
      const blob: Blob = await (window as Win).__storage.exportRawBlob()
      const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
      return { size: blob.size, header: String.fromCharCode(...head) }
    })

    // Um SQLite de verdade começa com este magic string — é o que garante que o resgate entrega
    // um arquivo reimportável, e não um blob vazio.
    expect(raw.header).toBe('SQLite format 3\0')
    expect(raw.size).toBeGreaterThan(0)
  })
})
