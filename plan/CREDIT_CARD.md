# Particularidades do Ciclo de Vida: Cartões de Crédito

Este documento visa consolidar as regras de negócio, comportamentos esperados e particularidades na tratativa de **Cartões de Crédito** dentro do contexto do aplicativo Gimbo.

---

## 1. Problema de Modelagem

O cartão de crédito costuma ser a entidade mais complexa a se modelar em sistemas de finanças pessoais (PFM - Personal Finance Management) por divergir profundamente do comportamento de uma Conta Corrente tradicional de fluxo de caixa.

Historicamente, em sistemas mal projetados, há os seguintes riscos:
- Duplicação de despesas ao pagar a fatura e ao registrar as transações.
- "Sangria" incorreta da liquidez financeira caso despesas a crédito afetem o saldo disponível imediato do usuário.
- Dificuldades de navegação temporal envolvendo datas de compra, dias de fechamento e atrasos de vencimentos.

---

## 2. Diferenças e Paradigmas Mapeados

### 2.1 Separação Temporal (Despesa vs. Fluxo de Caixa)
* **Conta Corrente:** Ao realizar uma transação de débito, a disponibilidade do patrimônio recai **imediatamente**. O impacto existe concomitantemente no Fluxo de Caixa e no Orçamento.
* **Cartão de Crédito:** Compras efetuadas criam uma dívida/obrigação financeira — um Passivo Circulante. A "saída do caixa real" acontecerá apenas no **vencimento** (ou no dia em que a fatura é paga). Consequentemente, as transações afetam o *orçamento categórico* do momento da compra, mas o *fluxo de caixa* sofre o impacto de forma consolidada lá na frente.

### 2.2 O Ciclo da Fatura (Invoice Lifecycle)
Diferente das contas de fluxo ininterrupto, o crédito obedece a um agrupamento cíclico delimitado por faturas. Três eventos ditam as regras deste ciclo:
1. **Data da Compra:** Quando a despesa aconteceu. Vital para relatórios gráficos e de categorias.
2. **Data de Fechamento (Cut-off):** O "congelamento" (snapshot) dos saldos. Transações ocorridas após essa data só farão parte da fatura subsequente ("melhor dia para compra").
3. **Data de Vencimento:** Data limítrofe acordada com a instituição financeira onde será requerida a transferência do montante e ocorrerá o impacto no caixa global.

### 2.3 Pagamento da Fatura = Transferência (Zero-Sum)
O ato de pagar o cartão **não** pode ser classificado como *Despesa* (EXPENSE). Se assim for, estaremos duplicando o lançamento. O pagamento é arquiteturalmente uma **Transferência** ou um repasse interno de saldo positivo do fluxo de caixa abatendo um saldo consolidado de obrigações bancárias passivas na "conta" de Crédito. O saldo credor se torna `0`.

### 2.4 Compras Parceladas (Installments)
Transações divididas em "N" vezes demandam inteligência especial:
1. O **Limite de Crédito Disponível** deve ser bloqueado/comprometido pelo valor consolidado total imediato no instante da operação.
2. Cada mês/fatura assume um fragmento do fracionamento de forma isolada do fluxo de caixa, exigindo previsibilidade e rastreabilidade que permita uma possível exclusão global originária e cálculos exatos de antecipação.

### 2.5 Nomenclaturas e Representação Visual da UI
- Saldo: Para cartão de crédito as exibições priorizam *Limite Disponível* e/ou *Fatura Fechada/Atual*, invertendo logicamente números positivos ou negativos de forma diferente de investimentos (onde saldo positivo é dinheiro seu).
- Exclusão do Saldo Consolidado: Exigência do uso do sinal já existente e flagável nas _settings_ (usualmente as contas de crédito excluem do `Include In Balance` global em UI focada em liquidez) para evitar que o déficit aparente consuma dinheiro líquido incorretamente na conta matemática de saldo visível.

### 2.6 Lançamentos Reversos (Refunds & Chargebacks)
Devoluções ou estornos tendem a aparecer na mesma fatura que as recebeu ou em superveniência abatendo novos débitos. Com efeito positivo no extrato da operadora, trata-se de reversão de débito em vez de um "ingreso/receita real" ao sistema (diferente de receber salário, por ex).

---

## 3. Decisões de Produto (Fase 1)

As perguntas abertas da seção 4 foram endereçadas ao PM e respondidas. Abaixo o registro das decisões tomadas e seus fundamentos.

### 3.1 Fatura: Computação Virtual (Runtime)

**Decisão:** A fatura não será uma entidade persistida no `data.json`. Será sempre derivada em runtime a partir de `Account.creditMetadata.closingDay` e `Account.creditMetadata.dueDay`.

**Fundamento:** Introduzir uma entidade `Invoice` aumentaria dramaticamente a complexidade do motor de merge/sync e exigiria rotinas de fechamento manual e controle de status.

**Trade-off aceito:** O histórico retroativo não fica "congelado". Se o usuário alterar a data de uma transação passada, a fatura recalculada refletirá a mudança. Para v1, isso é aceitável.

---

### 3.2 Tipo de Transação: `CREDIT_PAYMENT` Explícito

**Decisão:** Criar o valor `'CREDIT_PAYMENT'` no union `TransactionType`, em vez de reutilizar `'TRANSFER'`.

**Fundamento:** Inspecionar o `AccountType` da conta de destino dentro de renders de gráficos para distinguir pagamento de fatura de uma transferência comum é a receita para bugs e gargalos. Filtros explícitos por tipo são mais simples, testáveis e escaláveis.

**Impacto técnico:** Exige `schemaVersion: 1 → 2` com migração em `validateDataFile()`.

---

### 3.3 Estornos e Chargebacks: Implementado (M-22 / B-16)

**Decisão (revisada):** Um estorno/crédito no cartão é modelado como uma transação `INCOME`
na própria conta `CREDIT`. Não é um novo tipo — reaproveita `INCOME`, identificado pelo
helper `isCardCredit(tx, accounts)` (INCOME cujo `accountId` é uma conta CREDIT).

**Comportamento:**
- O motor de fatura subtrai créditos do total do período: `getInvoiceTotal = Σ EXPENSE − Σ INCOME`
  (espelha o total fechado do extrato, já líquido de estornos).
- O saldo devedor (`getCreditOutstanding`) e o limite disponível também descontam os créditos.
- Em cabeçalhos de caixa (Dashboard, CashFlow), o crédito **abate despesas** em vez de inflar
  receita — nunca é tratado como receita de caixa.

**Fundamento:** preserva a semântica contábil ("reversão de débito, não receita") sem inchar o
schema com um tipo dedicado.

---

### 3.4 Apresentação de Parcelas no Extrato

**Decisão:** Parcelas aparecem individualmente como N linhas separadas no extrato, cada uma na competência de seu mês, com sufixo `" (1/12)"` no campo de descrição.

**Fundamento:** Menor fricção de desenvolvimento (reutiliza os componentes de linha já existentes) e replica o comportamento da fatura física do banco. Agrupamento com expansão geraria fadiga de clique no mobile.

---

### 3.5 Deleção de Parcelas: Modal de Duas Ações

**Decisão:** Ao excluir uma parcela, exibir modal com duas opções:
1. "Excluir apenas esta parcela."
2. "Excluir todas as parcelas (cancelar compra)."

**Fundamento da engenharia:** A opção de excluir apenas parcelas futuras (mantendo as passadas) exigiria acoplamento entre o motor de deleção e o motor de fatura virtual para determinar dinamicamente quais parcelas são "passadas" — complexidade desproporcional para a Sprint atual. O modal de duas ações entrega controle explícito ao usuário sem esse acoplamento.

---

## 4. Impacto na Arquitetura do App

As questões originais desta seção foram endereçadas e respondidas. As decisões estão registradas na seção 3. Abaixo, o detalhamento dos desafios técnicos concretos de implementação derivados dessas decisões.

### 4.1 Evolução de Schema (Bloqueador de Tudo)

Todas as features dependem de uma atualização `schemaVersion: 1 → 2`. Mudanças concretas:

- `TransactionType` ganha `'CREDIT_PAYMENT'`
- `Account` ganha `creditMetadata?: { limit: number, closingDay: number, dueDay: number }`
- `Transaction` ganha `installment?: { parentId: string, currentIndex: number, total: number }`

Requer atualização de `types/index.ts`, `schema.ts` (Zod + constante de versão) e implementação de **rotina de migração** dentro de `validateDataFile()` — arquivos existentes com `schemaVersion: 1` devem ser promovidos automaticamente, adicionando os novos campos opcionais com valores padrão sem corromper dados existentes.

---

### 4.2 Motor de Fatura Virtual

Com a decisão de computar faturas em runtime, são necessários utilitários puros em `lib/utils.ts`:

- **`getInvoicePeriod(txDate, closingDay)`** — dado uma data de compra e o dia de fechamento da conta, retorna a qual período de fatura aquela transação pertence. Caso de borda crítico: uma compra no dia 25 numa conta com fechamento no dia 20 já pertence ao próximo período.
- **`getInvoiceDueDate(invoicePeriod, dueDay)`** — retorna a data de vencimento projetada para aquele período, respeitando meses com menos de 30/31 dias.
- **`getCurrentInvoiceBalance(transactions, account)`** — agrega as transações `EXPENSE` do período corrente de uma conta `CREDIT` para calcular o saldo da fatura aberta.

Esses utilitários são o coração do módulo. Precisam de cobertura de testes unitários robusta, especialmente nos casos de borda de datas (fechamento no dia 31, meses curtos como fevereiro, compra no exato dia do fechamento).

---

### 4.3 Semântica de Saldo para Contas CREDIT

O `accountBalances` memoizado atual não distingue tipo de conta — soma e subtrai transações da mesma forma para todos. Para contas `CREDIT`, a exibição deve mostrar **limite disponível** (`limit - fatura_corrente`) e não um saldo no sentido tradicional.

O Dashboard e o Settings precisarão de lógica bifurcada:
- Contas não-`CREDIT`: cálculo atual (INCOME+, EXPENSE−, TRANSFER−)
- Contas `CREDIT`: `creditMetadata.limit - getCurrentInvoiceBalance()`

Adicionalmente, o modal de criação de conta deve setar `includeInBalance: false` como padrão quando o tipo selecionado for `CREDIT` (conforme seção 2.5).

---

### 4.4 Resolução de Data no Analytics (`getEffectiveCashFlowDate`)

O critério de aceite do PRD exige que uma compra no cartão seja projetada no fluxo de caixa na data de **vencimento da fatura**, não na data da compra. Isso quebra a premissa atual do Analytics, que usa `parseDateLocal(tx.date)` uniformemente para todas as transações.

É necessário criar `getEffectiveCashFlowDate(tx, accounts)`:
- Para transações em contas `CREDIT`: retorna `getInvoiceDueDate(getInvoicePeriod(tx.date, closingDay), dueDay)`
- Para todas as demais: retorna `tx.date` (comportamento atual)

Esse helper deve ser aplicado **exclusivamente na plotagem do gráfico de fluxo de caixa**. O breakdown de categorias continua usando `tx.date` (perspectiva de orçamento — a despesa ocorreu na data da compra).

Transações do tipo `CREDIT_PAYMENT` devem ser **excluídas** dos gráficos de Receitas × Despesas (não são receita nem despesa — são liquidação de passivo). No fluxo de caixa, o impacto já está projetado na data de vencimento da fatura; o pagamento em si não deve aparecer duplicado.

---

### 4.5 Parcelamentos — Criação e Deleção

**Criação:** ao salvar uma transação parcelada, `addTransaction` no store gerará N transações de uma vez, cada uma com:
- `installment.parentId` idêntico (UUID da compra original)
- `installment.currentIndex` de 1 a N
- `installment.total` = N
- `date` calculada mês a mês a partir da data original
- Sufixo `" (X/N)"` concatenado ao campo `description`

O Audit Log deve registrar o grupo como um único evento ("Compra parcelada em Nx") em vez de N entradas independentes.

**Deleção:** exibir modal com duas ações explícitas:
1. **"Excluir apenas esta parcela"** — remove somente a transação selecionada; as demais permanecem.
2. **"Excluir todas as parcelas"** — remove todas as transações com o mesmo `installment.parentId`.

---

### 4.6 Fluxo de Pagamento de Fatura (CREDIT_PAYMENT)

O `TransactionDrawer` precisará de um caminho de UX específico para `CREDIT_PAYMENT`:
1. Usuário seleciona a conta de crédito a quitar
2. Sistema exibe o saldo da fatura corrente como sugestão de valor (via `getCurrentInvoiceBalance`)
3. Usuário seleciona a conta debitada (corrente/poupança) e confirma o valor
4. Uma única transação `CREDIT_PAYMENT` é gerada, vinculando as duas contas

#### 4.6.1 Pagamento vinculado ao período (Opção 2 — B-16)

**Decisão (acordada):** o pagamento é amarrado a um **período de fatura específico**, para que
os números batam com o extrato físico do banco (onde o usuário confere suas anotações).

- `Transaction.referenceMonth` ("YYYY-MM") registra qual fatura o `CREDIT_PAYMENT` liquida
  (preenchido pelo modal "Pagar Agora" a partir do período exibido). Requer `schemaVersion` 4→5
  e coluna SQLite `reference_month` (`v4.sql`).
- Por período: `total = getInvoiceTotal` (charges − credits), `pago = getInvoicePaid`
  (Σ `CREDIT_PAYMENT` com `referenceMonth` == período), `restante = total − pago`,
  `status = getInvoiceStatus` (aberta / parcial / paga). A UI mostra selo de status + Pago/Restante;
  o valor sugerido no modal é o **restante**.
- **Caixa:** o `CREDIT_PAYMENT` debita a conta pagadora (corrigido em Dashboard, Settings,
  Lançamentos e NetWorth/`applyTx` — antes era um no-op). O **limite disponível** e o **passivo
  no Patrimônio** = `limit − getOpenCreditBalance`, onde `getOpenCreditBalance` é a **fatura atual
  em aberto** (total do período corrente − pagamentos do período). `CREDIT_PAYMENT` continua excluído
  dos gráficos de Receitas × Despesas (liquidação de passivo).
- **Escopo do passivo = fatura atual** (não all-time, não atual+futuras). Decisão tomada após o
  re-sync de 11 anos + 18 meses de lançamentos futuros: somar todo o histórico acumulava o descasamento
  entre cobranças e pagamentos capturados (outstanding > limite), e somar as futuras contava meses de
  gastos de rotina como dívida comprometida (também > limite). A fatura atual é a única base que fica
  dentro do limite e bate com o extrato do banco. Trade-off: parcelas futuras de compras passadas não
  entram no passivo/limite (refinamento possível se a qualidade do dado de parcelamento melhorar).
- **Sync:** `sync_gimbo.py` infere `referenceMonth` de pagamentos vindos do Organizze como
  "mês do pagamento − 1" (vencimento cai no mês seguinte ao período).

---

### 4.7 Interdependências Críticas (Ordem de Implementação)

```
Schema v2 + migração
  └── Motor de fatura virtual (getInvoicePeriod, getInvoiceDueDate, getCurrentInvoiceBalance)
        ├── Dashboard: saldo CREDIT + includeInBalance padrão false
        ├── Analytics: getEffectiveCashFlowDate no fluxo de caixa
        ├── TransactionDrawer: criação de parcelas (N transações)
        └── TransactionDrawer: fluxo CREDIT_PAYMENT
```

Os utilitários de fatura virtual são o único pré-requisito compartilhado por todas as demais peças — devem ser implementados e testados antes de qualquer tela.
