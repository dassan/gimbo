# Patrimônio Líquido (Net Worth) — Especificação de Implementação (F-24)

> Documento de handoff. Source-of-truth para a implementação da tela de Patrimônio.
> Consolida as decisões de produto tomadas e **substitui/estende** os itens NW-02, NW-04 e NW-05
> do épico F-24 em `plan/BACKLOG.md`. Ler em conjunto com `plan/PRD.md` (F-24) e o engine de
> fatura em `src/lib/utils.ts`.

---

## 1. Objetivo

Tela dedicada (`/net-worth`) que oferece a visão de **estoque** do dinheiro (o que o usuário
*tem* num instante), complementar — e separada — da visão de **fluxo** (cash flow / Transactions).
Linguagem da tela: ativos, passivos, alocação, liquidez. **Não** usar linguagem de fluxo
(receita/despesa do mês), exceto no módulo-ponte (seção 7).

---

## 2. Decisões de produto (fixadas)

| # | Decisão | Escolha |
|---|---------|---------|
| D1 | Valor de investimentos que variam sem transação (STOCKS/CRYPTO/FOREX/ASSET) | **Snapshot manual de valor de mercado** (entidade `Valuation`) |
| D2 | O que conta como passivo de contas CREDIT | **Fatura em aberto + todas as parcelas futuras** |
| D3 | A flag `includeInBalance` vale no patrimônio? | **Somar tudo por padrão, com toggle na tela** |

---

## 3. Modelo de dados — entidade `Valuation` (D1)

Adicionar na **migração de schema v3** (bundle com o `updatedAt` do CS-04 — uma única bump v2→v3).

```ts
// src/types/index.ts
export interface Valuation {
  id: string          // UUID
  accountId: string    // conta de investimento (ver elegibilidade)
  date: string         // ISO 8601
  marketValue: number  // valor de mercado naquela data
}

// DataFile ganha:
//   valuations: Valuation[]
```

- **Schema Zod** correspondente em `src/lib/storage/schema.ts` + factory.
- **Migração v2→v3:** arquivos sem `valuations` recebem `valuations: []`. Sem falha em legado.
- **CRUD no `useDataStore`:** `addValuation` / `updateValuation` / `deleteValuation`, com entrada
  no `auditLog` (`entity: 'account'` referenciando o `accountId`, ou novo `AuditEntity 'valuation'`
  — decidir, preferência por reusar `'account'` para não inflar o enum).
- Aplicar `deletedIds` na deleção, igual às demais entidades.

### 3.1 Elegibilidade de valuation

Valuation **só** se aplica a contas de tipo `STOCKS | CRYPTO | FOREX | ASSET`.
Contas `RETAIL | SAVINGS | OTHER` continuam 100% replay de transações (dinheiro líquido não
valoriza sozinho). `CREDIT` nunca tem valuation (é passivo).

### 3.2 Regra de saldo derivado (baseline + replay)

Para conta elegível **com** ao menos um valuation: o snapshot mais recente vira baseline e as
transações posteriores se somam sobre ele (aportes pós-snapshot continuam contando).

```
saldo(conta, ref?) =
  se existe valuation v com v.date <= ref (mais recente):
      v.marketValue + Σ( INCOME − EXPENSE ± TRANSFER  das tx da conta com date > v.date e date <= ref )
  senão:
      account.balance + Σ( replay normal das tx da conta com date <= ref )
```

`ref` ausente = hoje (snapshot atual). Sem valuation, comportamento idêntico ao modelo atual.

---

## 4. Cálculo dos passivos (D2)

Passivo de um cartão = fatura em aberto **+** todas as parcelas/compras de faturas futuras.
Como o engine indexa por `invoicePeriod` (`getInvoicePeriod` em `utils.ts`) e parcelas futuras já
existem como transações datadas no futuro, a definição é determinística:

```
passivoTotal(cartão) = Σ EXPENSE do cartão onde getInvoicePeriod(tx.date, closingDay) >= períodoAtual
```

- Faturas passadas ficam de fora (mesma premissa "já pagas" que `getCurrentInvoiceBalance` adota — ignora `isPaid`).
- **Novo helper puro** em `src/lib/utils.ts`: `getTotalCreditLiability(transactions, account): number`.
  Reaproveitar a lógica de comparação de período de `getCurrentInvoiceBalance`, trocando
  `==` período atual por `>=` período atual.
- **UX:** no breakdown de passivos, exibir **dois números** por cartão: `Fatura atual`
  (`getCurrentInvoiceBalance`) e `Total comprometido` (`getTotalCreditLiability`). Rotular o total
  explicitamente como "inclui parcelas futuras" para não conflitar visualmente com a Dashboard
  (que mostra só a fatura aberta).

---

## 5. Toggle "incluir contas fora do saldo" (D3)

- Patrimônio soma **todas** as contas por padrão (ignora `includeInBalance`).
- Switch no topo da tela: *"Incluir contas fora do saldo"* (default **ON**). Quando OFF, respeita
  `includeInBalance` (comportamento da Dashboard).
- Estado **persistido no `useWorkspaceStore`** (preferência de UI, não dado financeiro):
  nova chave `netWorthIncludeHidden: boolean` (default `true`). Atualizar `WorkspaceFile` em
  `src/types/index.ts` e o store.
- i18n: `netWorth.includeHidden` (pt-BR: "Incluir contas fora do saldo" / en-US: "Include hidden accounts").

---

## 6. Funções puras (substituem NW-04 / NW-05)

### `getAccountBalanceAtMonth(account, transactions, valuations, year, month): number`
Saldo da conta ao **final** do mês `(year, month)`:
- Não-CREDIT elegível a valuation: aplicar a regra da seção 3.2 com `ref` = último dia do mês.
- Não-CREDIT não elegível: `account.balance` + replay das tx com `parseDateLocal(tx.date) <=` fim do mês.
- CREDIT: negativo do `passivoTotal` cujas faturas pertençam **a esse mês ou anteriores ainda em aberto** —
  para o histórico, usar a soma de EXPENSE com `invoicePeriod <= (year, month)` que ainda não foram quitadas
  no recorte. (Simplificação aceitável: somar EXPENSE com `invoicePeriod == (year,month)`; ver nota em §9.)
- Testes: conta sem tx retorna `account.balance`; tx de meses futuros não entram; valuation anterior ao mês
  é respeitado como baseline; CREDIT retorna valor negativo.

### `getNetWorthHistory(data, months = 12): Array<{ label; assets; liabilities; netWorth }>`
Itera os últimos `months` meses a partir do atual:
- `assets` = Σ `getAccountBalanceAtMonth` das contas não-CREDIT (respeitando o toggle de §5).
- `liabilities` = Σ |saldo| das contas CREDIT.
- `netWorth` = `assets − liabilities`.
- `label` = `"MMM YYYY"` localizado (`Intl.DateTimeFormat`). Ordenado do mais antigo ao mais recente.
- Testes: retorna exatamente `months` entradas; mês sem tx reflete só saldos iniciais/valuations;
  CREDIT contribui como passivo positivo.

---

## 7. Layout da página (`src/pages/NetWorth/index.tsx`)

De cima pra baixo. Reusar `StatCard`, `AccountRow`, `ACCOUNT_TYPE_ICONS/COLORS` e tokens
(`surface-container`, `on-surface`, `primary`, `tertiary`).

1. **Hero** — card grande (fundo `primary`, estilo card `balance` da Dashboard) com o Patrimônio
   Líquido + variação no mês (`↑ R$ X (Y%)`). *A variação depende do `getNetWorthHistory` → só na Fase 2.*
   Abaixo: dois mini stat cards — **Ativos** (verde) e **Passivos** (`tertiary`/vermelho).
2. **Toggle** "Incluir contas fora do saldo" (discreto, ao lado do título da página).
3. **Alocação por classe** — donut + legenda agrupando contas em: **Liquidez** (`RETAIL`+`SAVINGS`),
   **Renda variável** (`STOCKS`), **Cripto** (`CRYPTO`), **Câmbio** (`FOREX`), **Outros ativos** (`ASSET`).
   Exibir métrica **Liquidez %** = liquidez ÷ ativos totais.
4. **Breakdown** — duas seções:
   - **Ativos:** contas não-CREDIT, nome + ícone do tipo + saldo derivado (via §3.2) + % do total. Ordenar desc.
     Em contas elegíveis a valuation, botão/ação inline "Atualizar valor de mercado".
   - **Passivos:** contas CREDIT, ícone da emissora (`issuerIcon`) + `Fatura atual` + `Total comprometido` + % do total.
5. **Evolução histórica** — `AreaChart` (Recharts) com `getNetWorthHistory(data, 12)`:
   área Ativos (`#22C55E` com opacidade), área Passivos (`#FF8A83`), linha Patrimônio (cor `primary`);
   eixo X com meses; tooltip `formatCurrency`; legenda. Estado vazio: mensagem centralizada.
6. **Ponte com o fluxo** — card discreto: **taxa de poupança do mês** (quanto do que entrou virou
   patrimônio) e split **aporte vs. valorização** do crescimento do mês.

i18n a adicionar (pt-BR / en-US): `nav.netWorth`, `netWorth.assets`, `netWorth.liabilities`,
`netWorth.netWorth`, `netWorth.noAccounts`, `netWorth.includeHidden`, `netWorth.allocation`,
`netWorth.liquidity`, `netWorth.currentInvoice`, `netWorth.totalCommitted`, `netWorth.updateMarketValue`,
`netWorth.savingsRate`, `netWorth.contributionVsGrowth`.

---

## 8. Itens de backlog reescritos / novos (substituir no `plan/BACKLOG.md`)

| ID | Descrição | Prioridade | Status |
|----|-----------|------------|--------|
| NW-01 | (inalterado) Rota `/net-worth` + item navbar "Patrimônio" (ícone `TrendingUp`) entre Relatórios e Configurações + i18n `nav.netWorth`. | crítica | aberto |
| **NW-08** | **`types` + `schema.ts` + migração v3 + store — entidade `Valuation`.** Conforme §3. Coordenar a bump v3 com CS-04. CRUD + auditLog + deletedIds. Testes de migração v2→v3 (sem `valuations` → `[]`). | crítica | aberto |
| **NW-02 (rev)** | **Página com cards de resumo.** Ativos = Σ saldo derivado das contas não-CREDIT (regra §3.2, respeitando toggle §5). Passivos = Σ `getTotalCreditLiability` das contas CREDIT (§4). Patrimônio = Ativos − Passivos. Três stat cards (Hero §7.1). | crítica | aberto |
| **NW-09** | **`utils.ts` — `getTotalCreditLiability(transactions, account)`.** Conforme §4. Testes: cartão sem tx → 0; parcelas futuras entram; faturas passadas não entram. | crítica | aberto |
| **NW-03 (rev)** | **Breakdown por conta.** Ativos (com saldo via valuation + ação "atualizar valor") e Passivos (dois números por cartão). i18n §7. | alta | aberto |
| **NW-10** | **Toggle `includeInBalance` + `useWorkspaceStore.netWorthIncludeHidden`.** Conforme §5. | alta | aberto |
| **NW-11** | **Alocação por classe** (donut + Liquidez %). Conforme §7.3. | média | aberto |
| **NW-04 (rev)** | **`getAccountBalanceAtMonth(account, transactions, valuations, year, month)`.** Conforme §6. Inclui suporte a valuation como baseline. | crítica | aberto |
| **NW-05 (rev)** | **`getNetWorthHistory(data, months)`.** Conforme §6, respeitando toggle. | crítica | aberto |
| **NW-06** | (inalterado) `AreaChart` de evolução. §7.5. Ligar a variação do Hero aqui. | alta | aberto |
| **NW-12** | **Módulo-ponte** (taxa de poupança + aporte vs. valorização). §7.6. | baixa | aberto |
| **NW-07 (rev)** | **Testes** unitários (`getTotalCreditLiability`, `getAccountBalanceAtMonth`, `getNetWorthHistory`, regra de valuation) + componente `NetWorth.test.tsx`. | alta | aberto |

---

## 9. Pontos a confirmar no código antes de implementar

- **CREDIT no histórico (§6):** definir se o passivo histórico de um mês é só a fatura daquele período
  (simples, recomendado para o MVP) ou o acumulado de faturas em aberto até aquele mês. Decisão afeta
  `getAccountBalanceAtMonth` para CREDIT. Default sugerido: fatura do período (`invoicePeriod == mês`).
- **Auditoria de valuation:** reusar `AuditEntity 'account'` vs. criar `'valuation'`. Default: reusar.
- **Interpolação no gráfico:** entre dois snapshots o valor é step (mantém o último). Aceitável para o MVP;
  interpolação linear fica como melhoria futura se necessário.

---

## 10. Ordem de PRs (uma feature por PR, fases dependentes)

1. **NW-08** — schema v3 + `Valuation` + CRUD (base de tudo).
2. **NW-01 + NW-02(rev) + NW-09 + NW-03(rev) + NW-10** — rota, Hero, breakdown estático, passivo total, toggle.
3. **NW-11** — alocação por classe + liquidez.
4. **NW-04(rev) + NW-05(rev) + NW-06** — histórico + `AreaChart` + variação do Hero.
5. **NW-12 + NW-07(rev)** — módulo-ponte + testes finais.

Cada PR só fecha com CI verde (type-check → lint → format → test → build) e cobertura ≥ thresholds.

---

## 11. Prompt de kickoff para o Claude Code

> Leia `plan/NET_WORTH.md` por completo e `plan/BACKLOG.md` (épico F-24), além de `src/types/index.ts`,
> `src/store/useDataStore.ts`, `src/lib/storage/schema.ts` e `src/lib/utils.ts` (engine de fatura).
> Vamos implementar a Fase 1 do roadmap de PRs (item NW-08 primeiro): adicionar a entidade `Valuation`,
> o schema Zod, a migração v2→v3 e o CRUD no store, com testes. Não inicie a fase seguinte sem CI verde.
> Antes de codar, confirme comigo as decisões em aberto da §9.
