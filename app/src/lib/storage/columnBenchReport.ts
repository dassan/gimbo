// HY/Fase 0 — leitura humana do resultado de `benchColumns()`.
//
// Separado de `columnBench.ts` porque aquele módulo é importado pelo worker, que não tem por que
// carregar formatação de console. Aqui mora só apresentação: os números crus continuam no objeto
// devolvido e na linha JSON impressa no fim.

import type {
  BenchSample,
  ColumnBenchResult,
  PageSizeBenchResult,
  WriteBenchResult,
} from './columnBench'

function speedup(from: BenchSample | undefined, to: BenchSample | undefined): string {
  if (!from || !to || to.medianMs <= 0) return '—'
  return `${(from.medianMs / to.medianMs).toFixed(2)}x`
}

/**
 * Imprime as duas metades da medição, o teste de linearidade e as comparações que decidem o épico:
 * podar coluna, podar ano, e ler o mesmo total em lotes. Devolve o resultado cru.
 */
export function printColumnBench(result: ColumnBenchResult): ColumnBenchResult {
  const by = (name: string) => result.worker.find((s) => s.name === name)

  const rows = result.worker.map((sample) => {
    const e2e = result.endToEnd.find((s) => s.name === sample.name)
    return {
      variante: sample.name,
      colunas: sample.columns,
      recorte: sample.scope,
      lotes: sample.chunks,
      linhas: sample.rows,
      'worker (ms)': Number(sample.medianMs.toFixed(1)),
      'ida-e-volta (ms)': e2e ? Number(e2e.medianMs.toFixed(1)) : null,
      'fronteira (ms)': e2e ? Number((e2e.medianMs - sample.medianMs).toFixed(1)) : null,
    }
  })

  /* eslint-disable no-console -- este módulo é a saída da ferramenta de medição; o console é o
     canal, não um resquício de depuração. Só roda sob o gate `?bench`. */
  const rounds = result.rounds === 1 ? '1 rodada' : `${result.rounds} rodadas`
  console.info(
    `[gimbo] bench de leitura — ${result.rows} transações (${result.yearSpan[0]}-${result.yearSpan[1]}), mediana de ${rounds} permutadas`
  )
  console.table(rows)

  if (result.linearity) {
    const { rowRatio, timeRatio, exponent } = result.linearity
    console.info(
      `[gimbo] linearidade — ${rowRatio.toFixed(1)}x mais linhas custaram ${timeRatio.toFixed(1)}x ` +
        `mais tempo (expoente ${exponent.toFixed(2)}; 1,00 seria proporcional)`
    )
    if (exponent > 1.3) {
      console.info(
        '[gimbo] custo super-linear no tamanho do resultado: o modelo por célula abaixo NÃO ' +
          'descreve estes dados — ler em lotes deve valer mais que ler menos colunas'
      )
    }
  }

  if (result.model) {
    console.info(
      `[gimbo] modelo linear (só válido com expoente ≈1) — ${result.model.perCellUs.toFixed(2)}µs ` +
        `por célula, ${result.model.perRowUs.toFixed(2)}µs por linha, ${result.model.fixedMs.toFixed(1)}ms fixos`
    )
  }

  const chunked = result.worker.filter((s) => s.scope === 'chunked')
  console.info(
    `[gimbo] ganho — podar coluna (20→9): ${speedup(by('all20'), by('core9'))} · ` +
      `podar ano (janela de 2 anos): ${speedup(by('all20'), by('all20win'))}`
  )
  if (chunked.length > 0) {
    console.info(
      `[gimbo] ganho — mesmas ${result.rows} linhas em lotes: ` +
        chunked
          .map((s) => `${s.chunks} lotes ${speedup(by('all20'), s)} (${s.medianMs.toFixed(0)}ms)`)
          .join(' · ')
    )
  }

  // Uma linha copiável: o resultado desta ferramenta existe para ser comparado com outra coleta
  // (outro navegador, o celular, depois de uma otimização), e ninguém copia uma tabela de console.
  console.info('[gimbo] copie a linha abaixo para registrar a coleta:')
  console.log(JSON.stringify(result))
  /* eslint-enable no-console */

  return result
}

/**
 * Imprime o resultado do `benchPageSize()`. A leitura que interessa é a coluna `frio`: é o que o
 * boot paga. `quente` com cache grande, sem páginas para ler, é o piso de materialização.
 */
export function printPageSizeBench(result: PageSizeBenchResult): PageSizeBenchResult {
  const control = result.entries.find((e) => e.label === 'p4096')

  /* eslint-disable no-console -- saída da ferramenta de medição, sob o gate `?bench`. */
  console.info('[gimbo] custo por página — sobre cópias do cofre, nunca sobre o cofre real')
  console.table(
    result.entries.map((entry) => ({
      variante: entry.label,
      'página (B)': entry.pageSize,
      páginas: entry.pageCount,
      'cache (KiB)': entry.cacheSizeKb,
      'frio (ms)': Number(entry.coldMs.toFixed(1)),
      'quente (ms)': Number(entry.warmMs.toFixed(1)),
      linhas: entry.rows,
      'ganho a frio': control ? `${(control.coldMs / entry.coldMs).toFixed(2)}x` : '—',
    }))
  )

  if (control) {
    const cached = result.entries.find((e) => e.label === 'p4096+cache')
    if (cached) {
      const pageShare = ((control.coldMs - cached.warmMs) / control.coldMs) * 100
      console.info(
        `[gimbo] das ${control.coldMs.toFixed(0)}ms da leitura fria, ~${pageShare.toFixed(0)}% são ` +
          `leitura de página (o resto é materializar ${control.rows} linhas: ${cached.warmMs.toFixed(0)}ms)`
      )
    }
  }
  console.info(`[gimbo] VACUUM para 64KB custou ${result.vacuumMs.toFixed(0)}ms — pago uma vez`)
  console.info('[gimbo] copie a linha abaixo para registrar a coleta:')
  console.log(JSON.stringify(result))
  /* eslint-enable no-console */

  return result
}

/**
 * Imprime a troca completa: quanto a leitura ganha e quanto a escrita perde, por tamanho de página.
 * A decisão está na comparação entre a coluna `leitura fria` e a coluna `update 1`.
 */
export function printWriteBench(result: WriteBenchResult): WriteBenchResult {
  const base = result.entries.find((e) => !e.vacuumed) ?? result.entries[0]
  // Pedido × efetivo: WAL só pega com `locking_mode=exclusive` nesta VFS, e o SQLite recusa em
  // silêncio. Comparar os dois é o que revela um pragma que não pegou.
  const wrongMode = result.entries.filter(
    (e) => (e.lockingMode === 'exclusive') !== (e.journalMode === 'wal')
  )

  /* eslint-disable no-console -- saída da ferramenta de medição, sob o gate `?bench`. */
  console.info(
    `[gimbo] leitura × escrita por tamanho de página — mediana de ${result.rounds} updates de linha única`
  )
  if (wrongMode.length > 0) {
    console.info(
      `[gimbo] ATENÇÃO: ${wrongMode.length} variante(s) não entraram no journal mode pedido ` +
        `(efetivo: "${wrongMode[0].journalMode}", locking: "${wrongMode[0].lockingMode}") — ` +
        'o SQLite recusa WAL sem memória compartilhada e devolve o modo atual sem erro'
    )
  }
  console.table(
    result.entries.map((entry) => ({
      variante: entry.label,
      journal: entry.journalMode,
      'página (B)': entry.pageSize,
      páginas: entry.pageCount,
      'leitura fria (ms)': Number(entry.coldReadMs.toFixed(1)),
      'rehash do ano (ms)': Number(entry.yearRehashMs.toFixed(1)),
      'update 1 (ms)': Number(entry.update1Ms.toFixed(2)),
      'update 50 (ms)': Number(entry.update50Ms.toFixed(1)),
      'WAL (KB)': Math.round(entry.walBytes / 1024),
      'checkpoint (ms)': Number(entry.checkpointMs.toFixed(1)),
      'VACUUM (ms)': Number(entry.vacuumMs.toFixed(0)),
    }))
  )

  if (base) {
    for (const entry of result.entries) {
      if (entry.label === base.label) continue
      const read = base.coldReadMs / entry.coldReadMs
      const write = entry.update1Ms / base.update1Ms
      console.info(
        `[gimbo] ${entry.label} — leitura ${read.toFixed(2)}x mais rápida, ` +
          `escrita ${write.toFixed(2)}x ${write >= 1 ? 'mais lenta' : 'mais rápida'}, ` +
          `WAL ${(entry.walBytes / Math.max(1, base.walBytes)).toFixed(1)}x`
      )
    }
    console.info(
      '[gimbo] a referência acima é o cofre como está (sem VACUUM) — a linha "p4096 + VACUUM" ' +
        'separa o ganho de desfragmentar do ganho de trocar o tamanho de página'
    )
  }

  console.info('[gimbo] copie a linha abaixo para registrar a coleta:')
  console.log(JSON.stringify(result))
  /* eslint-enable no-console */

  return result
}
