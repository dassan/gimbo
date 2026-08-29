# Hidratação por Janela + Agregação em SQL (épico HY)

> Proposta de desenho, não implementação. Origem: `M-88` (correções possíveis para o boot),
> instruída pelos números do `M-87`, `M-90` e `M-91`. Mesmo papel que
> `plan/SYNC_PARTITIONED_TRANSPORT.md` teve para o épico `CS-37..CS-55`.
>
> **⚠️ ÉPICO ENCERRADO SEM SER IMPLEMENTADO. Nada de §5 a §9 deve ser construído.**
>
> O `M-88` foi resolvido em 2026-08-29 por `HY-20`: `locking_mode=EXCLUSIVE` + `journal_mode=WAL`,
> duas linhas em `runMigrationsOn`, leitura 2,6x e escrita 60x. A VFS do OPFS só mantém o
> `SyncAccessHandle` aberto sob lock exclusivo; sem ele cada página passava por `getFile()` +
> `Blob.slice()` + `arrayBuffer()`. Agregados, janela, `hydration` no `DataFile`, `CompleteDataFile`
> e guarda de escrita atacavam um gargalo que não era o gargalo.
>
> Sobra o piso de materializar linha (671-950ms), que só uma janela cortaria. Reabrir este desenho
> **apenas** se esse piso voltar a incomodar — sabendo que ele rende menos do que §8 estimava e que
> os riscos do §6 continuam iguais.
>
> **Ler §4.1 antes de qualquer coisa.** O `HY-16`
> (2026-08-29) encontrou a causa raiz do boot lento — travessia Asyncify por página lida na VFS do
> OPFS —, e uma página de 64KB entrega 5,3x na leitura fria com um PRAGMA e um `VACUUM` de 1,3s.
> As §5 a §9 abaixo descrevem um épico (agregados, janela, `hydration`, guarda de escrita) que
> atacava um gargalo que não era o gargalo. Ficam como registro, e como plano B caso o custo de
> escrita (`HY-17`) reprove a página maior.
>
> **Atualizado em 2026-08-28**, depois de ler o código que este desenho assumia. Duas fases
> preparatórias foram executadas (`HY-13`, `HY-14`) e três pontos do desenho mudaram — §4.1 (eixo
> de colunas), §5.0 (motor único de saldo), §6.1 (o vetor de perda de dado é o sync) e §9.1 (a
> janela é um conjunto de anos). O restante segue proposta.
>
> Ler `plan/MONITORING.md` §"Onde estão os 2,3s do `loadDataFile`" antes — este documento assume
> aqueles números.

---

## 1. O problema, em uma frase

O app não desenha nada de verdade até ter **todas** as transações na memória, e materializar 26.576
linhas custa 2,3s num cofre real (80-87% do boot). O esqueleto do `M-90` tirou a tela vazia do
caminho percebido; o que sobrou é tempo real, e ele só cai lendo menos.

## 2. O que já foi medido (não repetir)

| Fato | Número | Origem |
|---|---|---|
| Ler o arquivo não é o custo | `SELECT COUNT(*)` = **89ms** | M-91 |
| Materializar linha é o custo | `SELECT t.*` (26.576×20) = **5.398ms** | M-91 |
| Uma fatia sai proporcional | um ano (2.146 linhas) = **654ms** | M-91 |
| Transferência `postMessage` | ~4% | M-91 |
| Montagem de objetos na thread principal | ~5% | M-91 |
| Extrair tudo numa célula (json1) | **1,03x — não ajuda** | M-91 |

**Conclusão que sustenta este épico:** o custo é proporcional a linhas materializadas, e agregar em
SQL não materializa linha nenhuma. Um `SUM` por conta deve custar como o `COUNT(*)`.

## 3. A forma real do cofre (26.576 transações, 2015-07 a 2034-12)

| Recorte | Linhas | % |
|---|---|---|
| `date < 2026-01-01` (passado fechado) | 22.049 | **83%** |
| 2026 até hoje | 1.912 | 7% |
| Futuro (`date >` hoje) | 2.615 | 10% |

Uma janela de `date >= 2026-01-01` (ano corrente + todo o futuro) são **4.527 linhas, 17% do
cofre** — pela proporcionalidade medida, ~0,4s em vez de 2,3s.

O futuro é grande porque a projeção de recorrências (`B-22`/`M-62`) gera até 2034, e há 455
parcelas com data futura.

## 4. A hipótese do mantenedor, testada

> "O passado de um cofre é raramente modificado; o futuro varia mais."

`updated_at` **não serve de evidência** — o `scripts/sync_gimbo.py` carimba o timestamp do run em
toda linha (`B-32`), e o cofre real tem **um único valor distinto**. O `created_at`, esse sim, vem
do Organizze e é preservado (`CC-34`/`M-64`):

| Linha criada, em relação à data dela | Linhas | % |
|---|---|---|
| >30 dias **antes** (agendou o futuro) | 6.479 | **24,4%** |
| mesmo dia (±1) | 14.689 | 55,3% |
| >30 dias **depois** (escreveu no passado) | 323 | **1,2%** |

Por ano recente, escrita no passado fica em 0,3-0,5% das linhas. **A hipótese se sustenta** — com
duas ressalvas honestas: isto mede *criação*, não *edição* (uma correção num lançamento antigo não
aparece aqui, e o campo que mostraria isso é justamente o inutilizável), e reflete o uso de uma
pessoa só.

O carimbo do `sync_gimbo.py` **tem conserto** e vale consertar (`CS-57`) — mas pelo bem do sync, não
deste épico: é a hipótese líder, ainda aberta, do `CS-36`, onde um dispositivo pulou 19 de 20 anos
no hash-skip e o outro não pulou nenhum. Dois cofres semeados por execuções diferentes do script
carregam `updated_at` distintos para linhas de conteúdo idêntico, e o hash do ano diverge
corretamente sobre uma diferença que não existe. Nada disso muda o desenho abaixo: mesmo com o
campo consertado, ele continua não sendo o detector certo (§7).

**Por isso o desenho abaixo não depende dela para estar correto** — só para ser rápido. Ver §6.

## 4.1 O que a medição do `HY-13` mudou (2026-08-29)

O §2 concluiu que o custo é proporcional a linhas materializadas e que agregar em SQL resolveria.
A ferramenta construída para testar o eixo de colunas mediu isso de verdade, no cofre real, em
build de produção, e mudou duas coisas.

**Podar coluna não paga.** 20 → 9 colunas rendeu 1,00-1,21x em quatro medições, com as amostras se
sobrepondo — contra 2,1-2,5x previstos. O eixo de colunas está descartado, e com ele a divisão de
tipo (`CoreTransaction`) que ele obrigaria a introduzir.

**O custo é super-linear no tamanho do resultado, e só no navegador.**

| | linhas | wa-sqlite/OPFS | SQLite nativo |
|---|---|---|---|
| `all20win` | 4.673 | 230ms | 24,5ms (9,2x) |
| `all20` | 26.576 (5,7x) | 8.377ms (**38x**) | 142ms (5,8x) |

Expoente 2,1 — quadrático. Não é I/O da tabela: `SELECT id` usa índice de cobertura, nunca toca a
tabela, e ainda assim custa 1.856ms contra 18ms nativo. O que custa é **produzir N linhas em JS
dentro do worker**, e o custo por linha piora conforme o resultado cresce. Pressão de heap/coleta de
lixo explica o expoente.

### O desfecho (2026-08-29)

As duas hipóteses acima — poda de coluna e leitura em lotes — foram **refutadas por medição**, e a
segunda refutação é que levou à resposta. Se fatiar não ajuda, o custo não está no acúmulo do
resultado; está em algo proporcional ao arquivo. É a VFS: `OriginPrivateFileSystemVFS.xRead`
envolve toda leitura de página em `handleAsync()`, o unwind/rewind da pilha WASM do Asyncify, e o
cofre tem 3.489 páginas de 4KB.

| | páginas | leitura fria | por página |
|---|---|---|---|
| 4KB (hoje) | 3.489 | 8.141ms | 2,06ms |
| 64KB | 237 | **1.527ms** | 2,43ms |

O piso de materializar as 26.576 linhas — medido com cache grande o bastante para não ler página
nenhuma — é de **950ms**. Todo o resto é travessia, e ela custa o mesmo para 4KB e para 64KB.

**O que este épico inteiro pretendia entregar, uma linha de PRAGMA entrega:** leitura fria 5,3x mais
rápida, sem tabela de agregados, sem janela, sem `hydration` no `DataFile`, sem `CompleteDataFile`,
sem guarda de escrita e sem nenhum dos riscos de perda de dado do §6. Falta medir o custo de
escrita (`HY-17`) para escolher o tamanho de página, e depois aplicar (`HY-18`).

O parágrafo abaixo é o raciocínio que levou até aqui, mantido porque a hipótese que ele levanta
também foi medida e reprovada:

**Consequência para este épico, e ela é grande:** existe um terceiro caminho que o desenho não
considerou. Se o custo é super-linear no tamanho do resultado, **ler o mesmo total em K lotes
recupera o regime linear** — pelo expoente medido, ~1,2s com 5 lotes e ~310ms com 20, para o cofre
**inteiro**. Sem janela, sem `hydration` no `DataFile`, sem guarda de escrita, sem tabela de
agregados, sem `CompleteDataFile`, sem risco de perda de dado. O `HY-15` mede isso; **nada do
`HY-01` em diante deve começar antes dessa coleta**, porque ela pode reduzir o épico a uma mudança
pequena em `getTransactions()`.

Se o ganho por lotes vier menor que o esperado, a janela por anos continua valendo — e vale **mais**
do que o §8 estimou, porque a super-linearidade trabalha a favor dela: cortar para 26,5% das linhas
não rende 3,8x, rende algo perto de 38x na consulta.

## 5. Desenho

### 5.0 Pré-requisito, feito: um único motor de saldo (`HY-14`)

O §5.4.2 propõe provar `saldo(agregado + janela) === saldo(cofre inteiro)`. Não havia o que provar:
a regra existia em **cinco** cópias — Dashboard e Configurações (cópia literal uma da outra),
`getReserveBalance`, `applyTx`/`computeAssetBalances` do Patrimônio Líquido e o `balanceUpTo` do
rodapé de Lançamentos —, e três delas já tinham divergido em detalhes.

Agora é uma só: `computeAccountBalances(transactions, seeds, { after?, asOf? })` em `lib/utils.ts`.
As sementes decidem quais contas participam (é assim que CREDIT fica de fora), e as opções de data
deixam **visível no ponto de chamada** o que estava enterrado: o Dashboard conta lançamento futuro
já marcado como pago; Patrimônio e Lançamentos cortam em hoje. Essa divergência é anterior a este
épico e segue em aberto como decisão de produto — o que mudou é que agora dá para vê-la.

### 5.1 Não construir detector de modificação do passado — já existe um

A tentação natural é criar um mecanismo que perceba quando o passado mudou. **Não precisa:** o
`CS-32` já particionou `transactions` por ano em `table_hashes`, e o `applyTransactionDelta`
(`worker.ts`) já descobre, antes de escrever, quais anos um delta toca — inclusive o ano *antigo*
de uma transação que mudou de data. Deleções entram pelo mesmo caminho.

O agregado passa a ser **mais uma coisa mantida na mesma partição, pelos mesmos 3 pontos de
escrita** (`writeSmallTables`/`applyTransactionDelta`/`replaceAll`), com o mesmo backfill por
sentinela de versão (`ensureTableHashesCurrent`, `CS-34`/`CS-39`). Zero mecanismo novo — foi assim
que o `CS-30`/Fase 1 reaproveitou o `M-73` em vez de inventar um write-path.

Consequência importante: **a correção não depende da hipótese do §4.** Se o passado mudar todo dia,
o agregado do ano afetado é recomputado e continua exato; a hipótese só decide se isso acontece
raramente (barato) ou sempre (caro). Recomputar um ano é um `SUM` sobre ~2 mil linhas.

### 5.2 O agregado, derivado da fórmula de saldo que o código já usa

`computeAccountBalances` (§5.0) aplica a regra do `CLAUDE.md` ("Saldo de conta"):
`balance + INCOME − EXPENSE − TRANSFER − CREDIT_PAYMENT`, com `isCashRealized()` filtrando
INCOME/EXPENSE por `isPaid` e TRANSFER/CREDIT_PAYMENT creditando/debitando a conta do outro lado
via `transferAccountId`. O agregado precisa cobrir exatamente isso:

```sql
CREATE TABLE transaction_aggregates (
  year        TEXT    NOT NULL,  -- 'YYYY' — mesma chave de partição de table_hashes
  account_id  TEXT    NOT NULL,
  side        TEXT    NOT NULL,  -- 'own' = account_id | 'peer' = transfer_account_id
  type        TEXT    NOT NULL,  -- INCOME | EXPENSE | TRANSFER | CREDIT_PAYMENT
  is_paid     INTEGER NOT NULL,  -- irrelevante para TRANSFER/CREDIT_PAYMENT (sempre 1)
  sum_amount  REAL    NOT NULL,
  row_count   INTEGER NOT NULL,  -- serve de conferência contra table_hashes.row_count
  PRIMARY KEY (year, account_id, side, type, is_paid)
);
```

Ordem de grandeza: 47 contas × 4 tipos × 2 × 2 lados × 20 anos é o teto teórico; na prática a
tabela é esparsa e pequena — lê-se inteira em milissegundos.

Recomputar um ano usa `date >= ? AND date < ?` (`yearRange()`), **nunca `LIKE`** — a armadilha do
`CS-51`, que custou 10-17x em dois caminhos quentes.

### 5.3 Hidratação em duas ondas

- **Onda 1** — tabelas pequenas + `transaction_aggregates` + transações com `date >= corte`.
  Corte padrão: início do ano corrente (alinhado à partição de ano). ~17% das linhas.
  A store passa a carregar um `DataFile` com `hydration: 'window'`.
- **Onda 2** — o restante do histórico, em segundo plano, sem bloquear nada. Ao terminar, a store
  vira `hydration: 'complete'` e nada mais depende de agregado.

Saldo na onda 1 = `account.balance` + Σ agregados dos anos `< corte` + a soma em JS das linhas da
janela. **Exato, não aproximado** — é a mesma conta, com a metade antiga pré-somada.

### 5.4 Como impedir que uma tela mostre número errado na onda 1

Este é o ponto que decide se o épico vale a pena. Um esqueleto ninguém confunde com um saldo; um
saldo errado, sim. Três camadas, da mais forte para a mais fraca:

1. **Tipo.** `DataFile` ganha `hydration`. Funções que só sabem trabalhar com histórico completo
   (`Analytics`, faturas antigas, busca, auditoria) passam a exigir `CompleteDataFile`, e o
   TypeScript recusa compilar uma tela que leia histórico na onda 1. O `noImplicitAny`/strict do
   projeto já é a cultura certa para isso.
2. **Prova por teste.** Teste de propriedade: para cada conta, `saldo(agregado + janela) ===
   saldo(cofre inteiro)`, exercitando transação movida de ano, `isPaid` alternado, TRANSFER e
   CREDIT_PAYMENT cruzando a fronteira do corte, deleção com lápide, import e merge.
3. **Verificação em produção, que reporta e nunca bloqueia.** Quando a onda 2 termina, recalcular o
   saldo pelo caminho completo e comparar com o que a onda 1 exibiu; divergência vira métrica
   (`hydration.balanceMismatch`). É exatamente o padrão do `sync.drive.partitionHashMismatch`
   (`CS-46`), que existe para detectar regressão silenciosa em campo.

### 5.5 Fases

| Fase | Entrega | Espelha |
|---|---|---|
| **HY-1** | Tabela de agregados + manutenção incremental + backfill por sentinela. **Nenhuma mudança de leitura.** | `CS-32` (Fase 2a) |
| **HY-2** | Leitura em duas ondas, `hydration` no `DataFile`, Dashboard correto na onda 1; **todas as outras telas esperam a onda 2** | `CS-33` (Fase 2b) |
| **HY-3** | Estender a onda 1 a mais telas, uma por vez, cada uma com prova de equivalência | demand-driven |

HY-1 é seguro por construção: escreve uma tabela nova que ninguém lê ainda. É onde o `CS-32`
descobriu o bug de normalização do `updatedAt` antes que qualquer leitura dependesse dele.

## 6. Riscos

1. **`diffTransactions` contra uma janela apagaria 83% do cofre.** `mutate()` persiste por diff
   (`M-73`) entre `_lastPersisted` e o estado atual. Se o usuário editar algo durante a onda 1, o
   diff verá 22 mil transações "ausentes" e emitirá `DELETE` para todas. É o risco mais grave deste
   épico e da mesma família do `CS-24` (perda silenciosa de dado).

   **Corrigido em 2026-08-28 (`HY-06`): o vetor principal não é o FAB, é o sync**, e a mitigação
   originalmente proposta aqui — uma guarda dentro de `debouncedApplyMutation()` — não o cobria.
   `App.tsx` dispara `runPeerSync()` imediatamente depois de hidratar, passando `get().data` ao
   merge; o `computeDelta` escopado por ano (`driveTreeSyncService.ts`, `CS-52`) compara o ano
   inteiro lido do disco contra `merged.transactions` filtrado pelo mesmo ano, e com um `DataFile`
   de janela esse segundo lado vem **vazio** — `DELETE` para o ano inteiro. Esse caminho chama
   `storage.applyMutation()` direto, que é a exceção reconhecida do `M-73`, e portanto passa ao
   largo de qualquer guarda no debounce. `startSyncPolling()`, na linha seguinte, mantém o risco
   vivo enquanto o app estiver aberto.

   **Mitigação obrigatória, revisada:** a guarda vai **no tipo** —
   `applyMutation(data: CompleteDataFile, …)` —, que cobre `mutate()` e sync por compilação, e
   `runPeerSync()`/`startSyncPolling()` só começam depois da onda 2. Desabilitar FAB/drawer é só a
   parte visível. Bônus da mesma mudança: `refreshRecurrenceHorizons()`/`ensureQuadrantesBatch()`
   (§6.2) hoje rodam no caminho crítico do boot e clonam o `DataFile` inteiro — tirá-las de lá é
   ganho que o §8 não contabiliza.
2. **Manutenção de boot precisa do histórico.** `refreshRecurrenceHorizons()` (`B-22`) decide o
   topo de cada série pela última ocorrência conhecida, e `ensureQuadrantesBatch()` (`BX-07`) pode
   sugerir meta por histórico. Ambas passam para a onda 2. Rodá-las sobre uma janela não geraria
   dado errado por acaso — geraria por desenho.
3. **Bump de schema físico → `scripts/sync_gimbo.py` junto.** `v17` novo exige atualizar
   `SCHEMA_DDL` e `PRAGMA user_version` do script **no mesmo commit**, mais `MAX_KNOWN_DB_VERSION`.
   Já esqueceram disso no `M-51` e no `M-64`.
4. **Não transportar agregados no sync.** São estado derivado local; incluí-los no manifesto criaria
   uma segunda fonte de verdade que pode divergir entre dispositivos. `replaceAll()` (merge)
   recomputa, como já faz com `table_hashes`.
5. **Fronteira do corte.** Invariante estrito: agregado cobre `date < corte`, janela cobre
   `date >= corte`, sem sobreposição nem buraco. Um erro de um dia aqui é dinheiro contado duas
   vezes. O `row_count` do agregado somado ao das linhas da janela tem que bater com o
   `COUNT(*)` da tabela — conferência barata, e vale como asserção em teste.
6. **Ganho menor que o esperado.** Se a onda 2 (o histórico inteiro) continuar custando 2s, ela
   compete com a interação do usuário logo depois do boot. Medir `hydration.wave2` desde o começo;
   se incomodar, a saída é fatiar a onda 2 por ano em vez de uma leitura só.

## 7. O que **não** fazer

- Não usar `updated_at` como detector de partição suja. **O motivo não é o `sync_gimbo.py`** (esse
  problema tem conserto — `CS-57`), e sim que ele é um campo de *cronologia*, não um mecanismo de
  invalidação: (a) **deleção não deixa `updated_at`** — a linha sumiu, e o agregado daquele ano
  ficaria velho para sempre; (b) descobrir "o que mudou desde T" por varredura exige um índice novo
  em `updated_at` e ainda assim só chega ao ano *novo* de uma transação que mudou de data, nunca ao
  antigo — que é justamente o que precisa ser recomputado; (c) `replaceAll()` (merge de sync,
  import) troca tudo de uma vez, sem passar por carimbo de linha. O `applyTransactionDelta` já
  entrega os anos afetados de forma síncrona, no momento da escrita, cobrindo os três casos.
- Não reimplementar detecção de partição suja: `table_hashes` + `applyTransactionDelta` já fazem.
- Não repetir o teste do `json_group_array` sem hipótese nova — 1,03x, medido (`M-91`).
- Não deixar a onda 1 gravar nada (§6.1).
- Não medir nada disso em `npm run dev` nem numa máquina carregada — `M-87` e `M-91` documentam as
  duas armadilhas.

## 8. Ganho esperado e como comprovar

Estimativa pela proporcionalidade medida: primeira tela em **~0,5s** em vez de 2,3s (~4,5x), com o
histórico completo chegando em segundo plano. As métricas que provam isso já existem
(`boot.shellVisible`, `boot.dataReady`, `boot.appVisible`, `storage.getTransactions.rows`); faltam
duas: `hydration.wave1` e `hydration.wave2`.

Ritual de validação: build de produção, cofre real, rodadas intercaladas e mediana — nunca uma
leitura isolada (`M-91`).

## 9. Decisões em aberto para o humano

1. ~~**Corte da janela:** início do ano corrente ou últimos N meses?~~ **Respondido em
   2026-08-28: nenhum dos dois.** A janela é um **conjunto de anos**, sempre `{ano corrente, ano
   anterior}`. `getInvoicePeriod` rola a fatura para frente, então uma compra em 28/12 num cartão
   que fecha dia 25 pertence à fatura de janeiro; com corte em 1º de janeiro, o limite disponível e
   o total de faturas ficariam errados o mês inteiro — e o agregado **não** conserta, porque
   `getOpenCreditBalance` precisa de linha, não de soma. Custo no cofre real: 4.527 linhas (17%) →
   7.054 (26,5%). Em troca, o risco §6.5 (dinheiro contado duas vezes) deixa de existir por
   construção: agregado = todo ano fora da janela, mesma chave do `table_hashes`, sem data solta em
   lugar nenhum. Pelo mesmo mecanismo dá para descartar o futuro distante (2028-2034 = 1.936 linhas,
   7,3%, pura projeção de recorrência).
2. **Onda 1 read-only** é aceitável como comportamento de produto, mesmo durando ~2s?
3. **Escopo do HY-2:** só o Dashboard na onda 1, ou já incluir a tela de Lançamentos (que é onde o
   usuário mais cai vindo de um refresh)?
4. Vale fazer **HY-1 sozinho** primeiro e medir o custo de manutenção real por mutação, antes de
   assumir o compromisso do HY-2?
