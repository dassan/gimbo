import { describe, it, expect } from 'vitest'
import {
  BENCH_CHUNK_COUNTS,
  BENCH_CORE_COLUMNS,
  benchVariants,
  benchWindowRange,
  chunkYearRanges,
  fitCostModel,
  linearity,
  median,
  permute,
  type BenchSample,
} from '@/lib/storage/columnBench'

function sample(
  name: string,
  columns: number,
  medianMs: number,
  scope: 'full' | 'window' | 'chunked',
  rows = 1000
): BenchSample {
  return { name, columns, scope, chunks: 1, rows, samples: [medianMs], medianMs }
}

describe('median', () => {
  it('takes the middle value of an odd-sized set, regardless of input order', () => {
    expect(median([9, 1, 5])).toBe(5)
  })

  it('averages the two middle values of an even-sized set', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it('does not mutate the caller array', () => {
    const values = [3, 1, 2]
    median(values)
    expect(values).toEqual([3, 1, 2])
  })

  it('returns NaN for an empty set instead of a misleading zero', () => {
    expect(median([])).toBeNaN()
  })
})

describe('permute', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f']

  it('keeps every element exactly once', () => {
    for (let round = 0; round < 5; round++) {
      expect([...permute(items, round)].sort()).toEqual([...items].sort())
    }
  })

  it('is deterministic for a given round', () => {
    expect(permute(items, 2)).toEqual(permute(items, 2))
  })

  it('breaks adjacency across rounds — the flaw that made rotation useless', () => {
    // Rotacionar uma lista preserva o antecessor de cada elemento, então a "intercalação" não
    // protegia de contaminação entre consultas vizinhas. Na coleta real isso apareceu como uma
    // variante de 4.673 linhas custando 8x mais que a mesma consulta com mais colunas, porque ela
    // rodava sempre logo depois da leitura completa.
    const neighbours = (order: string[]) => order.slice(1).map((x, i) => `${order[i]}>${x}`)
    const first = new Set(neighbours(permute(items, 0)))
    const second = neighbours(permute(items, 1))
    expect(second.some((pair) => !first.has(pair))).toBe(true)
  })

  it('handles an empty list', () => {
    expect(permute([], 3)).toEqual([])
  })
})

describe('chunkYearRanges', () => {
  it('cobre o intervalo inteiro, sem buraco nem sobreposição', () => {
    const ranges = chunkYearRanges(2015, 2034, 5)
    expect(ranges).toHaveLength(5)
    expect(ranges[0][0]).toBe('2015-01-01')
    expect(ranges[4][1]).toBe('2035-01-01')
    for (let i = 1; i < ranges.length; i++) expect(ranges[i][0]).toBe(ranges[i - 1][1])
  })

  it('distribui o resto para nenhum lote sair vazio', () => {
    const ranges = chunkYearRanges(2020, 2026, 4) // 7 anos em 4 lotes
    const sizes = ranges.map((r) => Number(r[1].slice(0, 4)) - Number(r[0].slice(0, 4)))
    expect(sizes).toEqual([2, 2, 2, 1])
  })

  it('nunca cria mais lotes que anos', () => {
    expect(chunkYearRanges(2025, 2026, 20)).toHaveLength(2)
  })

  it('lida com um cofre de um ano só', () => {
    expect(chunkYearRanges(2026, 2026, 5)).toEqual([['2026-01-01', '2027-01-01']])
  })
})

describe('linearity', () => {
  it('dá expoente 1 quando o custo é proporcional às linhas', () => {
    const samples = [
      sample('all20win', 20, 100, 'window', 1000),
      sample('all20', 20, 500, 'full', 5000),
    ]
    expect(linearity(samples)?.exponent).toBeCloseTo(1, 6)
  })

  it('detecta custo quadrático — a forma que a coleta real mostrou', () => {
    const samples = [
      sample('all20win', 20, 225, 'window', 4673),
      sample('all20', 20, 8622, 'full', 26576),
    ]
    const result = linearity(samples)
    expect(result?.exponent).toBeGreaterThan(2)
    expect(result?.timeRatio).toBeCloseTo(38.3, 1)
  })

  it('devolve null sem os dois pontos', () => {
    expect(linearity([sample('all20', 20, 500, 'full')])).toBeNull()
  })
})

describe('benchWindowRange', () => {
  it('spans the previous and current year as a half-open interval', () => {
    expect(benchWindowRange(2026)).toEqual(['2025-01-01', '2027-01-01'])
  })

  it('includes December of the previous year, which January invoices reach back into', () => {
    const [from] = benchWindowRange(2026)
    expect('2025-12-28' >= from).toBe(true)
  })
})

describe('benchVariants', () => {
  const variants = benchVariants(2026, 2015, 2034)

  it('cobre os três eixos: colunas, janela de anos e leitura em lotes', () => {
    expect(variants.map((v) => v.name)).toEqual([
      'count',
      'id',
      'core9',
      'all20',
      'core9win',
      'all20win',
      'all20x2',
      'all20x5',
      'all20x20',
    ])
    expect(variants.filter((v) => v.scope === 'chunked')).toHaveLength(BENCH_CHUNK_COUNTS.length)
  })

  it('filtra por intervalo, nunca por LIKE — CS-51: LIKE ignora o índice', () => {
    for (const variant of variants) {
      for (const step of variant.steps) {
        expect(step.sql).not.toContain('LIKE')
        if (step.params.length > 0) expect(step.sql).toContain('date >= ? AND date < ?')
      }
    }
  })

  it('a janela é o ano corrente mais o anterior', () => {
    const window = variants.find((v) => v.name === 'all20win')
    expect(window?.steps[0].params).toEqual(['2025-01-01', '2027-01-01'])
  })

  it('as variantes em lotes cobrem o cofre inteiro, uma vez só', () => {
    for (const variant of variants.filter((v) => v.scope === 'chunked')) {
      const bounds = variant.steps.map((s) => s.params)
      expect(bounds[0][0]).toBe('2015-01-01')
      expect(bounds[bounds.length - 1][1]).toBe('2035-01-01')
      for (let i = 1; i < bounds.length; i++) expect(bounds[i][0]).toBe(bounds[i - 1][1])
    }
  })

  it('nunca gera variantes homônimas num cofre curto', () => {
    // 2 anos: os tamanhos 2, 5 e 20 colapsariam todos em 2 lotes. Sem deduplicação, três variantes
    // com o mesmo nome se atropelam no mapa de amostras e o relatório mente sem falhar.
    const short = benchVariants(2026, 2025, 2026)
    expect(new Set(short.map((v) => v.name)).size).toBe(short.length)
    expect(short.filter((v) => v.scope === 'chunked').map((v) => v.name)).toEqual(['all20x2'])
  })

  it('não gera variante de lote único — isso já é a leitura inteira', () => {
    const single = benchVariants(2026, 2026, 2026)
    expect(single.filter((v) => v.scope === 'chunked')).toHaveLength(0)
    for (const variant of single.filter((v) => v.scope === 'chunked')) {
      expect(variant.steps.length).toBeGreaterThan(1)
    }
  })

  it('declara o número de colunas que cada variante materializa', () => {
    expect(variants.find((v) => v.name === 'core9')?.columns).toBe(BENCH_CORE_COLUMNS.length)
    expect(BENCH_CORE_COLUMNS).toHaveLength(9)
  })

  it('as variantes de tabela inteira não têm parâmetro', () => {
    for (const variant of variants.filter((v) => v.scope === 'full')) {
      expect(variant.steps).toHaveLength(1)
      expect(variant.steps[0].params).toEqual([])
    }
  })
})

describe('fitCostModel', () => {
  it('recovers the per-cell and per-row cost from a synthetic linear reading', () => {
    // 1000 linhas, 50ms fixos de varredura, 10µs por linha, 20µs por célula:
    // ms = 50 + 1000×0,010 + colunas × 1000×0,020 = 60 + 20×colunas
    const samples = [
      sample('count', 0, 50, 'full'),
      sample('id', 1, 80, 'full'),
      sample('core9', 9, 240, 'full'),
      sample('all20', 20, 460, 'full'),
    ]
    const model = fitCostModel(samples, 1000)
    expect(model).not.toBeNull()
    expect(model?.perCellUs).toBeCloseTo(20, 6)
    expect(model?.perRowUs).toBeCloseTo(10, 6)
    expect(model?.fixedMs).toBeCloseTo(60, 6)
  })

  it('ignores the window variants — they have a different row count', () => {
    const withWindow = [
      sample('count', 0, 50, 'full'),
      sample('id', 1, 80, 'full'),
      sample('all20', 20, 460, 'full'),
      sample('all20win', 20, 90, 'window'),
    ]
    expect(fitCostModel(withWindow, 1000)?.perCellUs).toBeCloseTo(20, 6)
  })

  it('refuses to fit a line through a single column count', () => {
    expect(fitCostModel([sample('all20', 20, 460, 'full')], 1000)).toBeNull()
  })

  it('refuses to fit without a row count', () => {
    const samples = [sample('id', 1, 80, 'full'), sample('all20', 20, 460, 'full')]
    expect(fitCostModel(samples, 0)).toBeNull()
  })
})
