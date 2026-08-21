# Monitoramento de Performance (dev-only)

> Camada de instrumentação criada para investigar `plan/PERFORMANCE.md` (lentidão ao salvar
> transação no cofre real) e servir como ferramenta geral para futuros gargalos. Ver `M-71`
> (camada), `M-72` (fix de leitura) e `M-73` (fix de escrita) em `plan/BACKLOG.md`.

## O que existe

- **`app/src/lib/perfMonitor.ts`** — `measure(name, fn)` / `measureAsync(name, fn)`, wrappers de
  `performance.now()` que gravam em `trackPerformance()` (`lib/telemetry.ts`, já existia,
  definido e nunca chamado antes deste item). Gated por `import.meta.env.DEV` **e** um toggle em
  runtime (`localStorage: gimbo:perfMonitor`) — um único interruptor controla tanto a coleta
  quanto o painel.
- **`app/src/hooks/usePerfMonitorToggle.ts`** — atalho `Alt+Shift+P` liga/desliga o toggle sem
  precisar de rebuild.
- **`app/src/components/PerfPanel.tsx`** — overlay fixo (canto inferior esquerdo) montado em
  `AppLayout.tsx` quando o toggle está ligado: tabela de eventos recentes, agregados
  (n/avg/p95/max) por métrica, gráfico de barras (`recharts`), botão de limpar (`clearBuffer()`)
  e de copiar (reaproveita `buildBugReportSnapshot()` do Bug Report System, F-26, filtrado só
  para `performance`).

## Pontos instrumentados hoje

| Métrica | Onde | O que mede |
|---|---|---|
| `store.mutate.clone` | `useDataStore.ts` → `mutate()` | `structuredClone(state.data)` do `DataFile` inteiro |
| `store.mutate.apply` | `useDataStore.ts` → `mutate()` | a função de mutação (`fn(data)`) em si |
| `store.mutate.diffTransactions` | `useDataStore.ts` → `debouncedApplyMutation()` | `diffTransactions()` (M-73) — compara `_lastPersisted.transactions` com o estado atual |
| `storage.postMessage.<method>` | `StorageService.ts` → `call()` | clone síncrono implícito do `postMessage` para o Worker (sem `transfer`) — inclui `.applyMutation` (M-73) além de `.query`/`.replaceAll` |
| `worker.<method>` | `worker.ts` → handler de `message` | tempo real de execução no Worker (fila + SQL), devolvido via campo `perf?` em `WorkerResponse` — inclui `worker.applyMutation` (M-73), o caminho comum de mutação desde então |

O worker roda em outro realm JS — não enxerga o buffer de `telemetry.ts` nem o `localStorage`
diretamente. O timing do worker fica atrás só do gate de build (sempre populado em DEV,
independente do toggle em runtime); quem decide se vira um evento visível é o lado da thread
principal, ao consumir `perf` da resposta.

## Como ligar

1. `npm run dev` (o painel nunca existe fora de DEV — ver seção de verificação abaixo).
2. `Alt+Shift+P` em qualquer tela.
3. Para investigar o cofre real (só existe no OPFS de `gimbo.com.br`): exportar o backup em
   Configurações → Dados, importar num ambiente local (`npm run dev` ou `npm run preview`) e
   reproduzir lá — nunca ligar nada em produção.

## Padrão para instrumentar um novo ponto

```ts
import { measure } from '@/lib/perfMonitor'

// só onde o resultado precisa existir independente do DEV/toggle:
const result = import.meta.env.DEV ? measure('minha.metrica', () => calcularAlgo()) : calcularAlgo()
```

Usar o `import.meta.env.DEV ? measure(...) : <chamada direta>` explícito (não só `measure()`
sozinho) sempre que o call site for **barato de duplicar** (uma linha, uma chamada só) e precisar
ficar **completamente** fora do bundle de produção — ver "Verificação do bundle" abaixo para o
porquê. Esse é o padrão usado nos 3 pontos centrais (`mutate()`, `StorageService.call()`, worker).

**Para `useMemo` grandes** (ex.: `Transactions/index.tsx` → `filtered`, `Analytics/index.tsx` →
`cashFlowTransactions`, `CashFlowView.tsx` → `rows`), duplicar o corpo inteiro em dois ramos só
pra eliminar a string do nome da métrica não vale a pena — o corpo tem dezenas de linhas e
fecha sobre várias variáveis externas via closure; extrair pra função nomeada só pra viabilizar o
ternário pioraria a legibilidade por um ganho de bundle irrelevante (a string do nome da métrica
tem dezenas de bytes, sem custo de runtime, sem superfície de segurança — bem diferente do
`__storage`/`__secretStore`, que expõem leitura/escrita real do banco). Nesses casos, `measure()`
direto (sem o ternário) é aceitável — o nome da métrica fica como string inerte no bundle de
produção, nunca executado (verificado: `grep` mostra a string presente, mas nenhum comportamento
depende dela fora de DEV+toggle).

Para custo de **render** (não de cálculo), preferir o `<Profiler>` nativo do React ad hoc durante
uma sessão de debug, em vez de instrumentar com `measure()`:

```tsx
import { Profiler } from 'react'

{import.meta.env.DEV ? (
  <Profiler id="TransactionDrawer" onRender={(id, phase, duration) => console.debug(id, phase, duration)}>
    <TransactionDrawer ... />
  </Profiler>
) : (
  <TransactionDrawer ... />
)}
```

Não há scaffolding permanente para isso — é uma técnica para aplicar pontualmente, não uma
métrica coletada por padrão.

## Verificação do bundle de produção

`measure()` sozinho (`measure('nome', fn)`) não é suficiente para sumir do bundle: o minificador
elimina ramos mortos dentro de uma função quando a condição é uma constante estática
(`import.meta.env.DEV` vira `false` em build de produção), mas **não inlina uma função inteira**
no call site — então o nome da métrica (string literal) e a chamada em si sobrevivem como bytes
inertes, mesmo que nunca executem nada de fato. Por isso os 3 call sites atuais usam o padrão
ternário (`import.meta.env.DEV ? measure(...) : <fn direta>`), que o esbuild resolve estaticamente
no próprio call site.

Depois de qualquer mudança nesta camada:

```bash
cd app && npm run build
grep -c "gimbo:perfMonitor\|PerfPanel\|store\.mutate\.\|storage\.postMessage\." dist/assets/*.js
```

Deve retornar `0` em todos os arquivos — mesmo padrão de verificação já usado para
`__storage`/`__secretStore` (SEC-04/SEC-06, ver `services/storage/index.ts` e
`lib/cloudSync/secretStore.ts`).

## Por que não Prometheus/Grafana

Prometheus é *pull-based* — precisa de um processo servidor rodando um endpoint `/metrics` para
ser raspado. O Gimbo não tem servidor em nenhuma fase (`CLAUDE.md`: "sem servidor, sem nuvem").
Inventar um processo só para hospedar métricas contradiz o princípio central do projeto, e um
Pushgateway remoto reintroduziria exatamente o "telemetria sai do device" que `plan/METRICS.md`
já rejeitou para o Bug Report System (F-26) — `❌ Google Analytics/Mixpanel`,
`⚠️ Umami — exige infraestrutura`. Grafana só faz sentido em cima de uma fonte de dados desse
tipo, então a objeção cai em cascata. O painel local + `performance.now()`/User Timing API
(nativo no Chrome DevTools Performance e no Firefox Profiler, sem nenhum código extra) + o export
já existente do Bug Report são o equivalente local-first: tudo fica no dispositivo.

## Pontos de página já instrumentados

Além dos pontos centrais (tabela acima), estas telas têm `useMemo` grandes instrumentados com o
padrão `measure()` simples (sem o ternário de eliminação — ver seção acima, o custo de duplicar
esses corpos não valia a pena):

| Métrica | Onde | Roda quando |
|---|---|---|
| `transactions.filtered` | `pages/Transactions/index.tsx` | toda vez que a tela de Lançamentos filtra/ordena o array de transações |
| `analytics.cashFlowTransactions` | `pages/Analytics/index.tsx` | sempre que a página de Relatórios monta (incondicional, mesmo fora da sub-aba Fluxo de Caixa) |
| `analytics.cashFlowView.rows` | `pages/Analytics/CashFlowView.tsx` | só quando a sub-aba Fluxo de Caixa está aberta — agrupamento em baldes |

Usadas pra descartar cálculo em JS como causa de uma lentidão ocasional ao trocar de aba — nos
testes reais (`plan/PERFORMANCE.md`), as três sempre voltaram rápidas (dezenas de ms), mesmo
durante uma reprodução lenta — o que ajudou a apontar a causa pra outro lugar (ver changelog
abaixo).

## Changelog

- **M-71 (2026-08-20)** — camada criada (este documento).
- **M-72 (2026-08-20)** — `getTransactions()` sem filtro travava 52-55s na hidratação inicial.
  Medido com esta camada + drill-down manual via `window.__storage.query()` no console
  (`EXPLAIN QUERY PLAN`, contagens, tempos parciais) — `GROUP BY`/`GROUP_CONCAT(DISTINCT)`
  custava ~9ms por grupo nesse ambiente, não o volume de dado. Corrigido removendo `JOIN`/
  `GROUP BY` da query (junta tags/caixinhas em JS) + índice composto novo. Ver `M-72` em
  `plan/BACKLOG.md` e o capítulo correspondente em `plan/PERFORMANCE.md`.
- **M-73 (2026-08-21)** — `replaceAll()` reescrevia a tabela `transactions` inteira (~29 mil
  `INSERT`s sequenciais) em **toda** mutação, não só na carga — até ~1 minuto por salvamento no
  cofre real. Corrigido com persistência por diff (`lib/storage/transactionDiff.ts` +
  `worker.ts` `applyMutation()`) — novas métricas `store.mutate.diffTransactions`,
  `storage.postMessage.applyMutation`, `worker.applyMutation` (tabela acima). Validado contra o
  cofre real: 255ms a primeira gravação, 79ms as seguintes. Ver `M-73` em `plan/BACKLOG.md`.
