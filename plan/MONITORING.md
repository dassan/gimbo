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
| `sync.drive.publish.total` | `driveTreeSyncService.ts` | `CS-52`: duração da publicação, que passou a rodar **em background**. Não faz parte do tempo que o usuário espera; comparar com `sync.pullAndMerge.total` mostra quanto foi retirado do caminho percebido |
| `sync.drive.publish.apiCalls` | `googleDrive.ts` | `CS-52`: orçamento de chamadas **da publicação**, separado do `sync.drive.apiCalls` (que ficou sendo só o do pull). Somar os dois dá o custo total; olhar só o primeiro dá o custo percebido |
| `sync.drive.manifestFromProperties` | `driveTreeSyncService.ts` | `CS-53`: o manifesto do peer veio nas `appProperties` do `files.list`, sem download. **Ausente = caminho de fallback** (peer sem propriedades, ou histórico longo demais para caber nos limites da API) |
| `sync.drive.publish.propertiesTooLarge` | `driveTreeSyncService.ts` | `CS-53`: a tabela de partições não coube em `appProperties` (30 propriedades × 124 bytes). O manifesto segue publicado como arquivo; só se perde o atalho de leitura |

Consumo: Bug Report System (F-26) já existente, categoria "performance" do snapshot — sem UI nova.
No celular, Configurações → "Reportar problema" → conferir/copiar o JSON. Mesma regra de
privacidade do resto do sistema (`METRICS.md`): só nome de métrica, duração/bytes e timestamp,
nunca nome de arquivo, `deviceId`, IDs de entidade ou valor financeiro.

Escopo desta rodada: só o transporte Google Drive (Fase 2), que é o que motivou o relato. O
transporte de pasta compartilhada (`folderSyncService.ts`, Fase 1) não foi instrumentado — mesma
arquitetura, adicionar depois se algum dia for a fonte de um relato parecido.

## Métricas de Boot (produção, não gated por DEV)

> `M-87` (2026-08-28) — criada a partir de um relato de uso real: ao recarregar a página, o app
> demora alguns segundos mostrando só o fundo da tela antes de a interface aparecer. Não havia
> **nenhuma** instrumentação de boot no projeto — `perfMonitor.ts` é dev-only e por toggle,
> `syncMetrics.ts` só cobre sync —, então o fenômeno era invisível para qualquer diagnóstico.

`lib/bootMetrics.ts` segue a exceção de `syncMetrics.ts`, não o padrão dev-only: o boot que
interessa é o do cofre real do usuário (dezenas de milhares de transações no OPFS dele), no
navegador dele, num build de produção com service worker — e o `M-75` é o precedente exato de dev
e produção divergirem por completo num número desses. Frequência não é problema para o ring buffer
de 100 eventos: tudo aqui dispara no máximo uma vez por carregamento de página.

Duas convenções de leitura:

- **Marcos** (`boot.scriptStart`, `boot.firstPaint`, `boot.dataReady`, `boot.firstRender`,
  `boot.appVisible`, `boot.firstContentfulPaint`) são *instantes* contados do início da navegação.
  Lidos em ordem, desenham a linha do tempo inteira do boot, sem buracos. Registrados **uma vez
  só** (`markBootInstant`) — o `<StrictMode>` duplica efeitos em dev e um marco repetido não
  significa nada.
- **Durações** (o resto) são fases. Estas *não* são deduplicadas de propósito: uma duração que
  aparece duas vezes denuncia trabalho feito duas vezes (é assim que o double-invoke do
  `<StrictMode>` fica visível em dev).

| Métrica | Onde | O que mede |
|---|---|---|
| `boot.scriptStart` | `main.tsx` | Instante em que o JS do app começou a rodar: rede, service worker, download/parse do bundle e avaliação dos módulos (i18n incluso). O pedaço que nenhuma otimização de SQLite alcança |
| `boot.ttfb` | `bootMetrics.ts` | `responseEnd` do documento. Perto de zero quando o service worker serve; alto isola a rede |
| `boot.firstPaint` | `bootMetrics.ts` | O navegador pintando o fundo da página com o `<div id="root">` ainda vazio — **o começo da janela em branco que o usuário percebe** |
| `boot.firstContentfulPaint` | `bootMetrics.ts` | Primeiro conteúdo pintado; neste app, o React já ter renderizado. Firefox só publica esta, não a de cima — a janela em branco cai para ela quando `first-paint` não existe |
| `boot.worker.wasm` / `.openDb` / `.migrations` / `.tableHashes` / `.total` | `worker.ts` → `init()` | Partida do storage, fase a fase. Cada uma tem um remédio diferente: bundle, VFS do OPFS, DDL pendente e o backfill de `table_hashes` (`CS-34`/`CS-39` — barato depois da primeira vez, caro exatamente uma vez por bump de `HASH_VERSION`) |
| `boot.storageReady` | `App.tsx` | A partida do storage vista da thread principal (via `storage.ready()`, no-op que a fila do worker só resolve depois do `init()`). Menos `boot.worker.total` = custo de subir o próprio worker |
| `boot.loadDataFile` | `App.tsx` | Leitura do cofre inteiro do OPFS para a memória. **A única fase que cresce com o tamanho do cofre** |
| `storage.loadDataFile.transactions` | `StorageService.ts` | `M-91`: a fatia de `loadDataFile()` gasta com `transactions`, fila do worker inclusa |
| `storage.getTransactions.rows` | `StorageService.ts` | `M-91`: SQLite lendo o OPFS + clone estruturado do `postMessage`. **Domina tudo** — a diferença para a métrica acima é o tempo de fila |
| `storage.getTransactions.map` | `StorageService.ts` | `M-91`: esta thread montando um objeto por transação. Medida junto com a de cima, uma escondia a outra |
| `boot.hydrateStore` | `App.tsx` | `loadData()` na store Zustand |
| `boot.derive` | `App.tsx` | `refreshRecurrenceHorizons()` + `ensureQuadrantesBatch()` — manutenção que roda em todo boot e pode clonar o `DataFile` inteiro |
| `boot.dataReady` | `App.tsx` | Instante em que os dados ficaram prontos e o React foi liberado para renderizar |
| `boot.firstRender` | `App.tsx` | Instante em que o primeiro render real foi cometido. Menos `boot.dataReady` = custo de desenhar a tela inicial |
| `boot.shellVisible` | `BootSkeleton.tsx` | **Instante em que a primeira coisa aparece na tela** — a silhueta do app (`M-90`). É a métrica de *tempo percebido*: não melhora nem piora com o tamanho do cofre |
| `boot.appVisible` | `bootMetrics.ts` | Instante do frame pintado com a interface real (par de `requestAnimationFrame` após o commit). Menos `boot.shellVisible` = quanto tempo o esqueleto ficou em cena |
| `boot.blankWindow` | `bootMetrics.ts` | **A duração da tela vazia** — o sintoma relatado. Termina na primeira coisa que aparece (o esqueleto, desde o `M-90`), não na última. Contada do `first-paint` onde ele existe (Chromium) e do `boot.scriptStart` onde não (Firefox); nunca do FCP, que neste app chega junto com a interface e reportaria dezenas de ms para um boot de segundos |

Consumo: o mesmo de sync — Bug Report System (F-26), categoria "performance", sem UI nova. Em dev,
o `PerfPanel` (`Alt+Shift+P`) já lista tudo isto sem precisar de mudança nenhuma.

### Primeira leitura real (M-87, 2026-08-28)

Duas coletas do mantenedor, no build de produção local (`npm run preview`), cofre real de 26.576
transações, mesma máquina, lidas pelo Bug Report System — Chrome 151 e Firefox 153:

| | Chrome 151 | Firefox 153 |
|---|---|---|
| `boot.scriptStart` | 120,5 | 231 |
| `boot.storageReady` | 102,9 | 59 |
| ↳ `boot.worker.migrations` | 51,5 | 8 |
| **`boot.loadDataFile`** | **2.311,4** | **2.028** |
| `boot.derive` | 1,3 | 2 |
| `boot.dataReady` | 2.562,3 | 2.323 |
| `boot.firstRender` | 2.905,2 (render: 343) | 2.551 (render: 228) |
| `boot.appVisible` | 2.954 | 2.579 |
| **janela em branco** | **2.802** | **~2.348** |

Três conclusões, nenhuma delas inferida:

1. **O boot é `loadDataFile()`** — 80% do total no Chrome, 87% no Firefox. Bundle, wasm, OPFS,
   migrations, hashes, React e sync somados não passam de 20%. A soma das fases fecha com
   `boot.dataReady` a menos de 30ms nos dois navegadores: a linha do tempo não tem pontos cegos.
2. **O descompasso Firefox×Chrome do `CS-31` não se reproduz aqui.** Lá, a mesma consulta custou
   6,7s no Firefox contra 52ms no Chrome; neste boot o Firefox foi 12% **mais rápido**. Seja o que
   for que causou aquele número, não é uma propriedade estável da engine — quem for atrás do
   `CS-31` deve tratá-lo como não reproduzido até nova evidência.
3. **O mesmo ciclo em `npm run dev` deu 4,2s**, com o render em ~1.000ms em vez de ~340ms
   (inflacionamento dev do React, `M-75` de novo) e as durações duplicadas pelo `<StrictMode>`:
   medir boot em dev leva à conclusão errada sobre onde está o custo.

### Tempo percebido × tempo total (M-90)

O `M-87` mediu o problema; o `M-90` atacou a metade dele que dá para atacar sem tocar em premissa
nenhuma da store — **a mesma manobra do `CS-52`**, que tirou a publicação do caminho percebido sem
torná-la mais rápida. Aqui: a interface não depende do cofre, só os números dependem, então a
silhueta do app pode pintar imediatamente enquanto o SQLite é lido.

Mesmo cofre, mesmo build de produção, medido antes e depois:

| | antes (M-87) | depois (M-90) |
|---|---|---|
| `boot.blankWindow` (tela vazia) | 2.802 | **88,8** |
| `boot.shellVisible` | — | 108,8 |
| `boot.appVisible` (números reais) | 2.954 | 3.033,9 |

**O total não melhorou — e não era para melhorar.** O que mudou é que a espera deixou de ser
indistinguível de um travamento: 89ms de nada, depois ~2,9s de app visivelmente carregando. Quem
for medir a próxima otimização deve olhar as duas métricas juntas; `boot.appVisible` sozinho diria
que nada aconteceu, e `boot.shellVisible` sozinho diria que o boot ficou 30x mais rápido. Nenhum
dos dois é verdade isoladamente.

### Onde estão os 2,3s do `loadDataFile` (M-91)

O `M-90` tirou a tela vazia do caminho percebido, e a reclamação seguinte foi o esqueleto ficar em
cena tempo demais — ou seja, o problema voltou a ser tempo real. Como o `loadDataFile` era um bloco
opaco, a primeira coisa foi abri-lo. Atribuição, no cofre real de 26.576 transações:

| | |
|---|---|
| SQLite lendo + materializando as linhas (dentro do worker) | **~95%** |
| Clone estruturado do `postMessage` (worker → thread principal) | ~4% (150-260ms) |
| Montagem dos objetos `Transaction` na thread principal | ~5% (207-308ms) |

E dentro do worker, medido pelo console com `window.__storage.query()` (mesma ferramenta do `M-72`):

| Consulta | Tempo |
|---|---|
| `SELECT COUNT(*)` — varredura, sem materializar linha | **89ms** |
| `SELECT id` — 26.576 linhas, 1 coluna | 619ms |
| `SELECT t.*` — 26.576 linhas, 20 colunas (o que o boot faz) | 5.398ms |
| `SELECT t.*` de um ano só — 2.146 linhas | **654ms** |

**Ler o arquivo não é o custo — materializar linha é.** Uma fatia sai proporcionalmente barata, o
que é a evidência que sustenta a opção (b) do `M-88`.

**Hipótese testada e descartada:** extrair tudo numa célula só com `json_group_array(json_object(…))`
(o build tem json1) para pagar uma travessia em vez de 26.576×20. Numa medição isolada pareceu 1,8x
melhor; num A/B intercalado de 5 rodadas ficou em **1,03x — ruído**. O gargalo não é a fronteira
JS↔WASM. Não repetir este teste sem uma hipótese nova.

> **Aviso de método, aprendido nesta rodada:** a mesma consulta variou de 4,0s a 8,0s na mesma
> sessão, numa máquina com outros processos rodando. Qualquer comparação aqui exige rodadas
> intercaladas e mediana — uma leitura isolada não distingue otimização de sorte. É a mesma
> armadilha do `CS-50`, em outra roupa.

## Changelog

- **M-91 (2026-08-28)** — atribuição de dentro do `loadDataFile` (seção acima). Duas lições: uma
  fase opaca que domina o boot é indistinguível de um mistério — abrir a caixa custou 3 métricas e
  respondeu em uma tarde o que estava em aberto desde o `M-87`; e uma hipótese de otimização
  plausível (json1) só sobreviveu até o primeiro A/B intercalado.
- **M-90 (2026-08-28)** — esqueleto de boot e a métrica de tempo percebido (seção acima). O achado
  que vale carregar: **uma métrica de tempo total não consegue enxergar um ganho de percepção.** Se
  o `boot.shellVisible` não existisse, esta mudança apareceria na telemetria como "nada mudou, e o
  `appVisible` até subiu 80ms" — que é literalmente verdade e completamente irrelevante para quem
  usa o app. Todo trabalho de percepção precisa nascer com a métrica que o torna verificável, senão
  vira discussão de opinião.
- **M-87 (2026-08-28)** — instrumentação de boot (seção acima). Dois achados de método, ambos
  sobre a métrica mentir em vez de faltar — na mesma linha do `CS-51`:
  1. A primeira versão media só o `first-contentful-paint`, e ele chega **junto** com a interface:
     sugeria que não havia janela em branco nenhuma. É `first-paint` que marca o fundo aparecendo.
  2. Corrigido isso, o FCP ficou como substituto do `first-paint` onde ele não existe — e a
     primeira coleta real em Firefox mostrou o estrago: FCP em 2.559ms com a tela pintada em
     2.579ms daria uma "janela em branco" de 20ms para um boot que teve ~2,3s dela. O substituto
     certo é o `boot.scriptStart` (dezenas de ms do `first-paint`, porque o CSS que pinta o fundo
     vem do mesmo `<head>`). **Um substituto plausível e errado é pior que um buraco declarado no
     dado** — o buraco você percebe, o número errado você usa.
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
  5. A quinta (`CS-52`/`CS-53`) atacou o que sobrou pela ótica certa — **o que o usuário espera**,
     não o que o sync faz. Tirar a publicação do caminho percebido e ler o manifesto do peer via
     `appProperties` levou o sync incremental a **3,0-3,4s em 3 chamadas**, o piso deste desenho.
     Fechamento do épico: **~4x mais rápido que o transporte monolítico, com 40% das chamadas.**

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
