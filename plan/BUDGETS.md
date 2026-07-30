# Caixinhas (Budgets) — F-30

> Histórico de produto e design da feature **Caixinhas** (rotas `/budgets` e `/budgets/:budgetId`).
> Estado atual: **protótipo visual mockado** — nenhuma entidade nova no `DataFile`, nenhuma
> mutação de dados, nenhum teste. Toda a tela lê de `app/src/pages/Budgets/mock.ts`.
> Branch: `dassan/caixinhas` (um único commit, ainda **não publicada**).
> Última atualização: 2026-08-01.

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

---

## 6. Pendências que exigem revisão do humano

### 6.1 Produto — precisam de decisão antes da camada de dados

| # | Questão | Impacto |
|---|---------|---------|
| **P-1** | **Como um lançamento entra na caixinha?** Associação manual, um-a-um? Ou uma regra (categoria/tag/conta) que puxa automaticamente? Ou os dois? | **Alto** — define se `Transaction` ganha um `budgetId`, se existe uma tabela de vínculo N:N, ou se a caixinha guarda um *filtro* em vez de uma lista |
| **P-2** | **Um lançamento pode estar em mais de uma caixinha?** | Decide 1:N vs. N:N no schema |
| **P-3** | **Caixinha recorrente** ("R$ 800/mês de mercado") está no escopo? Hoje só existe data fixa ou intervalo único. | **Alto** — recorrência muda o modelo de período inteiro e é provavelmente o caso de uso mais comum de "budget" |
| **P-4** | O que acontece com uma caixinha **depois do fim do período**? Arquiva, some da lista, vira histórico consultável? | Define se a lista precisa de filtro/aba de arquivadas |
| **P-5** | Caixinha do tipo **receita** faz sentido no produto, ou Caixinhas é só sobre despesa? | Se for só despesa, some metade da régua de status e o modal simplifica |
| **P-6** | Lançamentos **futuros/não pagos** contam para o valor atual, ou só os efetivados? | Espelha a discussão de `isPaid` que já existe no resto do app |
| **P-7** | Compra **parcelada no cartão** — a caixinha conta a compra inteira ou parcela a parcela? | Interage diretamente com o motor de fatura virtual (B-16) |

### 6.2 UX — apontadas mas não resolvidas

| # | Questão |
|---|---------|
| **U-1** | Nomes longos truncam cedo no card de 4 colunas ("Reserva para faculdade das crianças" vira reticências). Permitir 2 linhas de nome? |
| **U-2** | Mobile: a feature não tem entrada no bottom nav. Aceitável, ou merece substituir algum slot? |
| **U-3** | Ordenação da lista: hoje é a ordem do mock. Por prazo? Por % de progresso? Configurável? |
| **U-4** | Não há estado visual para caixinha com período encerrado além do texto "período encerrado". |

### 6.3 Técnico — quando virar feature real

| # | Item |
|---|------|
| **T-1** | **Redirecionar após excluir**: a rota `/budgets/:id` deixa de existir; hoje cairia no fallback "sem dados". Precisa de `navigate('/budgets')`. |
| **T-2** | **Plural de verdade** em `budgets.linkedCount` / `budgets.daysLeft` / `deleteConfirmBody`. Segui a convenção existente (interpolação simples de `{{count}}`, como `health.months`) em vez de introduzir formas `_one`/`_other` só aqui — mas "os 1 lançamentos" fica errado. |
| **T-3** | **Schema**: bump de `CURRENT_SCHEMA_VERSION` (v14 → v15) + migração DDL nova, **e** atualizar `SCHEMA_DDL`/`PRAGMA user_version` do `data/sync_gimbo.py` junto (armadilha recorrente registrada no CLAUDE.md — já mordeu em M-51 e M-64). |
| **T-4** | **Sync/merge**: a nova entidade precisa de `updatedAt` e entrar no motor de merge (`lib/cloudSync/merge.ts`), incluindo `deletedIds`. |
| **T-5** | **Testes**: zero até agora. Precisa de unit tests das derivações (`budgetCurrent`/`budgetDelta`/`getBudgetStatus`, incluindo meta zero e período invertido) e um E2E do fluxo criar → associar → excluir. |
| **T-6** | **Demo mode**: `lib/demo.ts` precisa gerar caixinhas sintéticas, senão a tela fica vazia no deploy público. |
| **T-7** | Registrar a feature no `PRD.md` (F-30) e o épico `BX-XX` no `BACKLOG.md`. |

---

## 7. Estado de qualidade

`npm run format:check`, `npm run lint` e `npx tsc -b --noEmit` limpos. Os 756 testes unitários
existentes continuam passando (nenhum novo foi escrito — não há lógica de dados a testar ainda).
