// HY/Fase 0 — instrumentação de custo de leitura de `transactions`.
//
// Nasceu para responder se o custo de materialização é dominado pela **célula** (poda de colunas
// resolveria) ou pela **linha**. A primeira coleta real, no cofre de 26.576 transações, respondeu:
//
// - **poda de coluna não paga** — 20 → 9 colunas rendeu 1,0-1,2x, dentro do ruído das amostras;
// - **o custo é super-linear no tamanho do resultado** — as mesmas 20 colunas custaram 225ms para
//   4.673 linhas e 8.622ms para 26.576 (5,7x mais linhas, **38x** mais tempo). No SQLite nativo,
//   sobre o mesmo arquivo, a mesma razão é 5,8x — proporcional. A não-linearidade é do
//   wa-sqlite/JS, não do SQLite: `SELECT id` usa índice de cobertura (nunca toca a tabela) e ainda
//   assim custa 1.856ms no navegador contra 18ms nativo. O que custa é **produzir N linhas em JS**.
//
// Daí a segunda pergunta, que estas variantes existem para responder: se o custo cresce mais que
// linearmente com o tamanho do resultado, **ler o mesmo total em K lotes deveria recuperar o
// regime linear** — sem janela, sem `DataFile` parcial, sem guarda de escrita, sem agregados.

/**
 * As colunas de que saldo + Dashboard precisam. Mantidas mesmo depois de a poda de colunas ter sido
 * reprovada: são o controle que sustenta essa conclusão, e uma coleta futura noutro dispositivo
 * pode contradizê-la.
 */
export const BENCH_CORE_COLUMNS = [
  'id',
  'account_id',
  'category_id',
  'amount',
  'type',
  'date',
  'is_paid',
  'transfer_account_id',
  'reference_month',
] as const

/** Quantos lotes as variantes de leitura fatiada usam. 1 seria a leitura inteira (já é `all20`). */
export const BENCH_CHUNK_COUNTS = [2, 5, 20] as const

export interface BenchStep {
  sql: string
  params: string[]
}

export interface BenchVariant {
  /** Rótulo curto, usado como chave no resultado. */
  name: string
  /** Consultas executadas em sequência e cronometradas **como um todo**. */
  steps: BenchStep[]
  /** Colunas materializadas por linha. */
  columns: number
  scope: 'full' | 'window' | 'chunked'
}

/**
 * Janela da onda 1 tal como a Fase 4 a define: **conjunto de anos**, sempre `{ano corrente, ano
 * anterior}`. O ano anterior não é folga — `getInvoicePeriod` rola a fatura para frente, então em
 * janeiro a fatura corrente contém compras de dezembro do ano passado, e um corte em 1º de janeiro
 * mostraria limite disponível errado o mês inteiro.
 */
export function benchWindowRange(currentYear: number): [string, string] {
  return [`${currentYear - 1}-01-01`, `${currentYear + 1}-01-01`]
}

/**
 * Divide o intervalo de anos do cofre em `count` faixas contíguas, cobrindo tudo exatamente uma
 * vez. Divide por **quantidade de anos**, não por linhas — é a fatia que o app de fato usaria
 * (mesma chave de partição do `table_hashes`), e um ano vazio custa uma busca de índice que não
 * devolve nada.
 */
export function chunkYearRanges(
  minYear: number,
  maxYear: number,
  count: number
): [string, string][] {
  const years = maxYear - minYear + 1
  const chunks = Math.max(1, Math.min(count, years))
  const ranges: [string, string][] = []
  let start = minYear
  for (let i = 0; i < chunks; i++) {
    // Distribui o resto nos primeiros lotes, para nenhum ficar vazio.
    const size = Math.floor(years / chunks) + (i < years % chunks ? 1 : 0)
    ranges.push([`${start}-01-01`, `${start + size}-01-01`])
    start += size
  }
  return ranges
}

/**
 * As variantes do A/B. `count` fica fora do ajuste de custo (materializa 1 linha, não N) e serve de
 * piso — note que ele usa índice de cobertura e nunca toca a tabela, então **não** prova que ler o
 * arquivo é barato, ao contrário do que o `M-91` inferiu dele.
 */
export function benchVariants(
  currentYear: number,
  minYear: number,
  maxYear: number
): BenchVariant[] {
  const core = BENCH_CORE_COLUMNS.join(', ')
  const window = benchWindowRange(currentYear)
  const inWindow = 'WHERE date >= ? AND date < ?'
  const one = (sql: string, params: string[] = []): BenchStep[] => [{ sql, params }]

  const variants: BenchVariant[] = [
    { name: 'count', steps: one('SELECT COUNT(*) FROM transactions'), columns: 0, scope: 'full' },
    { name: 'id', steps: one('SELECT id FROM transactions'), columns: 1, scope: 'full' },
    {
      name: 'core9',
      steps: one(`SELECT ${core} FROM transactions`),
      columns: BENCH_CORE_COLUMNS.length,
      scope: 'full',
    },
    { name: 'all20', steps: one('SELECT * FROM transactions'), columns: 20, scope: 'full' },
    {
      name: 'core9win',
      steps: one(`SELECT ${core} FROM transactions ${inWindow}`, window),
      columns: BENCH_CORE_COLUMNS.length,
      scope: 'window',
    },
    {
      name: 'all20win',
      steps: one(`SELECT * FROM transactions ${inWindow}`, window),
      columns: 20,
      scope: 'window',
    },
  ]

  // Leitura fatiada: mesmo total de linhas que `all20`, em K consultas. É a hipótese que a primeira
  // coleta abriu — se o custo é super-linear no tamanho do resultado, isto tem que ser mais barato
  // que a leitura única, e o quanto diz onde fica o joelho da curva.
  // O nome carrega o número **real** de lotes, não o pedido: num cofre curto, `chunkYearRanges`
  // devolve menos faixas que o pedido, e sem esta deduplicação dois tamanhos diferentes gerariam
  // variantes homônimas que se atropelariam no mapa de amostras. Um lote só é a leitura inteira
  // (`all20`), então não vira variante.
  const seenChunks = new Set<number>()
  for (const count of BENCH_CHUNK_COUNTS) {
    const ranges = chunkYearRanges(minYear, maxYear, count)
    if (ranges.length < 2 || seenChunks.has(ranges.length)) continue
    seenChunks.add(ranges.length)
    variants.push({
      name: `all20x${ranges.length}`,
      steps: ranges.map((params) => ({
        sql: `SELECT * FROM transactions ${inWindow}`,
        params,
      })),
      columns: 20,
      scope: 'chunked',
    })
  }

  return variants
}

export interface BenchSample {
  name: string
  columns: number
  scope: 'full' | 'window' | 'chunked'
  /** Consultas executadas — 1 para tudo que não é leitura fatiada. */
  chunks: number
  /** Linhas devolvidas, somadas entre os lotes. */
  rows: number
  samples: number[]
  medianMs: number
}

export interface BenchCostModel {
  fixedMs: number
  perCellUs: number
  perRowUs: number
}

/**
 * Compara a leitura inteira com a mesma consulta sobre a janela. Se o custo fosse proporcional às
 * linhas, `timeRatio` seria igual a `rowRatio` e o expoente daria 1. A primeira coleta real deu
 * **2,1** — quadrático —, o que invalida qualquer modelo linear por célula sobre estes dados.
 */
export interface BenchLinearity {
  rowRatio: number
  timeRatio: number
  exponent: number
}

export interface ColumnBenchResult {
  rows: number
  rounds: number
  yearSpan: [number, number]
  /** Só as consultas dentro do worker. */
  worker: BenchSample[]
  /** Ida e volta completa: worker + `postMessage` + montagem de objeto na thread principal. */
  endToEnd: BenchSample[]
  model: BenchCostModel | null
  linearity: BenchLinearity | null
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Permutação determinística por rodada.
 *
 * A primeira versão disto rotacionava a lista, o que **não intercala nada**: girar uma sequência
 * cíclica preserva o antecessor de cada elemento, e na coleta real isso apareceu como uma variante
 * de 4.673 linhas custando 8x mais que a mesma consulta com *mais* colunas — ela rodava sempre
 * logo depois da leitura de 26.576 linhas e herdava a conta de memória dela. Uma permutação de
 * verdade é o que faz a mediana entre rodadas significar alguma coisa.
 */
export function permute<T>(items: T[], round: number): T[] {
  const out = [...items]
  let seed = ((round + 1) * 2654435761) >>> 0
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const j = seed % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Ajusta `ms = fixo + colunas × (linhas × custo_por_célula)` sobre as variantes de tabela inteira.
 *
 * **Só é significativo se `linearity()` der expoente perto de 1.** Sobre dados super-lineares o
 * ajuste continua produzindo números — foi o que aconteceu na primeira coleta, onde ele reportou
 * 2,5s de custo "fixo" para uma consulta cujo piso medido era 87ms. O relatório avisa.
 */
export function fitCostModel(samples: BenchSample[], rows: number): BenchCostModel | null {
  const points = samples.filter((s) => s.scope === 'full' && s.columns > 0)
  const distinct = new Set(points.map((p) => p.columns))
  if (points.length < 2 || distinct.size < 2 || rows <= 0) return null

  const n = points.length
  const sumX = points.reduce((acc, p) => acc + p.columns, 0)
  const sumY = points.reduce((acc, p) => acc + p.medianMs, 0)
  const sumXY = points.reduce((acc, p) => acc + p.columns * p.medianMs, 0)
  const sumXX = points.reduce((acc, p) => acc + p.columns * p.columns, 0)

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX)
  const intercept = (sumY - slope * sumX) / n

  const floor = samples.find((s) => s.name === 'count')?.medianMs ?? 0
  return {
    fixedMs: intercept,
    perCellUs: (slope / rows) * 1000,
    perRowUs: ((intercept - floor) / rows) * 1000,
  }
}

/** Expoente da curva custo × linhas, medido entre a leitura inteira e a mesma consulta na janela. */
export function linearity(samples: BenchSample[]): BenchLinearity | null {
  const full = samples.find((s) => s.name === 'all20')
  const window = samples.find((s) => s.name === 'all20win')
  if (!full || !window || window.rows <= 0 || window.medianMs <= 0) return null
  if (full.rows <= window.rows) return null

  const rowRatio = full.rows / window.rows
  const timeRatio = full.medianMs / window.medianMs
  return { rowRatio, timeRatio, exponent: Math.log(timeRatio) / Math.log(rowRatio) }
}

// ─── Custo por página lida (`HY-16`) ─────────────────────────────────────────
//
// A coleta de 2026-08-29 refutou a leitura em lotes — fatiar as mesmas 26.576 linhas em 2, 5 ou 20
// consultas ficou **mais lento** que a leitura única. Isso elimina "acúmulo do resultado em JS"
// como causa da super-linearidade e deixa uma explicação que fecha com todos os números:
//
//   custo ≈ páginas_lidas × (custo de uma travessia Asyncify) + linhas × (custo de materializar)
//
// `OriginPrivateFileSystemVFS.xRead` envolve **toda** leitura de página em `handleAsync()` — o
// unwind/rewind da pilha WASM inteira do Asyncify — mesmo com o `SyncAccessHandle` aberto, onde a
// leitura em si é instantânea. O cofre real tem 3.620 páginas de 4KB (a tabela ocupa 1.626), e o
// cache de páginas padrão do SQLite é de 2MB: a janela de 2 anos cabe nele e fica quente entre as
// rodadas (260ms ≈ só materialização), a tabela inteira não cabe e paga as páginas toda vez.
//
// Se isso estiver certo, o número de páginas é o gargalo — e `page_size` é uma alavanca de uma
// linha sobre ele: 4KB → 64KB são 16x menos travessias para os mesmos bytes. Estas medições
// decidem, sobre **cópias** do cofre em arquivo de rascunho, nunca sobre o cofre real.

/** A leitura que o boot faz, usada como carga nas medições de página. */
export const PAGE_BENCH_READ = 'SELECT * FROM transactions'

export interface PageSizeBenchEntry {
  label: string
  pageSize: number
  pageCount: number
  /** `PRAGMA cache_size` aplicado, em KiB (o padrão do SQLite é 2000). */
  cacheSizeKb: number
  /** Primeira leitura depois de abrir — nenhuma página em cache. É o que o boot paga. */
  coldMs: number
  /** Segunda leitura, com o cache já povoado até onde ele couber. */
  warmMs: number
  rows: number
}

export interface PageSizeBenchResult {
  entries: PageSizeBenchEntry[]
  /** Custo do `VACUUM` que reescreve o cofre com páginas maiores — pago uma vez, numa migration. */
  vacuumMs: number
}

// ─── Custo de escrita por tamanho de página (`HY-17`) ────────────────────────
//
// O `HY-16` mostrou que a leitura fria cai 5,3x com páginas de 64KB, porque o custo é a travessia
// Asyncify **por página** (2,06ms a 4KB, 2,43ms a 64KB — praticamente igual apesar de 16x mais
// bytes), e não os bytes. Falta o outro lado da moeda: página maior significa que **toda mutação
// reescreve 64KB onde antes reescrevia 4KB**.
//
// Isso bate no caminho que o usuário sente de verdade — `applyMutation` custa 79ms hoje (`M-73`) e
// roda a cada salvamento debounced, junto de um `_triggerLocalBackup`. Um boot 5x mais rápido não
// paga um salvamento 10x mais lento.
//
// A varredura mede 4 tamanhos porque a decisão provavelmente não é binária: se a leitura já ganha
// quase tudo em 16KB e a escrita ainda não doeu, o joelho da curva é a resposta, não o extremo.

/**
 * Variantes da varredura. O primeiro é o cofre **como está**, sem `VACUUM` — controle que separa
 * dois efeitos que a primeira coleta misturou: desfragmentar e trocar o tamanho de página. Se o
 * `VACUUM` sozinho já render, existe uma saída mais barata que qualquer bump de schema.
 *
 * `page_size` **não pode ser trocado por `VACUUM` com o banco em WAL** — o `VACUUM` roda, não
 * reclama, e o tamanho simplesmente não muda. Daí a ordem `page_size` → `VACUUM` → journal mode.
 *
 * O eixo de journal mode existe porque a investigação descobriu que o cofre **nunca esteve em
 * WAL**: `OriginPrivateFileSystemVFS` não implementa `xShmMap`/`xShmLock`, e sem memória
 * compartilhada o SQLite recusa WAL devolvendo o modo atual, sem erro — então o
 * `PRAGMA journal_mode=WAL` que o `worker.ts` roda em toda abertura é um no-op silencioso. WAL é
 * alcançável com `locking_mode=EXCLUSIVE`, e em WAL a transação não copia a página original para
 * um journal antes de gravar. Para escrita isso pode valer mais que o tamanho da página.
 */
export const WRITE_BENCH_VARIANTS = [
  { label: 'p4096 (como está)', pageSize: 4096, vacuum: false, wal: false },
  { label: 'p4096 + VACUUM', pageSize: 4096, vacuum: true, wal: false },
  { label: 'p16384', pageSize: 16384, vacuum: true, wal: false },
  { label: 'p32768', pageSize: 32768, vacuum: true, wal: false },
  { label: 'p65536', pageSize: 65536, vacuum: true, wal: false },
  { label: 'p4096 + WAL', pageSize: 4096, vacuum: true, wal: true },
  { label: 'p65536 + WAL', pageSize: 65536, vacuum: true, wal: true },
] as const

export interface WriteBenchEntry {
  label: string
  vacuumed: boolean
  pageSize: number
  pageCount: number
  /** Custo de reescrever o cofre com este tamanho de página — pago uma vez, numa migration. */
  vacuumMs: number
  /** Leitura fria completa: o lado que ganha. Repetido aqui para a troca aparecer numa tabela só. */
  coldReadMs: number
  /**
   * A releitura de um ano que `refreshTransactionYearHashesFromDb` faz **depois de toda mutação**
   * (`CS-32`). É leitura, mas é custo de escrita na prática — e deve melhorar com página maior.
   */
  yearRehashMs: number
  /**
   * `journal_mode` **efetivo** na conexão medida, lido de volta em vez de assumido. O app pede WAL
   * em toda abertura e recebe `delete` caladamente há tempos (ver `WRITE_BENCH_VARIANTS`), o que
   * só apareceu porque este campo existe.
   */
  journalMode: string
  /** `locking_mode` pedido — WAL só é alcançável nesta VFS com `exclusive`. */
  lockingMode: string
  /** Mediana de N updates de uma linha só, cada um numa transação diferente do histórico. */
  update1Ms: number
  /** Mediana de lotes de 50 updates espalhados numa transação — a forma de um merge de sync. */
  update50Ms: number
  /** Tamanho do WAL depois das escritas: a amplificação de escrita, medida em vez de suposta. */
  walBytes: number
  checkpointMs: number
}

export interface WriteBenchResult {
  rounds: number
  entries: WriteBenchEntry[]
}
