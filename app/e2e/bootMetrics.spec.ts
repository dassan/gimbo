import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataFile = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures/dataFile.json'), 'utf-8')
) as Record<string, unknown>

// M-87 — instrumentação do boot (`lib/bootMetrics.ts`, sempre ativa; fases do worker publicadas
// por `services/storage/worker.ts` no canal `bootPerf`).
//
// O que este spec protege não é um número (o tempo de boot depende da máquina e do cofre, e um
// limiar aqui só produziria flakiness), e sim que a **linha do tempo continue completa e em
// ordem**: se uma fase parar de ser publicada, ou passar a ser medida no lugar errado, um boot
// lento volta a ser indiagnosticável — que era a situação antes deste item. `window.__telemetry`
// é dev-only, mesmo padrão de `__storage`/`__syncTest`.

type PerfEvent = { type: string; metric: string; ms: number }

declare global {
  interface Window {
    __telemetry: { getSnapshot: () => PerfEvent[]; clearBuffer: () => void }
    __storage: { replaceAll: (data: unknown) => Promise<void> }
  }
}

async function bootMetrics(page: import('@playwright/test').Page): Promise<Map<string, number>> {
  const events = await page.evaluate(() =>
    window.__telemetry
      .getSnapshot()
      .filter(
        (e) =>
          e.type === 'performance' &&
          (e.metric.startsWith('boot.') || e.metric.startsWith('storage.'))
      )
  )
  // Em dev o StrictMode invoca o efeito de boot duas vezes: para as durações, a primeira
  // ocorrência é a que corresponde ao boot de verdade.
  const byMetric = new Map<string, number>()
  for (const e of events) if (!byMetric.has(e.metric)) byMetric.set(e.metric, e.ms)
  return byMetric
}

test('o boot publica a linha do tempo completa, da partida do script até a tela pintada', async ({
  page,
}) => {
  await page.goto('/onboarding')
  await page.waitForFunction(() => !!window.__storage)
  await page.evaluate((d) => window.__storage.replaceAll(d), dataFile)

  await page.goto('/dashboard')
  await page.waitForFunction(
    () => window.__telemetry.getSnapshot().some((e) => e.metric === 'boot.appVisible'),
    null,
    { timeout: 15000 }
  )

  const m = await bootMetrics(page)

  // Fases da thread principal.
  for (const metric of [
    'boot.scriptStart',
    'boot.shellVisible',
    'boot.blankWindow',
    'boot.storageReady',
    'boot.loadDataFile',
    'boot.hydrateStore',
    'boot.derive',
    'boot.dataReady',
    'boot.firstRender',
    'boot.appVisible',
  ]) {
    expect(m.has(metric), `faltou a métrica ${metric}`).toBe(true)
  }

  // M-91: o detalhamento de dentro do `loadDataFile()`. Sem ele, a fase que domina o boot (80-87%
  // do total) é um bloco opaco e qualquer tentativa de otimizá-la mede o alvo errado.
  for (const metric of [
    'storage.loadDataFile.transactions',
    'storage.getTransactions.rows',
    'storage.getTransactions.map',
  ]) {
    expect(m.has(metric), `faltou a métrica ${metric}`).toBe(true)
  }
  expect(m.get('storage.getTransactions.rows')!).toBeLessThanOrEqual(
    m.get('storage.loadDataFile.transactions')!
  )

  // Fases do worker — chegam pelo canal `bootPerf`, que é o único caminho pelo qual o custo de
  // partida do wa-sqlite/OPFS cruza a fronteira do worker.
  for (const metric of [
    'boot.worker.wasm',
    'boot.worker.openDb',
    'boot.worker.migrations',
    'boot.worker.tableHashes',
    'boot.worker.total',
  ]) {
    expect(m.has(metric), `faltou a métrica ${metric}`).toBe(true)
  }

  // Ordem dos marcos: script → dados prontos → primeiro render → tela pintada. Uma inversão aqui
  // significa que alguma marca foi parar no lugar errado do ciclo de vida.
  expect(m.get('boot.scriptStart')!).toBeLessThanOrEqual(m.get('boot.shellVisible')!)
  expect(m.get('boot.shellVisible')!).toBeLessThanOrEqual(m.get('boot.appVisible')!)
  expect(m.get('boot.scriptStart')!).toBeLessThanOrEqual(m.get('boot.dataReady')!)
  expect(m.get('boot.dataReady')!).toBeLessThanOrEqual(m.get('boot.firstRender')!)
  expect(m.get('boot.firstRender')!).toBeLessThanOrEqual(m.get('boot.appVisible')!)

  // As fases somadas não podem ultrapassar o instante em que os dados ficaram prontos — é o que
  // garante que `boot.loadDataFile` e `boot.storageReady` estão medindo trechos do boot, e não
  // trabalho que continua acontecendo depois dele.
  const fases = m.get('boot.storageReady')! + m.get('boot.loadDataFile')! + m.get('boot.derive')!
  expect(fases).toBeLessThanOrEqual(m.get('boot.dataReady')!)

  // M-90: a janela em branco tem que fechar no esqueleto, não na interface — é a diferença entre
  // tempo percebido e tempo total. Se ela crescer até `boot.appVisible`, o esqueleto parou de
  // pintar antes da hidratação e o ganho de percepção evaporou.
  expect(m.get('boot.blankWindow')!).toBeLessThan(m.get('boot.appVisible')!)

  // O detalhamento do worker cabe dentro do total dele, que cabe dentro do `storageReady` visto
  // da thread principal (a diferença é a partida do próprio worker: fetch e parse do módulo).
  expect(m.get('boot.worker.wasm')!).toBeLessThanOrEqual(m.get('boot.worker.total')!)
  expect(m.get('boot.worker.total')!).toBeLessThanOrEqual(m.get('boot.storageReady')!)
})

test('métricas de boot são registradas sem depender do toggle do PerfMonitor', async ({ page }) => {
  await page.goto('/onboarding')
  await page.waitForFunction(() => !!window.__storage)
  await page.evaluate(() => localStorage.removeItem('gimbo:perfMonitor'))
  await page.evaluate((d) => window.__storage.replaceAll(d), dataFile)

  await page.goto('/dashboard')
  await page.waitForFunction(
    () => window.__telemetry.getSnapshot().some((e) => e.metric === 'boot.appVisible'),
    null,
    { timeout: 15000 }
  )

  const m = await bootMetrics(page)
  expect(m.has('boot.loadDataFile')).toBe(true)
  // O toggle continua desligado — o que separa esta camada de `lib/perfMonitor.ts`.
  expect(await page.evaluate(() => localStorage.getItem('gimbo:perfMonitor'))).toBeNull()
})
