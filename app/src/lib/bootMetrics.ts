// M-87 — instrumentação do boot, sempre ativa (não gated por `import.meta.env.DEV`).
//
// Motivo do mesmo desvio já feito em `lib/cloudSync/syncMetrics.ts` (CS-20), e não do padrão
// dev-only de `lib/perfMonitor.ts` (M-71): o que se quer medir aqui é o tempo entre o usuário
// recarregar a página e a interface aparecer — um número que depende do cofre real do usuário
// (dezenas de milhares de transações no OPFS dele, não uma fixture), do navegador dele e de um
// build de produção com service worker. Nada disso se reproduz fielmente num `npm run dev` com
// dados sintéticos: o M-75 é o precedente exato de dev e produção divergirem por completo num
// número de boot. Frequência não é problema para o ring buffer de 100 eventos de `telemetry.ts` —
// tudo aqui dispara no máximo uma vez por carregamento de página.
//
// Consumo: Bug Report System (F-26), categoria "performance" — mesma via de `sync.*`, sem UI nova.
// Em dev, o `PerfPanel` (Alt+Shift+P) já lista estes eventos sem precisar de mudança nenhuma.
//
// Duas convenções de leitura das métricas emitidas aqui:
//  - `boot.scriptStart`/`boot.firstContentfulPaint`/`boot.appVisible`/`boot.ttfb` são **instantes**
//    contados a partir do início da navegação (`performance.now()` na thread principal já tem essa
//    origem), não durações. Lidos em sequência, dizem *quando* cada marco aconteceu.
//  - o resto são durações de fase.

import { trackPerformance } from '@/lib/telemetry'

let _started = false
let _appVisibleTracked = false
/** Instante do primeiro paint — o fundo da tela aparecendo, início da janela em branco. */
let _firstPaint: number | null = null
/** Instante em que o script do app começou a rodar — substituto do acima onde ele não existe. */
let _scriptStart: number | null = null
const _instants = new Set<string>()

/** Registra um valor de boot já medido (duração de fase, ou instante desde a navegação). */
export function trackBoot(metric: string, ms: number): void {
  trackPerformance(metric, ms)
}

/**
 * Registra *quando* um marco do boot aconteceu, contado do início da navegação — uma vez só.
 *
 * O `<StrictMode>` invoca os efeitos duas vezes em dev, e um marco repetido não significa nada
 * (ao contrário de uma duração repetida, que denuncia trabalho feito duas vezes — por isso as
 * durações não passam por aqui).
 */
export function markBootInstant(metric: string): void {
  if (_instants.has(metric)) return
  _instants.add(metric)
  trackPerformance(metric, performance.now())
}

/** Mede uma fase assíncrona do boot. */
export async function measureBoot<T>(metric: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    return await fn()
  } finally {
    trackPerformance(metric, performance.now() - start)
  }
}

/** Mede uma fase síncrona do boot. */
export function measureBootSync<T>(metric: string, fn: () => T): T {
  const start = performance.now()
  try {
    return fn()
  } finally {
    trackPerformance(metric, performance.now() - start)
  }
}

/**
 * Chamada uma única vez, o mais cedo possível na thread principal (`main.tsx`), antes de montar o
 * React. Registra:
 *
 *  - `boot.scriptStart` — quanto tempo passou desde o início da navegação até este ponto: rede,
 *    service worker, download e parse do bundle, e a avaliação de todos os módulos importados
 *    (i18n inclusive). É o pedaço do boot que nenhuma otimização de SQLite alcança.
 *  - `boot.ttfb` — `responseEnd` do documento. Perto de zero num carregamento servido pelo service
 *    worker; alto isola a rede como culpada, em vez do trabalho local.
 *  - `boot.firstContentfulPaint` — o instante em que o navegador pintou o primeiro conteúdo. Com o
 *    `<div id="root">` vazio, é justamente quando o fundo da tela aparece — o começo da janela em
 *    branco que o usuário percebe como lentidão.
 *
 * Idempotente: o `<StrictMode>` invoca efeitos duas vezes em dev, e um boot não pode ser contado
 * duas vezes por causa disso (mesma classe de armadilha do CS-29).
 */
export function startBootTracking(): void {
  if (_started) return
  _started = true

  _scriptStart = performance.now()
  markBootInstant('boot.scriptStart')

  const nav = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined
  if (nav) trackBoot('boot.ttfb', nav.responseEnd)

  // `buffered: true` porque o paint pode ter acontecido antes deste observer existir.
  //
  // As duas entradas medem coisas diferentes: `first-paint` é o navegador pintando o fundo da
  // página com o `<div id="root">` ainda vazio — exatamente o instante em que o usuário passa a
  // ver a tela verde-escura sem interface —, e `first-contentful-paint` só dispara quando existe
  // conteúdo, o que neste app significa o React já ter renderizado. A distância entre as duas *é*
  // o sintoma.
  //
  // Firefox publica só o FCP, e a primeira coleta real (M-87, Firefox 153) mostrou por que ele
  // **não** serve de substituto para o `first-paint`: lá o FCP saiu em 2.559ms com a tela pintada
  // em 2.579ms, ou seja, marcaria uma janela em branco de 20ms para um boot que teve ~2,3s dela.
  // Uma métrica derivada de um substituto errado mente com mais convicção do que a ausência dela.
  // Onde não há `first-paint`, a janela cai para `boot.scriptStart` (ver `markAppVisible`).
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-paint') {
          _firstPaint = entry.startTime
          trackBoot('boot.firstPaint', entry.startTime)
        }
        if (entry.name === 'first-contentful-paint') {
          trackBoot('boot.firstContentfulPaint', entry.startTime)
        }
      }
    })
    observer.observe({ type: 'paint', buffered: true })
  } catch {
    // Navegador sem suporte a PerformanceObserver/'paint' — segue sem as métricas de paint.
  }
}

/**
 * Chamada quando o React comete o primeiro render com a interface real. Registra
 * `boot.appVisible` (instante desde a navegação, já depois do paint) e `boot.blankWindow` — a
 * duração da tela vazia, que é o sintoma relatado: o usuário vendo só o fundo, sem interface.
 *
 * A janela é contada do `first-paint` quando o navegador o publica (Chromium) e do
 * `boot.scriptStart` quando não (Firefox). O substituto é honesto: nas coletas reais os dois
 * ficaram a algumas dezenas de ms um do outro (152 vs. 120,5 no Chrome 151), porque o CSS que
 * pinta o fundo é carregado no mesmo `<head>` que serve o módulo do app. Subestima a janela em
 * alguns ms, e nunca pela ordem de grandeza que o FCP subestimaria.
 *
 * Dois `requestAnimationFrame` encadeados: o primeiro roda antes do paint do frame que acabou de
 * ser agendado, o segundo já depois dele. É a heurística usual de "depois de pintar" disponível
 * sem APIs experimentais — precisa o suficiente para uma janela medida em segundos.
 */
export function markAppVisible(): void {
  if (_appVisibleTracked) return
  _appVisibleTracked = true

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const at = performance.now()
      trackBoot('boot.appVisible', at)
      const inicioDaJanela = _firstPaint ?? _scriptStart
      if (inicioDaJanela !== null) trackBoot('boot.blankWindow', at - inicioDaJanela)
    })
  })
}

/** Só para testes — zera o estado de "já registrado" deste módulo. */
export function _resetBootTrackingForTests(): void {
  _started = false
  _appVisibleTracked = false
  _firstPaint = null
  _scriptStart = null
  _instants.clear()
}
