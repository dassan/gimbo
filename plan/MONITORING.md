# Monitoramento de Performance (dev-only)

> Camada de instrumentação criada para investigar `plan/PERFORMANCE.md` (lentidão ao salvar
> transação no cofre real) e servir como ferramenta geral para futuros gargalos. Ver `M-71` em
> `plan/BACKLOG.md`.

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
| `storage.postMessage.<method>` | `StorageService.ts` → `call()` | clone síncrono implícito do `postMessage` para o Worker (sem `transfer`) |
| `worker.<method>` | `worker.ts` → handler de `message` | tempo real de execução no Worker (fila + SQL), devolvido via campo `perf?` em `WorkerResponse` |

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
sozinho) sempre que o call site precisar ficar **completamente** fora do bundle de produção — ver
"Verificação do bundle" abaixo para o porquê.

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

## Próximo passo (fora do escopo desta camada)

Esta camada é só medição — não inclui a correção do bug de `PERFORMANCE.md`. Próximo passo:
reproduzir com o cofre real (importado localmente) e comparar `store.mutate.clone` vs.
`storage.postMessage.replaceAll` vs. `worker.replaceAll` no painel, para confirmar qual domina
antes de decidir entre as correções já esboçadas em `PERFORMANCE.md` (adotar Immer em `mutate()`,
ou serialização transferível no `postMessage`).
