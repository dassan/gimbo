# Saúde Financeira — F-29

> Histórico de produto e design da tela de Saúde Financeira (`/health`).
> Estado atual: **design inicial mockado** (sem motores reais). Implementação dos motores e testes: épico `HE` em `plan/BACKLOG.md`.
> Última atualização: 2026-06-20.

---

## 1. Objetivo

Dar ao usuário a visão do **total de dívidas que ele assumiu** (tudo o que parcelou ou contratou) e do **peso desse número no seu orçamento mensal**, para que consiga tomar decisões.

O insight central: **uma compra parcelada no cartão é dívida real, não apenas "a parcela do mês".** O marketing leva a pessoa a absorver a parcela no orçamento e a perder de vista o total comprometido para o futuro. A tela torna esse total visível e o contextualiza contra a renda.

### Reframe (2026-06-19 → 2026-06-20)

A ideia inicial era uma variação da tela de Patrimônio mostrando ativos (saldos + bens móveis/imóveis) e passivos (compromissos de cartão). Após discussão, o objetivo foi **estreitado para dívida + orçamento**:

- **Foco em dívida**, não em patrimônio. A página de Patrimônio (`/net-worth`, F-24) permanece intocada e responde pelo patrimônio.
- **Bens ilíquidos saíram** (imóvel, carro): baixa liquidez, pouco impacto na gestão de dívida líquida.
- **Saldos líquidos entram** apenas como contexto da reserva de emergência (ver card 2), não como "patrimônio".

---

## 2. Escopo

**Dentro:** dívida total comprometida (parcelas + contratos), peso no orçamento (renda × comprometimento mensal), reserva de emergência (atual vs. recomendado), detalhamento expansível das dívidas por cartão/empréstimo.

**Fora:** bens ilíquidos (imóvel, carro); patrimônio líquido (é a tela F-24); qualquer cálculo de "quitação à vista hoje" (descartado — ver §4.2).

---

## 3. Anatomia da tela

Navbar desktop: item **"Saúde"** entre "Patrimônio" e "Configurações" (rota `/health`). Não entra no bottom nav mobile (5 slots cheios), espelhando a decisão de Patrimônio.

Linha de resumo: **três cards de mesma altura**, na ordem `Peso no orçamento | Reserva de Emergência | Dívida total comprometida`, empilhados em < `lg`. Todos compartilham a mesma anatomia (título → números → medidor com %), para ritmo visual consistente. Abaixo: detalhamento expansível e callout educativo.

### Card 1 — Peso no seu orçamento
- Dois números: **Renda mensal** (editável no futuro) e **Comprometido por mês** (Σ das parcelas ativas).
- Número-herói: **% da renda comprometida** = comprometido/renda.
- Legenda: **compromisso mais longo** (maior horizonte em meses).
- Régua de cor (comprometimento da renda): < 30% verde, 30–50% âmbar, > 50% vermelho.

### Card 2 — Reserva de Emergência
- Dois números: **Saldo da Reserva** (atual) e **Valor Recomendado** (`RESERVE_TARGET_MONTHS × custo mensal médio`, padrão 6×).
- Número-herói: **% do recomendado** = saldo/recomendado.
- Legenda: **quanto falta** para o recomendado ("Faltam R$ X") ou "Reserva completa".
- Régua de cor: ≥ 100% verde, 50–99% âmbar, < 50% vermelho.
- Conceito de Reserva de Emergência a aprofundar (ver §5).

### Card 3 — Dívida total comprometida
- **Número único, grande (`text-4xl`) e centralizado** no corpo do card = Σ do que ainda falta pagar (parcelas + contratos). **Não** é a parcela do mês.
- Número-herói (no lugar da barra): **alavancagem pessoal** = dívida total ÷ renda mensal, exibida como múltiplo (`2,6×`).
- Legenda: **janela temporal** = "Impacta seu orçamento por N meses" (maior horizonte).
- **Esquema escuro grafite** (Bambu 900 `#1A1F2E`) — ver §5.
- Régua de alavancagem (tons claros p/ contraste no fundo escuro): ≤ 3× verde `#3D9E82`, 3–6× âmbar `#D4A017`, > 6× vermelho `#F1948A`.

### Detalhamento das dívidas (expansível)
Um card por cartão/empréstimo. Cabeçalho: nome, badge da emissora (cor da marca), valor/mês e **total restante** (vermelho). Expande para a lista de parcelamentos: descrição, "Parcela X/N · restam K", valor da parcela e **total restante** em âmbar (ênfase no custo real). Todos os totais derivam das parcelas, então **sempre reconciliam** com o agregado.

### Callout educativo
Caixa âmbar (`#FEF3DC`, borda-esquerda `#D4A017`): "O valor acima é o total que você ainda deve pagar em parcelas e contratos — não apenas a parcela deste mês."

---

## 4. Conceitos e fórmulas

Valores entre parênteses = mock atual (`MOCK_*` em `pages/Health/index.tsx`).

### 4.1 Derivações da dívida
- `remainingCount(parcela)` = `total − current + 1`.
- `installmentRemaining` = `remainingCount × valor_parcela`.
- `debtTotal` = Σ `installmentRemaining` das parcelas → **R$ 30.280**.
- `monthlyCommitted` = Σ valor das parcelas ativas → **R$ 2.750**.
- `longestHorizon` = maior `remainingCount` → **19 meses**.
- `commitmentPct` = `monthlyCommitted / renda` → **24%** (renda R$ 11.500).
- `leverage` = `debtTotal / renda` → **2,6×**.

### 4.2 Reserva de emergência
- `recommendedReserve` = `RESERVE_TARGET_MONTHS × custo_mensal_médio` → 6 × R$ 6.000 = **R$ 36.000**.
- `reserveRatio` = `saldo / recomendado` → 22.700 / 36.000 = **63%**.

> **Conceito descartado — "Se quitasse tudo hoje" / dívida líquida (`reserva − dívida total`).** Era incoerente: misturava o passivo *nominal futuro* (soma das parcelas) com um ato *à vista hoje* (que pagaria o saldo devedor atual, não a soma nominal). Substituído pela métrica de cobertura e, na sequência, pela visão de Reserva de Emergência (atual vs. recomendado), que usa réguas comparáveis.

---

## 5. Decisões de design

- **Hero grafite, não verde (2026-06-20).** O card de dívida é escuro para servir de âncora visual da linha, mas usar Floresta 800 (a cor de "dinheiro/positivo" da marca) num passivo passava viés positivo errado. Princípio adotado: **o fundo do card não julga o número — quem julga é o indicador.** Fundo neutro (grafite Bambu 900 `#1A1F2E`) transmite gravidade sem viés; a única cor avaliativa é a alavancagem. Registrado no `design/DESIGN.md` (Floresta 800 = saldo/positivo; Bambu 900 = passivo/gravidade).
- **Tom calmo, nunca alarmista.** Mesmo o estado crítico é diagnóstico, não sirene. Sem vermelho de fundo por padrão.
- **Réguas comparáveis.** Toda métrica compara dois números de mesma natureza (renda × comprometido; saldo × recomendado; dívida × renda).
- **Consistência de anatomia.** Os três cards seguem título → números → medidor; o card de detalhamento reusa o padrão de linha/badge da emissora do Patrimônio.

---

## 6. Decisões de produto (sessão 2026-06-21)

Os pontos que estavam em aberto foram decididos numa sessão de produto. As tarefas correspondentes estão no épico `HE` em `plan/BACKLOG.md`.

### D0 — Escopo do v1: dívida primeiro
O primeiro corte funcional liga os motores de **Dívida total comprometida** e **Peso no orçamento** (renda). A **Reserva de Emergência sai do v1** e vira um épico próprio (custo mensal médio, contas da reserva, reserva-entidade — antigos pontos 1, 2 e 4). Motivo: o *job* central da tela é consciência de dívida; a reserva é um *job* distinto (preparação para imprevistos) e travava o v1 nas decisões mais espinhosas.

### D1 — Renda mensal: híbrido derivar + override
Denominador do "Peso no orçamento". **Derivar uma sugestão, o usuário confirma/ajusta, o valor persiste.**
- **Renda qualificada** = transações `INCOME` **excluindo conta CREDIT** (estornos da B-16 são `INCOME` em cartão e inflariam a renda) **e excluindo transferências**.
- **Janela** = até **6 meses completos** (o mês corrente fica de fora — a renda dele ainda não entrou inteira).
- **Piso de 3 meses** com renda qualificada → usa a **mediana** (mês típico, resiste a meses atípicos como 13º/resgate). **1–2 meses** → usa o disponível, mas rotulado como *"estimativa de N meses — confirme"*. **0 meses** → sem número; campo manual com CTA.
- O **valor definido pelo usuário sempre vence** e **nunca é sobrescrito em silêncio**. A derivação só sugere; um "recalcular pelo histórico" fica opt-in.
- **Requisito de UI:** o rótulo de confiança ("baseado em N meses") aparece **no card**, não só no input — senão o usuário lê o % como verdade absoluta (falsa precisão).
- Esse cold start fixa o **mesmo padrão** para o "custo mensal médio" do épico da Reserva.
- **Persistência do valor confirmado (decidido na HE-09, 2026-06-21):** `workspace.monthlyIncomeOverride` (local, mesmo padrão de `netWorthIncludeHidden`), **não** `Settings`/SQLite. Motivo: evita nova coluna SQLite + migration + bump de `CURRENT_SCHEMA_VERSION` para uma única figura cujo pior caso de "perda" (troca de dispositivo, restore de backup) já é coberto pelo próprio design do D1 — sem override, a tela volta a sugerir pelo histórico ou pede confirmação manual; não é perda de dado financeiro real.

### D5 — Dívida não-cartão: entidade de passivo de primeira classe (`LOAN`), no v1
Novo tipo de conta para empréstimos/financiamentos não-cartão (empréstimo pessoal, consignado, financiamento de carro/imóvel). **Incluído no primeiro corte** porque enriquece duas telas:
- **Saúde Financeira (F-29):** saldo devedor entra na Dívida total; parcela entra no Comprometido por mês; prazo restante no maior horizonte.
- **Patrimônio (F-24):** passa a contribuir como **passivo** ao lado de CREDIT (hoje o net worth só conta cartões como passivo).
- **Modelo v1 (confirmado na HE-06, 2026-06-21):** saldo devedor é figura **mantida pelo usuário**, atualizada por **edição direta no modal de conta** (`pages/Settings/index.tsx`) — não um histórico de snapshots como o `Valuation` de STOCKS/CRYPTO/ASSET. Motivo: o `Valuation` existe para registrar a evolução de um valor de mercado externo (preço de ação, cripto); o saldo devedor de um empréstimo não tem "preço de mercado" para snapshot — é só um número que o usuário corrige periodicamente. Sem amortização automática de juros/principal nesta fase. Juros como campo opcional para um insight futuro de "custo dos juros".

### Premissas a validar (pós-lançamento)
- A maioria dos usuários terá histórico rico (import Organizze). Se muitos começarem do zero, o caminho manual de D1 vira regra, não exceção.
- O modelo de saldo devedor mantido pelo usuário (`LOAN`) é suficiente; amortização automática pode ser demandada depois.

### Nota de escopo
Ao incluir `LOAN` no v1, a F-29 deixou de ser "ligar motores num mock": virou um épico que cruza schema + Settings + Patrimônio. Decisão consciente. **Sequenciar `LOAN` como a primeira fatia** do épico para não virar gargalo do resto.

---

## 8. Decisões do épico Reserva de Emergência (sessão 2026-07-11)

### D6 (HE-14) — Reserva como conceito: metadata em conta existente, não `AccountType` novo
Ao contrário do `LOAN` (D5), a Reserva de Emergência **não vira tipo de conta novo**. Motivo: o `LOAN` justificou um tipo próprio porque seu comportamento é genuinamente diferente (saldo estático mantido pelo usuário, sem transações). A reserva, ao contrário, precisa se comportar exatamente como uma conta CHECKING/SAVINGS/INVESTMENT normal — recebe depósitos, saques, transferências, e seu saldo é derivado das transações pela mesma fórmula de sempre. Um `AccountType` novo obrigaria a ensinar RESERVE a cada switch-por-tipo já existente (Dashboard, Settings, Patrimônio, formulário de transação, agrupamentos) para replicar mecânica idêntica — puro código duplicado para uma distinção que é de **propósito**, não de **mecânica financeira**.

**Modelo escolhido:** objeto `reserveMetadata` (ecoando o padrão de `creditMetadata`/`loanMetadata`) anexável a contas CHECKING/SAVINGS/INVESTMENT existentes — não um booleano solto. A presença do objeto é o sinal "esta conta é reserva" e carrega dados próprios (ex.: meta em meses, override por conta — a definir na HE-12/13). Diferença do precedente: `creditMetadata`/`loanMetadata` hoje são pareados 1:1 com um `AccountType` dedicado (CREDIT/LOAN); `reserveMetadata` é o primeiro caso de metadata **compatível com múltiplos tipos existentes**.

**"Primeira classe" vem da UX, não do type system:** já que não há tipo novo para separar essas contas automaticamente, a força da entidade precisa ser garantida por peso visual dedicado em todo lugar que a conta aparece — badge distintivo na lista de contas, no Dashboard, no Patrimônio, e seção própria e explícita (não checkbox perdida) no modal de Settings.

**Benefício colateral para a HE-13:** o modelo já permite a reserva ser composta por **mais de uma conta** (ex.: poupança + parte de uma conta corrente) — cada conta carrega seu próprio `reserveMetadata`, e o motor soma todas as marcadas.

**Tradeoff aceito:** menos "separação automática" que um tipo novo daria de graça em qualquer switch-por-tipo; a UI precisa dar destaque a essas contas manualmente em vez de herdar isso do type system. Aceito para evitar duplicar lógica de saldo/patrimônio que já funciona para CHECKING/SAVINGS/INVESTMENT.

### D7 (HE-12) — Custo mensal médio: mesmo padrão da renda (HE-09), sobre todas as `EXPENSE`
Reaproveita integralmente o padrão de degradação graciosa de `deriveMonthlyIncome` (HE-09): mediana de até **6 meses completos** (mês corrente excluído), **piso de 3 meses** para mediana confiável, **1–2 meses** = estimativa rotulada, **0 meses** = sem número, campo manual com CTA. Persistência (se houver override do usuário) segue o mesmo mecanismo local de `workspace.monthlyIncomeOverride`.

- **Parcelas de cartão entram no custo mensal** (não são excluídas). Motivo: o objetivo da reserva é responder "quanto preciso para viver N meses sem renda" — nesse cenário as parcelas continuam vencendo, então fazem parte do custo real de manutenção. Aceita-se a sobreposição conceitual com o "Comprometido por mês" do Card 1 (Peso no orçamento): são duas perguntas diferentes (comprometimento futuro vs. custo de manutenção), não um erro de dupla contagem.
- **Despesas não-recorrentes não são filtradas automaticamente.** Não há como distinguir "atípico" de "recorrente" de forma confiável sem categoria dedicada para isso. A **mediana** (em vez de média) já é a proteção escolhida contra outliers pontuais — mesmo raciocínio que levou à mediana na HE-09.

### D8 (HE-13) — Contas da reserva: marcação explícita por conta, `reserveMetadata` enxuto
Consequência direta da D6: já que o mecanismo é `reserveMetadata` presente/ausente em contas CHECKING/SAVINGS/INVESTMENT, **não há heurística automática por tipo** (não é "toda poupança conta como reserva") — é marcação explícita, conta a conta, no modal de Settings (seção dedicada, mesmo padrão visual de CREDIT/LOAN, toggle "Esta conta faz parte da reserva de emergência"). Evita falso positivo (poupança de outro propósito, ex. viagem) e falso negativo (reserva guardada numa conta corrente comum).

**`reserveMetadata` v1 é enxuto** — sem campos obrigatórios além da própria marcação (o saldo já vem das transações da conta, como qualquer CHECKING/SAVINGS/INVESTMENT). Não replica a complexidade de campos do `loanMetadata` (que precisa de saldo/parcela/prazo porque `LOAN` não tem transações). Meta em meses (`RESERVE_TARGET_MONTHS`) permanece **global** do card, não por conta.

**Motor:** soma o saldo de todas as contas com `reserveMetadata` presente — suporta reserva composta por múltiplas contas de graça (já previsto na D6).

### D9 (HE-16) — Meta em meses da reserva: configurável pelo usuário (2026-07-11)
Durante teste manual, o usuário notou que o "Valor Recomendado" da reserva mudava pouco ao trocar o intervalo de cálculo (`incomeWindowMonths`, Configurações) de 6 para 3 meses — não era bug: `incomeWindowMonths` só controla a **janela de lookback** usada para derivar o custo mensal médio; o multiplicador de segurança (quantos meses de custo a reserva deveria cobrir) era a constante fixa `RESERVE_TARGET_MONTHS = 6`, decisão original da D8 ("meta em meses permanece global, não por conta"). A confusão evidenciou uma necessidade real: o usuário quis poder ajustar esse multiplicador também.

**Resolução:** `RESERVE_TARGET_MONTHS` deixou de ser uma constante fixa e virou `workspace.reserveTargetMonths` (mesmo tipo `IncomeWindowMonths` = 3|6|9|12, default 6), com seletor dedicado em Configurações (`setReserveTargetMonths`), no mesmo padrão do seletor de janela de renda/custo. **A meta continua global** (não por conta) — a D8 permanece válida nesse ponto — mas agora é editável pelo usuário, e é **conceitualmente independente** do `incomeWindowMonths`: um controla "quantos meses de histórico olhamos para trás" (base do custo), o outro controla "quantos meses de custo a reserva deveria cobrir" (o multiplicador). Os dois têm o mesmo valor default (6) por coincidência de design, não por serem a mesma coisa — daí a confusão inicial.

---

## 7. Estado atual

**v1 (dívida + orçamento) ligado aos motores reais (HE-04 a HE-11, 2026-06-21).** `pages/Health/index.tsx` lê `useDataStore`/`useWorkspaceStore`: dívida total, comprometido mensal e horizonte vêm de `getTotalCommittedDebt`/`getMonthlyCommitment`/`getDebtHorizon` (HE-08); o detalhamento expansível vem de `getDebtBreakdown` (HE-10), que agrupa por conta CREDIT (itens de parcela aberta) e LOAN (item único a partir de `loanMetadata`), sempre reconciliando com os agregados. Renda mensal usa `deriveMonthlyIncome` (HE-09) com override do usuário em `workspace.monthlyIncomeOverride`, editável inline (lápis → input → confirmar) e rotulada por confiança (`confirmedByYou`/`basedOnMonths`/`estimateConfirm`/CTA manual). Rota, navbar e i18n (`nav.health`, `health.*`) ligados. Testes: `Health.test.tsx` (HE-11, 9 testes de componente) + 5 testes unitários de `getDebtBreakdown` em `utils.test.ts`.

**Dívida não-cartão lançada parcela a parcela (HE-15, 2026-06-25).** Um empréstimo/financiamento registrado como **série `installment` numa conta comum** (ex.: "Refinanciamento Itaú", 84x numa conta RETAIL) — nem `CREDIT`, nem entidade `LOAN` — passou a ser contado como dívida. Os 4 motores (`getTotalCommittedDebt`/`getMonthlyCommitment`/`getDebtHorizon`/`getDebtBreakdown`) reconhecem séries abertas de **qualquer conta não-`LOAN`**, com `DebtGroup.kind: 'installments'` próprio no detalhamento. Decisão consciente de **não** oferecer "converter para conta `LOAN`": a `LOAN` (HE-06) é um saldo estático sem transações, voltada a dívidas *não* lançadas parcela a parcela; converter a série descartaria as transações e o impacto no fluxo de caixa. São dois formatos válidos de passivo não-cartão, e o motor conta cada um uma vez. Escopo "contar tudo"; marcação opt-in "marcar série como empréstimo" (nome + juros) fica como incremento futuro.

**Reserva de Emergência ligada aos motores reais (HE-12 a HE-14, 2026-07-11).** `reserveMetadata` (schema v11→v12) marca contas `RETAIL`/`SAVINGS` como parte da reserva (`RESERVE_ELIGIBLE_TYPES`), com toggle dedicado no modal de Settings e badge `Umbrella` na lista de contas (Settings, Dashboard, Patrimônio) — ver `FINANCIAL_HEALTH.md` §8 D6. `getReserveBalance` soma o saldo derivado das contas marcadas; `deriveMonthlyCost` espelha `deriveMonthlyIncome` (mediana, 6 meses, cold start gracioso) sobre todas as `EXPENSE`, com override em `workspace.monthlyCostOverride` (D7/D8). O card em `pages/Health/index.tsx` usa ambos os motores, com edição inline do custo mensal (mesmo padrão da renda) — `MOCK_EMERGENCY_RESERVE`/`MOCK_MONTHLY_COST` e o selo "Em breve" removidos. Referência de design inicial (Stitch): `design/saude-financeira.png`.
