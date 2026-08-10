# Caixinhas (Budgets) — F-30

> Histórico de produto e design da feature **Caixinhas** (rotas `/budgets` e `/budgets/:budgetId`).
> Estado atual: **protótipo visual mockado** — nenhuma entidade nova no `DataFile`, nenhuma
> mutação de dados, nenhum teste. Toda a tela lê de `app/src/pages/Budgets/mock.ts`.
> Branch: `dassan/caixinhas` (2 commits, ainda **não publicada**).
> Última atualização: 2026-08-10.

---

## 1. Objetivo

Permitir que o usuário **se planeje** em relação às suas receitas e despesas: define um orçamento de
referência (a "caixinha"), associa lançamentos a ela e acompanha o progresso contra a meta.

Diferença em relação às telas que já existem: Relatórios e Saúde Financeira olham para o **passado
consolidado** (o que aconteceu, o que já está comprometido). A caixinha olha para um **objetivo
declarado pelo usuário** — uma viagem, uma reforma, uma meta de renda extra — e mede a distância
até ele. É a primeira superfície do app onde o usuário diz o que *pretende*, não apenas registra o
que ocorreu.

---

## 2. Modelo conceitual

Uma caixinha tem:

| Propriedade | Descrição |
|-------------|-----------|
| Nome | Texto livre |
| Emoji | Avatar visual (hoje uma paleta fixa de 9 opções) |
| Tipo | `expense` (teto de gasto) ou `income` (meta a atingir) |
| Meta (`target`) | Valor de referência |
| Período | **Data única** (data-alvo) **ou** intervalo fechado (início → fim) |
| Lançamentos | Lista de transações associadas |
| Valor atual | Σ dos lançamentos associados (derivado) |
| Diferença | `target − atual` (despesa) ou `atual − target` (receita) — sempre orientada para que **positivo = folga** |

### Semântica do tipo

O tipo inverte o sentido do medidor, e isso é intencional:

- **Despesa** — a meta é um **teto**. Chegar a 100% é ruim.
- **Receita** — a meta é um **piso**. Chegar a 100% é o objetivo.

Régua de status (`helpers.ts` → `getBudgetStatus`):

| Tipo | Faixa | Status | Cor |
|------|-------|--------|-----|
| Despesa | < 80% | `onTrack` — "No ritmo" | `#2D6A4F` verde |
| Despesa | 80–100% | `warning` — "Atenção" | `#D4A017` âmbar |
| Despesa | > 100% | `exceeded` — "Estourou" | `#C0392B` vermelho |
| Receita | < 100% | `warning` — "Atenção" | `#D4A017` âmbar |
| Receita | ≥ 100% | `reached` — "Atingida" | `#2D6A4F` verde |

As três cores são exatamente as mesmas dos medidores de Saúde Financeira, de propósito.

---

## 3. Anatomia das telas

### Navbar

Item **"Caixinhas"** entre "Lançamentos" e "Relatórios" na navbar desktop, conforme pedido.
**Não entra no bottom nav mobile** — os 5 slots já estão ocupados (Visão Geral, Lançamentos, +,
Relatórios, Configurações), mesma decisão tomada em Patrimônio e Saúde.

### Tela 1 — Lista (`/budgets`)

Título + subtítulo, botão **"Nova caixinha"** à direita, e a grade de cards. Nada mais: o painel de
"Visão geral" (contagem, total atual, total das metas) chegou a existir e **foi removido** a pedido,
para a primeira versão ficar só nos cards.

Grade responsiva: **1 coluna** (mobile) → **2** (`sm`) → **4** (`xl`).

Cada card (~296px no desktop), inteiro clicável:

```
Viagem para Portugal      [No ritmo]
Despesa · 4 lançamentos

META
R$ 18.000,00

▓▓▓▓▓▓░░░░░░
57% da meta (R$ 10.180,55)
Disponível R$ 7.819,45
```

- O medidor é ancorado no rodapé (`mt-auto`), então as barras alinham entre cards de alturas
  diferentes na mesma linha.
- O card inteiro é o `Link` para o detalhe — num tile estreito não sobra espaço para uma área
  clicável menor.

### Tela 2 — Detalhe (`/budgets/:budgetId`)

Inspirada na tela de fatura de cartão (`/credit-card/:accountId`):

1. Link **"Todas as caixinhas"** (volta para `/budgets`).
2. **Cabeçalho**: emoji `lg` + nome + selo de status; subtítulo com `tipo · período · faltam N dias`;
   botão **"Editar"** à direita. Abaixo, 4 figuras (Meta · Atual · Disponível/Excedente ·
   Lançamentos) e o medidor com a mesma frase `X% da meta (<valor>)`.
3. **Lançamentos associados** (2/3 da largura) — linhas no molde de `InvoiceTxRow`: avatar da
   categoria, descrição, categoria · conta, valor e data. Ordenados do mais recente para o mais
   antigo. Ação **"Associar lançamento"** no cabeçalho da lista (ainda sem comportamento).
4. **Resumo por categoria** (1/3, sticky) — espelha o "Resumo de gastos" da fatura.

### Modal de caixinha (criação e edição)

Um componente único, `BudgetFormModal`, com dois modos (a prop `budget` presente = edição):

| Campo | Criação | Edição |
|-------|---------|--------|
| Tipo (Despesa/Receita) | segmentado de 2 botões | **oculto** (ver §5.2) |
| Nome | ✅ | ✅ |
| Emoji | paleta de 9 | **oculto** |
| Meta | ✅ | ✅ pré-preenchida |
| Período (Intervalo/Data única) | segmentado de 2 botões | ✅ pré-preenchido, inclusive o modo |
| Excluir caixinha | — | ✅ zona destrutiva no rodapé |

Tipo e período usam o **mesmo segmentado de dois botões** — não há dropdown no modal, já que ambas
as escolhas são binárias por construção.

### Exclusão

Vive **dentro do modal de edição**, no rodapé, separada do "Salvar alterações" por uma divisória e
com peso de link (`text-xs`, `text-tertiary`) — nunca competindo com a ação primária.

Ao clicar, o link é substituído **no mesmo lugar** (sem empilhar um segundo modal) por um bloco de
confirmação:

> **Excluir esta caixinha?**
> Os 4 lançamentos associados continuam nos seus registros — só perdem o vínculo com esta caixinha.
> A ação não pode ser desfeita.
> `[ Cancelar ] [ Excluir ]`

O texto é a parte mais importante: "excluir caixinha" é ambíguo para quem tem lançamentos dentro
dela, e o medo de apagar transações reais trava o usuário na hora de reorganizar suas caixinhas.

---

## 4. Arquivos

| Arquivo | Papel |
|---------|-------|
| `app/src/pages/Budgets/index.tsx` | Lista `/budgets` + `BudgetCard` + `EmptyState` |
| `app/src/pages/Budgets/BudgetDetail.tsx` | Detalhe `/budgets/:budgetId` + `BudgetTxRow` |
| `app/src/pages/Budgets/BudgetFormModal.tsx` | Modal de criação/edição + zona de exclusão |
| `app/src/pages/Budgets/mock.ts` | **Dados mockados** + derivações (`budgetCurrent`, `budgetDelta`, `budgetProgress`) |
| `app/src/pages/Budgets/helpers.ts` | Status, cores, formatação de período, dias restantes |
| `app/src/pages/Budgets/shared.tsx` | `ProgressBar`, `BudgetAvatar` |
| `app/src/App.tsx` | Rotas `/budgets` e `/budgets/:budgetId` |
| `app/src/components/Navbar.tsx` | Item "Caixinhas" no `NAV_ITEMS` |
| `app/src/lib/i18n/locales/{pt-BR,en-US}.json` | Namespace `budgets.*` |

> `helpers.ts` e `shared.tsx` estão separados por causa da regra `react-refresh/only-export-components`
> do ESLint: um arquivo `.tsx` que exporta componentes não pode exportar também constantes e funções.

**6 caixinhas mockadas**, escolhidas para cobrir todos os estados: viagem (57%, no ritmo), reforma
(89%, atenção), presentes de Natal (16%, no ritmo, período de data única), freelas (75%, receita em
andamento), carro (113%, estourou), bônus anual (105%, receita atingida).

---

## 5. Decisões tomadas

### 5.1 Rota em inglês, label em português
`/budgets`, não `/caixinhas`. Segue a convenção do resto do app (`/net-worth`, `/health`), com o
nome em português vindo do i18n. **Reversível em uma linha** se você preferir a URL em português.

### 5.2 Tipo e emoji não são editáveis
Trocar o tipo de uma caixinha que já tem lançamentos associados **inverteria o sentido de todos eles
de uma vez** — de teto de gasto para meta de receita. É o tipo de mudança que merece ser bloqueada
ou avisada, não um toggle silencioso. O emoji ficou de fora só porque não foi pedido; reativar é
trivial.

### 5.3 A diferença tem rótulo variável, não sinal
Em vez de um número assinado, o card mostra **"Disponível R$ X"** quando há folga e **"Excedente
R$ X"** em vermelho quando estourou.

### 5.4 A frase do medidor é a mesma nas duas telas
`X% da meta (<valor atual>)` — o valor atual não ocupa uma figura própria no card, ele vive entre
parênteses na frase do percentual.

### 5.5 Confirmação de exclusão in-place
Sem segundo modal empilhado: a confirmação substitui o link no próprio rodapé (ver §3).

### 5.6 Caixinhas são o primitivo; "receitas" geram lotes de caixinhas automaticamente
Decisão de arquitetura (2026-08-05, ver `plan/FINANCIAL_PLAN.md` para o contexto do método DSM de
Eduardo Amuri que motivou essa análise): **Caixinha continua sendo a única entidade de dados**
(nome, meta, período, lançamentos vinculados). Funcionalidades do método DSM que pareciam exigir
modelos próprios (ex.: os "Quadrantes") são implementadas como **receitas** — módulos opt-in,
habilitados em Preferências, que criam e mantêm um conjunto de caixinhas automaticamente. Isso evita
introduzir uma segunda entidade de orçamento no schema.

#### Receita "Quadrantes" (primeira receita, ainda não implementada)

Toggle em **Preferências** (Settings), reaproveitando o padrão visual já existente do toggle de
retenção do audit log (`Settings/index.tsx` — label + descrição + switch, dentro da seção
`activeSection === 'preferences'`). Ao ser habilitada, a receita cria 4 caixinhas por mês, uma por
intervalo fixo de dias do mês corrente (dia 1–8, 9–16, 17–24, 25–fim do mês). Decisões tomadas para
a v1:

- **Associação de lançamentos**: automática, por data — todo lançamento **do tipo `EXPENSE`** cuja
  `date` cai dentro do intervalo do quadrante é vinculado a ele. `TRANSFER` e `CREDIT_PAYMENT` ficam
  de fora — do contrário uma transferência entre contas próprias ou o pagamento da fatura do cartão
  contariam como "gasto" do quadrante, e o `CREDIT_PAYMENT` ainda duplicaria um valor que já foi
  contado quando a compra original caiu em algum quadrante (mesmo raciocínio de `CLAUDE.md` sobre
  `CREDIT_PAYMENT` ficar fora de Receitas×Despesas). **Sem distinção fixo/variável na v1** — dentro do
  universo `EXPENSE`, não há filtro por categoria (isso exigiria a classificação `budgetType` de
  categoria, etapa `PL-01` de `FINANCIAL_PLAN.md`, fora de escopo por ora).
- **Origem da meta**: os 4 valores são digitados manualmente pelo usuário na primeira vez que a
  receita gera o lote do mês.
- **Virada de mês**: automática e silenciosa — ao carregar `/budgets` (ou no boot do app), se a
  receita estiver ativa, a checagem é "já existem caixinhas com `recipeSlug='quadrantes'` cujo
  período cobre o mês corrente?"; se não, cria as 4. Checagem por existência, não por tempo
  decorrido — idempotente a abrir o app várias vezes no mesmo mês. Alinhado ao princípio DSM "nunca
  recuperar o atraso": **não back-filla** meses pulados — se o usuário ficar 2 meses sem abrir o app,
  ao abrir vê direto o lote do mês atual, sem gerar retroativamente os lotes intermediários.
- **Identidade do slot no schema**: caixinhas geradas pela receita carregam dois campos extras (nulos
  em caixinhas manuais): `recipeSlug: 'quadrantes'` e `recipeSlot: 1 | 2 | 3 | 4`. Sem eles não dá
  pra achar "o quadrante equivalente do mês anterior" de forma confiável — o nome se repete todo mês
  e o período muda. O mês do lote não precisa de campo próprio: já está implícito em `period.start`.
- **Herança de meta entre meses**: cada novo lote herda o `target` da **última** caixinha existente
  com aquele `recipeSlot` (`period.start` mais recente antes do mês corrente) — no valor em que ela
  estiver no momento da virada, inclusive se editada manualmente. Não existe um "valor-modelo"
  separado da receita; a cópia é sempre caixinha → caixinha.
- **Slot excluído pelo usuário**: a receita **recria** o slot no mês seguinte, puxando a meta da
  última instância viva dele (que pode ser de mais de um mês atrás, se ele ficou uma ou mais viradas
  sem existir) — a exclusão não "aposenta" o slot permanentemente.
- **Desabilitar a receita**: só impede a geração de **novos** lotes. Caixinhas já criadas continuam
  existindo, editáveis e excluíveis normalmente, como qualquer caixinha manual — nada é apagado ou
  congelado. Reabilitar depois não faz backfill: gera direto o lote do mês corrente, mesmo fluxo do
  primeiro ativamento.
- **Nome dos 4 quadrantes gerados**: fixo, "Quadrante 1" a "Quadrante 4" — sem mês no nome, já que o
  card exibe o período abaixo do nome e a informação ficaria duplicada.
- **Emoji e cor dos 4 quadrantes (2026-08-10)**: fixos, não escolhidos pelo usuário. Emoji numérico
  por slot — 1️⃣/2️⃣/3️⃣/4️⃣, batendo com `recipeSlot` — e uma única cor neutra compartilhada pelos 4,
  `#6B7280` (Bambu 600, já usada como cor secundária/estrutural em `design/DESIGN.md` e em
  `mock.ts` na categoria "Serviços"). A cor única (em vez de uma por caixinha, como nas manuais)
  sinaliza visualmente "isto foi gerado pelo sistema", distinto das cores escolhidas à mão pelo
  usuário nas caixinhas comuns.
- **Arquivamento automático ao fim do mês (P-4, escopo desta receita — 2026-08-05)**: quando o lote
  do novo mês é gerado, o lote do mês anterior é arquivado no mesmo passo — mesmo gatilho idempotente
  descrito acima, só que arquivando em vez de criando. Segue o princípio DSM de só olhar pra frente:
  o usuário não precisa decidir nada, o quadrante encerrado simplesmente sai da lista principal.
  Arquivar é um estado de visibilidade, não exclusão — vínculos com lançamentos e histórico
  permanecem intactos, e a busca de "última instância de um `recipeSlot`" (herança de meta, acima)
  **inclui** caixinhas arquivadas, senão a cadeia de herança quebraria a cada virada de mês.
  **Esta regra vale só para caixinhas com `recipeSlug='quadrantes'`** — caixinhas manuais não são
  tocadas; o comportamento delas ao fim do período é o arquivamento manual descrito em §5.7.
  **v1 não tem tela/relatório de caixinhas arquivadas** — fica inacessível pela UI até uma iteração
  futura (registrado abaixo).
- **Desvincular lançamento associado automaticamente**: sim, permitido — mesmo vínculo N:N de sempre
  (P-1/P-2 em §6.1), sem estado "travado" especial pra vínculo de receita. Requisito de mecânica pra
  isso funcionar de verdade: a varredura por data **liga o vínculo uma vez só**, no momento em que a
  transação é criada ou editada de um jeito que passa a qualificar (ex.: data muda pra dentro do
  intervalo) — nunca como reconciliação de fundo que reimporia o vínculo depois que o usuário o
  removeu. Editar a **data** de uma transação pra fora/dentro de um intervalo ainda deve mover o
  vínculo de acordo (isso é a data mudando de verdade, diferente de um desvínculo deliberado); uma
  edição que não mexe na data não deve reacionar a regra. Eventuais efeitos colaterais inesperados
  dessa mecânica ficam para resolução em v2, não bloqueiam a v1.
- **Escopo v1 = uma receita hardcoded, não um framework de receitas**: "receita" no sentido de §5.6
  é um conceito de produto (um módulo opt-in que gera caixinhas), não uma abstração técnica genérica
  na v1. Não existe registro/gestão de "receitas" plural, nem tela pra habilitar/configurar múltiplas
  receitas — é um toggle único ("Quadrantes") em Preferências, com a lógica de geração específica
  dela. Se e quando uma segunda receita for proposta, aí sim vale generalizar.

#### Pendente para uma iteração futura (registrado a pedido, não priorizado)

- **Gestão de receitas**: se/quando existir mais de uma receita, como o usuário administra isso —
  uma tela própria, lista de receitas ativas/disponíveis, configuração por receita? Adiado a pedido
  (2026-08-10): a v1 não precisa disso (ver bullet acima).
- **Tracking de "meses bem-sucedidos"**: histórico de quantos meses o usuário ficou dentro da meta
  em cada quadrante (ou no agregado dos 4), para dar visibilidade de tendência/consistência ao longo
  do tempo. Não desenhado ainda — nem a definição de "sucesso" (ficar ≤ 100% da meta? dos 4
  quadrantes juntos?) nem a superfície de UI foram discutidas.
- **Relatório/consulta de caixinhas arquivadas**: os quadrantes de meses encerrados ficam guardados
  (nada é apagado), mas sem nenhuma tela para revisitá-los na v1. Precisa de uma superfície de
  consulta histórica quando priorizado.

### 5.7 Arquivamento manual para caixinhas comuns (P-4, escopo geral — 2026-08-05)
Ao contrário da receita Quadrantes (§5.6, arquivamento automático), uma caixinha manual **nunca é
arquivada por causa da data** — o fim do período não dispara nada sozinho, fica só a critério do
usuário. Botão **"Arquivar"** no cabeçalho de `BudgetDetail.tsx`, ao lado de "Editar" — fora da zona
destrutiva do modal (arquivar não é excluir: dado e vínculos continuam intactos, é só um estado de
visibilidade). Confirmação simples antes de arquivar, no mesmo espírito da confirmação de exclusão
(§3), avisando que a caixinha sai da lista principal.

**Sem tela de "desarquivar" na v1** — mesma limitação já aceita para os quadrantes (§5.6): o dado
não se perde, mas reverter só será possível quando a superfície de consulta de arquivadas for
construída (v2, item já registrado em §5.6 como pendência futura). O diálogo de confirmação existe
justamente para deixar isso claro no momento da ação.

### 5.8 Representação técnica do arquivamento (2026-08-10)
Um único campo cobre os dois caminhos (§5.6 automático e §5.7 manual): `archivedAt?: string` — ISO
8601, ausente/`undefined` = caixinha ativa. Timestamp em vez de `boolean` pelo mesmo custo de
implementação, mas guarda "quando" de graça — útil pra ordenar/filtrar na futura tela de consulta
de arquivadas (v2) sem precisar de outro campo depois.

---

## 6. Pendências que exigem revisão do humano

### 6.1 Produto — precisam de decisão antes da camada de dados

| # | Questão | Impacto |
|---|---------|---------|
| **P-1** | ~~Como um lançamento entra na caixinha?~~ **Resolvido (2026-08-05, §5.6): os dois.** Vínculo N:N manual continua existindo para caixinhas comuns; a receita "Quadrantes" popula o mesmo vínculo automaticamente por data. | Vínculo N:N único; a origem do vínculo (manual vs. receita) é o que muda |
| **P-2** | ~~Um lançamento pode estar em mais de uma caixinha?~~ **Resolvido (2026-08-05): sim, N:N.** Dentro da receita Quadrantes os 4 slots já são mutuamente exclusivos por construção (intervalos de data não se sobrepõem); nada impede a mesma transação de também estar numa caixinha manual (ex.: a passagem aérea conta pro "Quadrante 1" *e* pra "Viagem para Portugal" — métricas legítimas e diferentes sobre o mesmo lançamento). | Tabela de junção `budget_transactions` (`budgetId` + `transactionId`), sem limite |
| **P-3** | ~~Caixinha recorrente está no escopo?~~ **Resolvido (2026-08-05, §5.6): não como propriedade da caixinha individual.** Recorrência existe só no nível da receita "Quadrantes" (regenera o lote a cada virada de mês) — o modal de caixinha comum não ganha um toggle "repetir todo mês". | — |
| **P-4** | ~~O que acontece com uma caixinha depois do fim do período?~~ **Resolvido (2026-08-05).** Receita "Quadrantes" (§5.6): arquivamento **automático** na virada de mês. Caixinhas manuais (§5.7): arquivamento **manual**, a critério do usuário — o fim do período não dispara nada sozinho. Nenhum dos dois casos tem tela de consulta de arquivadas na v1 (deferido pra v2). | Botão "Arquivar" em `BudgetDetail.tsx`; filtro/aba de arquivadas fica pra v2 |
| **P-5** | ~~Caixinha do tipo receita faz sentido no produto?~~ **Resolvido (2026-08-05): sim, manter os dois tipos.** Cobre um caso de uso real que nenhuma outra tela resolve — "estou no caminho de bater minha meta de renda extra?" (Saúde Financeira olha renda já realizada; Patrimônio olha saldo acumulado; nenhuma responde isso). | Mantém o segmentado Despesa/Receita no modal e a régua de 4 estados — já pago no protótipo |
| **P-6** | ~~Lançamentos futuros/não pagos contam para o valor atual?~~ **Resolvido (2026-08-05): não — "valor atual" soma só `isCashRealized(tx)` (B-15, `utils.ts:46`), o mesmo critério já usado em Dashboard/Patrimônio/Fluxo de Caixa/Lançamentos.** Lançamento futuro fica vinculado (aparece na lista) mas não conta na soma, evitando progresso falso antes do dinheiro se mover de fato. | Aplica-se igual a caixinhas manuais e às geradas pela receita Quadrantes |
| **P-7** | ~~Compra parcelada — conta inteira ou parcela a parcela?~~ **Resolvido (2026-08-05): parcela a parcela — corolário direto do schema (cada parcela já é uma `Transaction` própria com seu `amount`/`date`, `types/index.ts:87-111`) + P-6 (só conta o realizado).** A receita Quadrantes já lida com isso de graça, varrendo por `date` de cada parcela. | Ver T-8 (nota de UX pra vincular a série inteira de uma vez) |

### 6.2 UX — decisões (2026-08-05)

| # | Questão | Decisão |
|---|---------|---------|
| **U-1** | Nomes longos truncam cedo no card de 4 colunas. Permitir 2 linhas de nome? | **Não** — mantém truncamento de 1 linha com reticências, comportamento atual preservado. |
| **U-2** | Mobile: a feature não tem entrada no bottom nav. Aceitável, ou merece substituir algum slot? | **Aceitável por ora** — Caixinhas não entra no bottom nav mobile; sem mudança de escopo mobile por enquanto. |
| **U-3** | Ordenação da lista: hoje é a ordem do mock. Configurável? | **Sim** — `<select>` em Preferências, mesmo padrão visual de `incomeWindowMonths`/`reserveTargetMonths` (`Settings/index.tsx`). Critérios: **Prazo** (vencimento mais próximo primeiro), **Progresso** (% decrescente), **Nome** (alfabética), **Criação** (mais recente primeiro — equivale à ordem atual do mock, é o padrão). |
| **U-4** | Não há estado visual para caixinha com período encerrado além do texto "período encerrado". | **CTA visual no card** ("Período encerrado" em destaque) — mas **não interativo**: o card inteiro continua sendo um único `Link` (§3), então o banner não pode ser um botão próprio (botão dentro de link é inválido e gera conflito de clique). Clicar em qualquer parte do card, banner incluso, leva ao detalhe; a ação "Arquivar" (§5.7) só existe lá. |

### 6.3 Técnico — quando virar feature real

Rastreamento de execução mora agora no épico **`BX-01` a `BX-11`** em `plan/BACKLOG.md` (aberto
2026-08-10). Tabela abaixo mantida como registro histórico do que motivou cada item, com o
apontamento pra fase/item correspondente.

| # | Item | Fase/item em `BACKLOG.md` |
|---|------|---------|
| **T-1** | **Redirecionar após excluir**: a rota `/budgets/:id` deixa de existir; hoje cairia no fallback "sem dados". Precisa de `navigate('/budgets')`. | BX-06 |
| **T-2** | **Plural de verdade** em `budgets.linkedCount` / `budgets.daysLeft` / `deleteConfirmBody`. Segui a convenção existente (interpolação simples de `{{count}}`, como `health.months`) em vez de introduzir formas `_one`/`_other` só aqui — mas "os 1 lançamentos" fica errado. | BX-06 |
| **T-3** | **Schema**: bump de `CURRENT_SCHEMA_VERSION` (v14 → v15) + migração DDL nova, **e** atualizar `SCHEMA_DDL`/`PRAGMA user_version` do `data/sync_gimbo.py` junto (armadilha recorrente registrada no CLAUDE.md — já mordeu em M-51 e M-64). | BX-03 |
| **T-4** | **Sync/merge**: a nova entidade precisa de `updatedAt` e entrar no motor de merge (`lib/cloudSync/merge.ts`), incluindo `deletedIds`. | BX-09 |
| **T-5** | **Testes**: zero até agora. Precisa de unit tests das derivações (`budgetCurrent`/`budgetDelta`/`getBudgetStatus`, incluindo meta zero e período invertido) e um E2E do fluxo criar → associar → excluir. | BX-11 |
| **T-6** | **Demo mode**: `lib/demo.ts` precisa gerar caixinhas sintéticas, senão a tela fica vazia no deploy público. | BX-10 |
| **T-7** | ~~Registrar a feature no `PRD.md` (F-30) e o épico `BX-XX` no `BACKLOG.md`.~~ **Resolvido (2026-08-10)** — `PRD.md` §5 (F-30) e `BACKLOG.md` (épico "Caixinhas — F-30", `BX-01` a `BX-11`). | — |
| **T-8** | (P-7) "Associar lançamento" força vincular parcela por parcela, uma de cada vez, ao longo de vários meses. Um atalho "vincular a série inteira" (usando `installment.parentId` pra linkar as N parcelas — inclusive futuras — de uma vez) evitaria a fricção. Melhoria de UX, não bloqueia o modelo de dados. | BX-06 |

---

## 7. Estado de qualidade

`npm run format:check`, `npm run lint` e `npx tsc -b --noEmit` limpos. Os 756 testes unitários
existentes continuam passando (nenhum novo foi escrito — não há lógica de dados a testar ainda).
