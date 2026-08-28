# Monitoramento de Performance (dev-only, exceto sync — ver §"Métricas de Sync")

> Camada de instrumentação criada para investigar `plan/PERFORMANCE.md` (lentidão ao salvar
> transação no cofre real) e servir como ferramenta geral para futuros gargalos. Ver `M-71`
> (camada), `M-72` (fix de leitura) e `M-73` (fix de escrita) em `plan/BACKLOG.md`.
>
> **A camada de sync (`lib/cloudSync/syncMetrics.ts`, `CS-20`/`CS-24`) é a exceção deliberada ao
> "dev-only" do título** — ver a seção dedicada abaixo antes de assumir que o padrão de gate por
> `import.meta.env.DEV` se aplica a ela.

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

## Métricas de Sync (produção, não gated por DEV)

> `CS-20`/`CS-24` (2026-08-25) — criada para investigar um relato de uso real (sync via Google
> Drive lento em minutos, revert silencioso de um lançamento) num cofre de ~25 mil transações/
> ~14MB, reproduzido no celular do mantenedor contra a API real do Drive — algo que um dev machine
> em localhost não reproduz. Ver `CS-24` em `plan/BACKLOG.md` para o bug de race corrigido junto.

Ao contrário de tudo mais neste documento, **`lib/cloudSync/syncMetrics.ts` não é gated por
`import.meta.env.DEV`** — chama `trackPerformance()` (`telemetry.ts`) direto, sem passar por
`measure()`/`measureAsync()` de `perfMonitor.ts`. Motivo: a latência de rede da API do Drive é
idêntica em build de dev e de produção (diferente do caso do `M-75`, que era puramente overhead do
instrumental de dev do React); gatear isso por `DEV` esconderia exatamente o dado do único lugar
onde ele precisa aparecer — o celular do usuário, em produção. Frequência também não é problema
aqui: ao contrário de `store.mutate.*` (dispara a cada mutação), sync só roda no boot, no poll
periódico (10-480min), no debounce de push de cada mutação e no botão manual — baixo volume para o
ring buffer de 100 eventos de `telemetry.ts`.

- **`measureSync(metric, fn)`** / **`measureSyncCompute(metric, fn)`** — variantes async/sync de
  `perfMonitor.measure()`, sem o gate.
- **`trackSyncBytes(metric, bytes)`** — reaproveita o campo `ms` de `PerfEvent` para carregar uma
  contagem de bytes em vez de uma duração; toda métrica de bytes termina em `.bytes` para não
  confundir quem ler. `PerfPanel.tsx` (dev-only) rotularia esse valor como "Xms" se aberto durante
  uma investigação de sync — inofensivo (o painel não é o canal de consumo desta camada), mas vale
  saber se for usá-lo para depurar sync localmente.

| Métrica | Onde | O que mede |
|---|---|---|
| `sync.drive.findFolderId` / `sync.drive.findFileId` | `googleDrive.ts` | Busca do id da pasta/arquivo no Drive — inclui o cache hit (`localStorage`, ~0ms) e o cache miss (query real à API, dispositivo novo) na mesma métrica; a magnitude do valor distingue os dois casos |
| `sync.drive.getMetadata` | `googleDrive.ts` | Round-trip só de metadados (`modifiedTime`) |
| `sync.drive.getValidAccessToken` | `googleDrive.ts` | Leitura do access token (deveria ficar ~0ms — token em cache, sem rede; um valor alto aponta refresh proativo) |
| `sync.drive.fetch401Retry` | `googleDrive.ts` | Só existe no trace quando o retry-por-401 de fato roda (`fetch → refreshGoogleToken() → fetch de novo`) — presença/duração isola o custo do refresh (CS-27) |
| `sync.drive.download` / `.bytes` | `googleDrive.ts` | Download do Drive — duração e tamanho. Desde o `CS-44`, soma manifesto + partições baixadas, não mais um `gimbo.db` inteiro |
| `sync.drive.upload` / `.bytes` | `googleDrive.ts` | Upload pro Drive. Desde o `CS-44`, soma só as partições que mudaram + o manifesto |
| `sync.readPeerBlob` | `folderSyncService.ts` | Parse do `.db` de peer (via `storage.readPeerBlob`, worker). **Some dos traces do Drive desde o `CS-44`** — segue vivo na pasta compartilhada e no Onboarding |
| `sync.readPeer.tablesSkipped` / `.tablesTotal` | `folderSyncService.ts` | CS-36: hash-skip por tabela pequena. Mesma nota acima — só pasta compartilhada agora |
| `sync.readPeer.yearsSkipped` / `.yearsTotal` | `folderSyncService.ts` | CS-36: idem, por ano de `transactions` |
| `sync.merge` | `driveTreeSyncService.ts` | `mergeForSync()` puro — deve ser rápido; confirma ou descarta o merge como gargalo |
| `sync.loadBaseline` | `driveTreeSyncService.ts` | Leitura do baseline fresco (`storage.loadDataFile()`) usado pelo diff — CS-30 |
| `sync.applyMutation` | `driveTreeSyncService.ts` | Escrita do resultado mesclado no OPFS local, por diff (CS-30) |
| `sync.pullAndMerge.total` | `driveTreeSyncService.ts` | `pullAndMerge()` inteiro — só o transporte Drive |
| `sync.runPeerSync.total` | `useDataStore.ts` | `runPeerSync()` inteiro, como o usuário percebe — inclui a reconciliação do `CS-24`. Desde o `CS-35`, não inclui mais nenhuma releitura completa do cofre local além da já contabilizada em `sync.pullAndMerge.total`/`sync.loadBaseline` |

### Transporte particionado (CS-42 a CS-47)

Métricas novas do `CS-44`/`CS-45`, todas sempre ativas. Juntas respondem, **sem inferência**, as
duas perguntas que a Fase 2 deixou em aberto: o hash-skip está pulando de verdade, e qual o custo
real em chamadas à API.

| Métrica | Onde | O que mede |
|---|---|---|
| `sync.drive.apiCalls` | `googleDrive.ts` | **Round-trips de fato disparados no sync inteiro, retries inclusive.** Resposta direta ao "orçamento de chamadas à API": o transporte novo troca poucas chamadas com muitos bytes por muitos bytes a menos em mais chamadas, e dado o `CS-27` (uma chamada de metadados variou de 0,4s a 9,2s) essa troca pode sair pela culatra em alta latência. Regime permanente esperado: **1** |
| `sync.drive.fetch429Retry` | `googleDrive.ts` | Só existe no trace quando o backoff de rate limit rodou. Espelha o `fetch401Retry`; presença = trocamos bytes por chamadas demais |
| `sync.drive.peersTotal` / `.peersSkippedByWatermark` | `driveTreeSyncService.ts` | Quantos peers existem e quantos foram pulados inteiros porque o `modifiedTime` do manifesto não avançou |
| `sync.drive.partitionsTotal` / `.partitionsSkipped` / `.partitionsFetched` | `driveTreeSyncService.ts` | O `CS-36` elevado à camada de rede: distingue "hash-skip quebrado" de "peer genuinamente divergente" sem inferência |
| `sync.drive.decodePartitions` | `driveTreeSyncService.ts` | gunzip + `JSON.parse` + zod das partições baixadas, na main thread. O risco de jank do primeiro sync, medido em vez de estimado |
| `sync.drive.publish.partitionsUploaded` | `driveTreeSyncService.ts` | Quantas partições este dispositivo republicou. Com `sync.drive.upload.bytes`, confirma o colapso de ~14MB por salvamento |
| `sync.drive.partitionHashMismatch` | `driveTreeSyncService.ts` | Integridade de transferência: o hash das linhas baixadas não bateu com o do manifesto. **Reporta, nunca bloqueia** — também serve de detector permanente de regressão da normalização do `CS-32` |
| `sync.drive.hashVersionMismatch` | `driveTreeSyncService.ts` | O peer publicou com outro `HASH_VERSION` (`CS-39`) — nada é comparável e tudo é buscado. Remove a ambiguidade que custou uma rodada de depuração no `CS-34`/`CS-36` |
| `sync.drive.publish.readPartitions` | `driveTreeSyncService.ts` | `CS-50`: leitura batelada de todas as partições a publicar, numa chamada só ao worker. Antes eram N chamadas serializadas pela fila — ~13s no primeiro sync |
| `sync.drive.baselineScopedYears` | `driveTreeSyncService.ts` | `CS-50`: quantos anos o diff leu, em vez do cofre inteiro. **Ausente = caminho completo**, o que só deveria acontecer quando vieram lápides (elas removem de qualquer ano) |
| `sync.drive.publish.staleFileIds` | `driveTreeSyncService.ts` | `CS-50`: um `fileId` em cache estava morto e o upload teve de recriar o arquivo — o cache de ids é descartado e o sync seguinte relista a pasta |

Consumo: Bug Report System (F-26) já existente, categoria "performance" do snapshot — sem UI nova.
No celular, Configurações → "Reportar problema" → conferir/copiar o JSON. Mesma regra de
privacidade do resto do sistema (`METRICS.md`): só nome de métrica, duração/bytes e timestamp,
nunca nome de arquivo, `deviceId`, IDs de entidade ou valor financeiro.

Escopo desta rodada: só o transporte Google Drive (Fase 2), que é o que motivou o relato. O
transporte de pasta compartilhada (`folderSyncService.ts`, Fase 1) não foi instrumentado — mesma
arquitetura, adicionar depois se algum dia for a fonte de um relato parecido.

## Changelog

- **CS-37 a CS-51 (2026-08-26/27)** — transporte particionado de sync no Drive, e o ciclo de
  medição que o corrigiu. Vale ler pelo **método**, não só pelo resultado: três rodadas de
  telemetria real derrubaram, uma por vez, três hipóteses minhas.
  1. A primeira coleta confirmou o ganho de bytes (push por salvamento de ~14MB para **136 KB**) e
     revelou que o gargalo tinha mudado de lugar: um manifesto de 3,5 KB custava ~1,1s para baixar
     e ~2s para subir. Transporte deixou de ser *bandwidth-bound* e virou *latency-bound*.
  2. A segunda rodada, com os papéis dos navegadores **invertidos**, confirmou isso de forma
     limpa — os números seguiram o papel do dispositivo, não a engine.
  3. A terceira mostrou que as otimizações do `CS-50` **pioraram** tudo. Investigar por quê levou
     ao `CS-51`: `date LIKE '2026%'` dava `SCAN` (varredura completa) em dois caminhos quentes.
     Otimizar acima de uma query que ignora o índice mede o gargalo errado.
  4. A quarta, com o `CS-51` aplicado e 4 ciclos, fechou: sync incremental **7,5-8,3s** (desvio de
     ~350ms), trabalho local em **9%** do total, ~270 KB por ciclo contra ~28 MB do monolítico.

  Resultado prático: o `EXPLAIN QUERY PLAN` via `window.__storage.query()` no console — a mesma
  ferramenta do `M-72` — continua sendo o drill-down que resolve, quando a métrica agregada diz
  "está lento" mas não diz onde.
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
- **CS-24 (2026-08-25)** — `runPeerSync` corrigido para não reverter mais um lançamento feito
  durante uma sincronização em andamento (race entre o snapshot pré-pull e o `replaceAll(merged)`
  pós-pull). Ver `CS-24` em `plan/BACKLOG.md`.
- **CS-20 (2026-08-25)** — camada de "Métricas de Sync" criada (seção dedicada acima), motivada
  pelo mesmo relato que originou o `CS-24` — primeira instrumentação desta família a rodar em
  produção, não só em DEV. Ver `CS-20` em `plan/BACKLOG.md`.
- **CS-25 (2026-08-25)** — primeira leva de dados reais coletada com a camada acima (cofre de
  ~25 mil transações/~13,18MB) mostrou duas janelas de `sync.pullAndMerge.total` sobrepostas e
  dois `sync.drive.upload.bytes` idênticos numa única conexão ao Google Drive — `runPeerSync()`
  disparando duas vezes concorrentemente (boot de `App.tsx` + callback OAuth de `Settings/
  index.tsx`, ambos no mesmo carregamento de página). Corrigido com uma guarda de reentrância em
  `runPeerSync()`. Ver `CS-25` em `plan/BACKLOG.md` — primeiro achado de causa raiz produzido por
  esta camada de métricas, exatamente o caso de uso que motivou o `CS-20`.
- **CS-26 (2026-08-25)** — segunda rodada de teste real (dois browsers, ~26,5 mil transações/
  ~14,83MB) mostrou `sync.readPeerBlob` em 17,8s, mais lento que os 10,8s do download dos mesmos
  bytes. Causa: `readDataFileFromDb` (`worker.ts`, CS-15) nunca recebeu o fix de query do `M-72` —
  ainda usava `LEFT JOIN` duplo + `GROUP_CONCAT(DISTINCT)` + `GROUP BY t.id` porque roda dentro do
  worker, fora da RPC `this.query()` que `StorageService.getTransactions()` usa. Reescrito para o
  mesmo padrão de três queries + join em JS. Sem cobertura de teste automatizado (mesma limitação
  do `M-72`/`M-73` — wa-sqlite/OPFS real não roda em `vitest`); pendente confirmar o ganho contra
  dado real. Ver `CS-26` em `plan/BACKLOG.md`.
- **CS-27 (2026-08-25)** — mesma rodada: `sync.drive.getMetadata` em 9,2s, 4-8x mais lento que as
  list-queries estruturalmente parecidas. Hipótese não confirmada: retry-por-401 em
  `authorizedFetch`. Duas métricas novas (`sync.drive.getValidAccessToken`,
  `sync.drive.fetch401Retry`) adicionadas só para diagnosticar — nenhuma correção de causa raiz
  ainda, item continua aberto. Ver `CS-27` em `plan/BACKLOG.md`.
- **CS-28 (2026-08-25)** — o `Promise.all` do `CS-26` (paralelizando as três queries de
  `readDataFileFromDb`) corrompeu o módulo WASM do wa-sqlite (build Asyncify, uma chamada em voo
  por vez) — crashou uma importação real do mantenedor minutos depois
  (`NotFoundError: Entry not found` → `RuntimeError: unreachable executed`). Corrigido revertendo
  para sequencial (`await` um de cada vez); regra registrada em `CLAUDE.md` ("Restrições" → Código)
  para não repetir o padrão. Ver `CS-28` em `plan/BACKLOG.md`.
- **CS-26/CS-27 confirmados (2026-08-25)** — repetição do teste de dois browsers, já com `CS-28`
  aplicado: `worker.readPeer` caiu de 17.823,9ms para **2.570,8ms** (~6,9x), confirmando o fix do
  `CS-26`; `sync.pullAndMerge.total` do lado que lê caiu de 48,1s para **11,4s**. `getMetadata`
  também voltou ao normal (588,5ms, mesma ordem dos outros lookups) e `sync.drive.fetch401Retry`
  não apareceu em nenhuma das duas coletas — `CS-27` rebaixado a baixa prioridade, provável
  anomalia pontual de rede, não bug sistemático. Ver `CS-26`/`CS-27` em `plan/BACKLOG.md`.
- **CS-29 (2026-08-25)** — teste real de dois browsers (edição no Chrome, refresh+sync no Firefox)
  mostrou `sync.runPeerSync.total` (54,8s) 10,1s maior que `sync.pullAndMerge.total` (44,7s), sem
  nenhuma edição concorrente real ter acontecido — a diferença batia com um `worker.replaceAll`
  extra de 7,4s mais uma releitura completa do cofre. Causa: a reconciliação do `CS-24` comparava
  `data` por identidade de objeto; `<StrictMode>` duplicando `init()` troca a referência de `data`
  em todo boot mesmo com conteúdo idêntico, disparando a reconciliação à toa. Corrigido comparando
  `settings.fileUpdatedAt` em vez de identidade — só `mutate()` avança esse timestamp. Ver `CS-29`
  em `plan/BACKLOG.md`.
- **CS-30 (2026-08-25, Fase 1)** — os três pontos de sync que faziam `replaceAll()` (reescrita
  total do cofre a cada sync) passaram a usar `applyMutation()` + `diffTransactions()` (mesmo
  mecanismo do `M-73`, nunca antes usado no write-path de sync). Métrica `sync.replaceAll`
  renomeada para `sync.applyMutation`; nova métrica `sync.loadBaseline` (leitura do baseline
  fresco antes do diff, no ponto do Drive). Primeira cobertura automatizada da combinação "delta
  de merge aplicado via `applyMutation`" via `e2e/syncApplyMutation.spec.ts` (usa
  `window.__syncTest`, dev-only, mesmo padrão de `window.__storage`). Fase 2 (hash de partição
  pra acelerar a leitura do peer) ainda não implementada. Ver `CS-30` em `plan/BACKLOG.md`.
- **CS-31 (2026-08-25)** — confirmação do `CS-30` contra dado real também revelou que
  `sync.loadBaseline` (a releitura local que o diff precisa) custou 7,3s no Firefox — quase 29%
  do tempo total, concentrados numa única query (`SELECT t.* FROM transactions` local). A mesma
  chamada custou 52ms no Chrome, mesmo tamanho de cofre — descompasso Firefox×Chrome que já
  aparecia em toda coleta desta sessão (hidratação de boot), agora nomeado explicitamente. Sem
  correção nesta sessão; a Fase 2 já planejada (hash por partição) resolve isso pelo mesmo
  mecanismo que resolve a leitura do peer, aplicado também ao lado local. Ver `CS-31` em
  `plan/BACKLOG.md`.
- **CS-32 (2026-08-25, Fase 2a)** — schema (`table_hashes`, migration v16) e manutenção do hash
  por partição (FNV-1a + XOR-fold, `lib/storage/rowHash.ts`), sem nenhuma mudança de leitura
  ainda (isso é a Fase 2b). Instrumentadas as 3 funções centrais de escrita do worker
  (`writeSmallTables`/`applyTransactionDelta`/`replaceAll`) — nenhuma mutação em
  `useDataStore.ts` precisou mudar. `e2e/tableHashSync.spec.ts` (novo) pegou um bug real de
  normalização antes de qualquer leitura seletiva depender desses hashes: o fallback
  `updatedAt ?? ts` da escrita não era espelhado no cálculo do hash, fazendo o hash de uma tabela
  mudar sozinho no primeiro round-trip por `loadDataFile()` sem edição real — corrigido
  normalizando os dois lados igual. Ver `CS-32` em `plan/BACKLOG.md`.
- **CS-33 (2026-08-25, Fase 2b)** — leitura seletiva do peer: `readDataFileFromDbSelective`
  (`worker.ts`) só lê uma tabela/ano se o hash divergir do local, usando os hashes do `CS-32`.
  `readDataFileFromDb` refatorada em leitores por tabela reutilizados por ambos os caminhos
  (completo/seletivo); `importDb()` continua na versão completa. `e2e/selectivePeerRead.spec.ts`
  (novo) usa dois contextos de browser reais pra gerar um peer com hash de verdade, e validou
  explicitamente que o teste pega o pior caso possível (forçado `hashesMatch()` a sempre "bater"
  — o teste falhou detectando a perda de dado do peer; revertido antes de commitar). Ver `CS-33`
  em `plan/BACKLOG.md`.
- **CS-34 (2026-08-25)** — usuário reportou, num teste real pós-`CS-33`, que o sync não ficou mais
  rápido (pareceu até mais lento): `sync.readPeerBlob`/`worker.readPeer` seguiram em 13-14s.
  Causa: `table_hashes` só é mantida incrementalmente — um ano de histórico nunca tocado por uma
  mutação diffada desde que a v16 existe nunca ganha uma linha na tabela, e `hashesMatch()` o
  trata como "sempre diverge" pra sempre. `e2e/selectivePeerRead.spec.ts` (`CS-33`) não pegou isso
  porque semeia via `replaceAll()`, que já popula os hashes como efeito colateral. Corrigido com
  `backfillTableHashesIfNeeded(dbPtr)` — checagem barata, popula tudo de uma vez só se a tabela
  estiver vazia — chamada em `init()` (local, uma vez por boot) e em `readForeignDataFile()`
  (cópia do peer, antes de comparar). Teste novo reproduz o cenário real (cofre com dado antigo,
  hashes vazias) e falha sem a correção. **Extensão:** `importDb()` também precisou da mesma
  chamada — reabre `db` fora do caminho de boot de `init()`, então importar um `.db` antigo sem
  hashes só se beneficiaria no próximo reload, não no mesmo carregamento em que o import acontece.
  Ver `CS-34` em `plan/BACKLOG.md`.
- **CS-35 (2026-08-25)** — duas coletas reais (Chrome+Firefox) enviadas pra confirmar o `CS-34`
  mostraram um `worker.query:SELECT t.* FROM transactions` isolado de ~8,85s (Chrome)/~6,5s
  (Firefox) *depois* de `sync.pullAndMerge.total` já ter terminado, dentro de
  `sync.runPeerSync.total` — inclusive no caso do Firefox, onde nenhuma reconciliação chegou a
  disparar. Causa: `pullAndMergeInner`/`syncFromPeers` já computam o `DataFile` mergeado em
  memória e o persistem, mas descartavam esse valor no `SyncResult` devolvido, forçando
  `runPeerSync` a chamar `storage.loadDataFile()` de novo só pra reconstruir uma cópia
  equivalente — pagando o mesmo custo de leitura completa do `M-72` a cada sync, usado ou não.
  Corrigido devolvendo o `DataFile` já computado em `result.data`; a checagem de edição
  concorrente do `CS-29` passou a comparar `get().data` (em memória, zero I/O, mais atual que uma
  releitura de disco) em vez de reler. Ver `CS-35` em `plan/BACKLOG.md`.
- **CS-36 (2026-08-25)** — telemetria nova (tabela acima) pra a próxima coleta real dizer sem
  ambiguidade se o hash-skip da Fase 2b está de fato pulando partições ou se um número alto de
  `worker.readPeer` reflete um par de dispositivos genuinamente divergente (primeiro sync de um
  histórico grande, custo conhecido e esperado). Zero mudança de comportamento. Ver `CS-36` em
  `plan/BACKLOG.md`.
- **CS-35 confirmado / CS-36 primeira leitura (2026-08-26)** — nova rodada de dois browsers no
  mesmo cofre real (~26,5 mil transações) confirmou o `CS-35`: `sync.runPeerSync.total` ficou a
  ~280-300ms de `sync.pullAndMerge.total` nos dois lados (era 7,5-9,8s de diferença antes) — a
  releitura redundante foi eliminada de fato, não só em teoria. `CS-36` deu sua primeira leitura
  real: Firefox (só 1 transação nova desde o último sync) pulou 19 de 20 anos — `worker.readPeer`
  em 756ms, hash-skip funcionando como desenhado; Chrome (mesmo cofre, hash local aparentemente já
  convergido) não pulou nenhum dos 20 anos. Hipótese em aberto, não confirmada: `sync_gimbo.py`
  carimba `updated_at` com o timestamp do *run* em toda transação (B-32) — um `.db` de fixture
  gerado por uma execução diferente do script teria `updated_at` genuinamente distinto em cada
  linha, mesmo com o mesmo conteúdo financeiro, o que faria o hash divergir de verdade (não seria
  bug). Ver `CS-35`/`CS-36` em `plan/BACKLOG.md` para o detalhe completo.
