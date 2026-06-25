# Planejamento Financeiro — Metodologia "Dinheiro Sem Medo" (Análise para o Gimbo)

> Documento de análise e registro. Consolida o método de Eduardo Amuri ("Dinheiro Sem Medo" — DSM),
> extraído das 10 aulas em `data/DSM/`, e propõe uma decomposição em etapas que poderiam,
> futuramente, se tornar features do Gimbo. **Não é uma especificação fechada** — é o ponto de
> partida para a discussão e priorização do próximo grande épico do produto: ajudar o usuário a
> sair do *registro* (o que o Gimbo já faz muito bem) e entrar no *planejamento* da vida financeira.
> Ler em conjunto com `plan/PRD.md` (seção "Melhorias e features em aberto") e `plan/ARCHITECTURE.md`
> (modelo de dados e motor de fatura).

---

## 1. Visão Geral do Método

O DSM é uma metodologia de planejamento financeiro pessoal voltada para **simplicidade radical**:
poucas ferramentas, poucas contas, poucos rituais — mas executados com consistência. A tese central
é que a maioria das pessoas não fracassa no orçamento por falta de planilhas sofisticadas, e sim
porque (a) o plano não está conectado a desejos reais ("sonhos"), (b) a estrutura bancária é
complexa demais para ser monitorada, e (c) o acompanhamento exige esforço mental incompatível com
a rotina real das pessoas.

O método é construído em camadas, cada uma resolvendo uma fragilidade da anterior:

1. **Por que** planejar — conexão emocional com objetivos de vida ("sonhos") e reserva de emergência.
2. **Onde** o dinheiro mora — simplificação da estrutura bancária (contas, cartões).
3. **Quanto** cabe no mês — a "Fotografia" (orçamento estático mensal por categorias Fixo/Variável/Sazonal).
4. **Quando** o dinheiro entra e sai — os "Quadrantes" (projeção dinâmica semanal de saldo).
5. **Como** manter — rituais leves (10–15 min/semana) e estrutura de conta de apoio.

Cada camada é deliberadamente desenhada para reduzir a carga sobre o "Sistema 2" (pensamento
deliberado, caro) e operar, no dia a dia, via "Sistema 1" (automático, barato) — ver seção 3.

---

## 2. Síntese das Aulas

| Aula | Tema | Resumo |
|------|------|--------|
| 01 — Introdução | Boas-vindas e estrutura do curso | Apresentação da plataforma, atalhos de conteúdo, plantões e suporte. Sem conteúdo metodológico relevante para o produto. |
| 02 — Nossa Mente | Economia comportamental | Sistema 1 (rápido, automático, emocional) vs. Sistema 2 (lento, deliberado, caro). Defende **arquitetura de escolha**: o ambiente (estrutura bancária, formas de pagamento, hábitos) deve ser desenhado para que a decisão financeiramente correta seja a *default*, sem depender de força de vontade constante. Introduz o conceito de "dor do pagamento" — diferentes meios de pagamento geram diferentes níveis de percepção de gasto (dinheiro > débito > cartão de crédito > pagamento recorrente invisível). |
| 03 — Precifique Seus Sonhos | Precificação dos Sonhos | Converte desejos vagos ("quero viajar", "quero trocar de carro") em metas SMART: (1) listar sonhos, (2) fracionar cada sonho em sub-itens concretos e datáveis, (3) precificar cada sub-item, (4) confrontar o custo total/mensalizado com a capacidade de poupança real do usuário. Reserva de Emergência é tratada como **pré-requisito** dos sonhos — prioridade máxima antes de alocar capacidade de poupança a outros objetivos. |
| 04 — A Estrutura | Estruturação bancária | Mapeamento de todas as "entidades financeiras" (bancos, contas, cartões, investimentos) e dos fluxos de dinheiro entre elas. Princípio: **menos é mais** — reduzir o número de contas/cartões ativos ao mínimo necessário, eliminando "vazamentos" de visibilidade (dinheiro espalhado em lugares que não são olhados). |
| 05 — A Fotografia | Orçamento mensal estático | O orçamento mensal ideal, dividido em 3 blocos: **Gastos Fixos** (valor mensal, ex.: aluguel, assinaturas), **Gastos Variáveis** (estimados semanalmente e multiplicados por 4 — ex.: mercado, lazer, transporte do dia a dia), **Gastos Sazonais** (anuais, divididos por 12 — ex.: IPVA, seguro, presentes de fim de ano). Soma-se uma **margem de segurança** (sugestão inicial de ~15%) para imprevistos. Resultado: um "orçamento mensal de referência" contra o qual a renda é comparada. |
| 06 — A Fotografia Parte 2 | Mapeamento do cartão de crédito | Extensão da Fotografia para lidar com a distorção que parcelamentos no cartão causam no curto prazo. Propõe uma **linha do tempo de 6 meses** das faturas futuras, separando o "mês comum" (gastos recorrentes normais) do "extra do cartão" (parcelas e compras à vista que ainda vão cair em faturas futuras), permitindo prever picos e vales de fatura. |
| 07 — Os Quadrantes | Projeção semanal dinâmica | O coração operacional do método. A planilha de "quadrantes" divide cada mês em 4 células semanais (a 4ª célula absorve os dias excedentes). Cada célula contém: saldo inicial (= saldo final da célula anterior), gastos fixos da semana, "pacote" de gasto variável da semana, receitas previstas, e saldo final (que vira o saldo inicial da próxima célula). A fatura do cartão é tratada como uma célula especial de passagem ("buraco negro") — entra como débito grande na semana do vencimento. O horizonte recomendado é de **~3 meses** projetados à frente. |
| 08 — O Método | Rituais e manutenção | Após a montagem inicial (~2h), a manutenção é de **10–15 min por semana**: conferir o saldo real vs. o saldo projetado no quadrante da semana, ajustar o "pacote" variável restante, e simular o impacto de gastos grandes antes de decidir. Regra de ouro: **nunca tentar "recuperar o atraso" retroativamente** — sempre atualizar o estado atual e seguir em frente. Introduz a ideia de **conta de apoio**: uma conta separada onde se transfere, no início da semana, o "pacote" de gasto variável — tudo que sair dali é gasto variável da semana, sem precisar categorizar cada compra em tempo real. |
| 09 — Os Cartões de Crédito | Psicologia do cartão | Aprofunda a "dor do pagamento": o cartão de crédito anestesia a percepção de gasto porque desconecta o ato de pagar do ato de consumir, e porque agrega múltiplas compras em um único número (a fatura) que "explode" semanas depois. Recomenda, sempre que possível, **débito/Pix** para gastos variáveis do dia a dia (dor de pagamento mais alta = mais controle), reservando o crédito para compras planejadas e parceladas dentro do orçamento. |
| 10 — A Rotina | Motivação e sustentação | Fecha o curso reforçando a dimensão emocional: dinheiro é meio, não fim — os "sonhos" da aula 03 são o combustível que sustenta a rotina dos quadrantes. Aborda apatia/desmotivação como o maior risco de abandono do método (não a complexidade técnica), e recomenda revisitar os sonhos periodicamente. Também sinaliza **aposentadoria** como uma camada de poupança de longo prazo a ser incorporada desde o início, junto da Reserva de Emergência. |

---

## 3. Fundamentos Comportamentais (por que o método funciona)

| Princípio | Descrição | Implicação de produto |
|-----------|-----------|------------------------|
| Sistema 1 vs. Sistema 2 | Decisões do dia a dia devem exigir o mínimo de deliberação possível. | A ferramenta deve **pré-computar** projeções e classificações, não pedir que o usuário "pense no orçamento" a cada transação. |
| Arquitetura de escolha / nudges | O ambiente (default, visibilidade, fricção) molda o comportamento mais do que a intenção. | Defaults inteligentes (ex.: sugerir reserva de emergência antes de outros sonhos), alertas no momento certo (ex.: "faltam 3 dias e o pacote da semana já acabou"). |
| Dor do pagamento | Cartão de crédito reduz a percepção de gasto; dinheiro/débito aumenta. | Analytics pode evidenciar gasto por forma de pagamento/conta, reforçando consciência sem julgamento. |
| Conexão com sonhos | Plano sem propósito emocional não sustenta. | Metas devem ser visíveis e conectadas ao fluxo de caixa — não um módulo isolado. |
| "Nunca recuperar o atraso" | Replanejar a partir do presente, não tentar reconciliar o passado. | Projeções (quadrantes) devem sempre partir do **saldo real atual**, recalculando o futuro — nunca exigir reclassificação retroativa. |

---

## 4. As Ferramentas do Método (building blocks)

### 4.1 Precificação dos Sonhos
- **Entrada**: lista de sonhos/objetivos (texto livre).
- **Processo**: cada sonho é fracionado em sub-itens concretos, cada um com valor e prazo estimado.
- **Saída**: valor mensal necessário por sonho (`valor_subitem / meses_até_prazo`), somado entre sonhos.
- **Regra de prioridade**: Reserva de Emergência > sonhos, mas a RE pode (e deve) ser construída em
  paralelo com os sonhos quando possível — a prioridade afeta a *ordem de alocação* da capacidade de
  poupança, não necessariamente exclui os sonhos por completo.
- **Aposentadoria**: tratada como um "sonho" de prazo muito longo, recomendado desde o início.

### 4.2 Estruturação Bancária
- **Entrada**: lista de todas as contas/cartões que o usuário possui.
- **Processo**: mapear para onde o dinheiro entra (salário, outras receitas) e para onde sai
  (gastos fixos, variáveis, investimentos).
- **Saída**: estrutura simplificada — idealmente 1 conta principal (recebe receita, paga fixos),
  1 cartão de crédito, 1 conta de apoio (gasto variável), 1+ contas de investimento/reserva.
- Já bem coberto pelo Gimbo: `Account` com `type` (RETAIL, SAVINGS, CREDIT, etc.) e `includeInBalance`.

### 4.3 A Fotografia (orçamento mensal estático)
- **Classificação de categorias** em três grupos:
  - **Fixos**: valor mensal fixo (aluguel, assinaturas, financiamentos).
  - **Variáveis**: estimados por semana × 4 (mercado, lazer, transporte).
  - **Sazonais**: estimados por ano ÷ 12 (IPVA, seguro, presentes).
- **Margem de segurança**: percentual aplicado sobre o total (sugestão inicial ~15%).
- **Saída**: orçamento mensal de referência, comparável com a renda mensal esperada.

### 4.4 A Fotografia Parte 2 (linha do tempo do cartão)
- **Entrada**: parcelamentos ativos e compras correntes no cartão de crédito.
- **Processo**: projetar o total de cada fatura nos próximos ~6 meses, separando "mês comum"
  (recorrente) de "extra do cartão" (parcelas/compras pontuais).
- **Saída**: linha do tempo de faturas futuras, permitindo identificar meses de pico.

### 4.5 Os Quadrantes (projeção semanal dinâmica)
- **Estrutura**: grade de meses × 4 semanas (semana 4 absorve dias extras do mês).
- **Por célula (semana)**:
  - Saldo inicial = saldo final da semana anterior.
  - (–) Gastos fixos da semana (rateio dos fixos mensais, ou lançamentos recorrentes que caem na semana).
  - (–) "Pacote" de gasto variável da semana (orçamento variável mensal ÷ 4).
  - (+) Receitas previstas da semana.
  - (–) Fatura do cartão, na semana do vencimento (célula especial).
  - Saldo final = saldo inicial − fixos − variável − fatura + receitas.
- **Horizonte**: ~3 meses projetados.

### 4.6 Rituais de Manutenção
- **Setup inicial**: ~2h (Sonhos + Estrutura + Fotografia + Quadrantes iniciais).
- **Manutenção semanal**: 10–15 min — conferir saldo real vs. projetado, ajustar pacote restante.
- **Conta de apoio**: transferência semanal do "pacote" variável para uma conta separada; tudo que
  sai dali é gasto variável da semana (sem necessidade de categorizar cada lançamento em tempo real).
- **Regra de ouro**: sempre seguir em frente a partir do saldo real atual — nunca reconciliar o passado.

---

## 5. Mapeamento para o Modelo de Dados do Gimbo

### 5.1 O que já existe e cobre parte do método

| Conceito do DSM | Suporte atual no Gimbo |
|------------------|-------------------------|
| Estruturação bancária (4.2) | `Account` (tipos, `includeInBalance`, `issuerIcon`) — já maduro. |
| Gastos fixos recorrentes | `Recurrence` em `Transaction` (M-35) — séries `weekly`/`biweekly`/`monthly` com `endDate`. |
| Linha do tempo do cartão (4.4) | Motor de fatura virtual (`getInvoicePeriod`, `getInvoiceTotal`, `getInvoicePaid`, `getInvoiceStatus`, `getOpenCreditBalance`) já projeta faturas por período, incluindo parcelas futuras. |
| Dor do pagamento (3) | Dados já existem (gasto por `accountId`/`type`); falta a *visualização* analítica dedicada. |
| Patrimônio/Reserva de Emergência | `/net-worth` (F-24) já mostra breakdown por conta — uma conta SAVINGS dedicada já serve como "RE" hoje, mas sem meta/alvo associado. |
| Saldo real vs. projetado | Saldo derivado de transações (`balance + INCOME − EXPENSE − ...`) já é a base; falta a camada de **projeção futura**. |

### 5.2 O que falta — lacunas estruturais

| Conceito do DSM | Lacuna |
|------------------|--------|
| Sonhos/Metas (4.1) | Não existe entidade `Goal`. Sem precificação, fracionamento, prazo, nem vínculo com capacidade de poupança. |
| Reserva de Emergência como meta | Não existe conceito de "meta com prioridade"; RE é apenas uma conta sem alvo. |
| Classificação Fixo/Variável/Sazonal (4.3) | `Category` não tem campo de classificação nem valor-alvo orçamentário. |
| Fotografia (orçamento mensal) | Não existe entidade `Budget`/orçamento — nem cálculo de margem de segurança. |
| Quadrantes (projeção semanal) | Não existe motor de projeção de saldo futuro (apenas saldo presente derivado do passado/presente). |
| Conta de apoio | Não existe automação de "transferência semanal de pacote" nem marcação de conta como "conta de apoio". |
| Capacidade de poupança | Não existe cálculo de "quanto sobra por mês" comparado contra metas. |

---

## 6. Proposta de Decomposição em Etapas (candidatas a épico/feature)

> Numeração provisória `PL-XX` (Planejamento), a confirmar com o humano antes de entrar no
> `BACKLOG.md`/`PRD.md` formalmente. Ordem sugerida reflete dependências de dados (cada etapa
> reaproveita a anterior) — não necessariamente prioridade de entrega.

| ID | Etapa | Descrição | Depende de | Mapeamento DSM |
|----|-------|-----------|------------|----------------|
| PL-01 | Classificação orçamentária de categorias | Adicionar a `Category` um campo opcional `budgetType` (`FIXED` \| `VARIABLE` \| `SEASONAL`) e um `budgetAmount` (mensal para fixo/variável já mensalizado, anual para sazonal). Onboarding/wizard sugere classificação inicial com base no histórico de transações (médias por categoria). | — | 4.3 (Fotografia) |
| PL-02 | A Fotografia — tela de orçamento mensal | Nova tela que soma `budgetAmount` por grupo (Fixos, Variáveis × ... , Sazonais ÷ 12), aplica margem de segurança configurável (default 15%) e compara com a renda mensal média (já derivável das `Transaction` do tipo `INCOME`). Mostra "sobra" = capacidade de poupança. | PL-01 | 4.3 |
| PL-03 | Módulo de Sonhos/Metas (`Goal`) | Nova entidade `Goal`: nome, lista de sub-itens (descrição, valor, prazo), prioridade, conta vinculada (opcional, para acompanhar progresso via saldo/Valuation). Cálculo de "valor mensal necessário" por sonho e soma total. Bump de `schemaVersion`. | PL-02 (capacidade de poupança) | 4.1 (Sonhos) |
| PL-04 | Reserva de Emergência como meta prioritária | `Goal` com flag `isEmergencyFund`, valor-alvo sugerido (N meses de Gastos Fixos da Fotografia), priorização automática na alocação da capacidade de poupança entre metas. | PL-02, PL-03 | 4.1 (RE) |
| PL-05 | Linha do tempo de faturas (Fotografia Parte 2) | Tela/aba que usa o motor de fatura existente para projetar os totais das próximas ~6 faturas, separando recorrentes vs. parcelas/compras pontuais já registradas. Em boa parte reaproveita `getInvoicePeriod`/`getInvoiceTotal` aplicados a períodos futuros. | — (independe de PL-01..04) | 4.4 |
| PL-06 | Motor de projeção semanal (Quadrantes) | Novo módulo de cálculo: a partir do saldo real atual + `Recurrence` (fixos) + orçamento variável (PL-01, ÷4/semana) + faturas projetadas (PL-05) + receitas recorrentes, gera saldo projetado semana a semana por ~3 meses. Função pura em `lib/utils.ts`, testável isoladamente do UI. | PL-01, PL-05 | 4.5 |
| PL-07 | Tela de Quadrantes | Visualização em grade (mês × 4 semanas) do resultado de PL-06, com indicação visual de saldo projetado vs. saldo real conforme as semanas se concretizam. | PL-06 | 4.5 |
| PL-08 | Painel de acompanhamento semanal (Rituais) | Widget no Dashboard: "pacote variável restante esta semana" (orçamento variável da semana − gasto já realizado), alerta quando o pacote é excedido. Aplica o princípio "nunca recuperar o atraso" — sempre relativo à semana corrente. | PL-01, PL-06 | 4.6 |
| PL-09 | Conta de apoio (opcional/avançado) | Permitir marcar uma `Account` como "conta de apoio" e sugerir/registrar a transferência semanal do pacote variável (TRANSFER) como lançamento recorrente. Estritamente opcional — método funciona sem isso. | PL-08 | 4.6 |
| PL-10 | Insights de "dor do pagamento" | Novo gráfico em Analytics: distribuição de gasto por conta/forma de pagamento (débito/Pix vs. crédito), sem julgamento — apenas visibilidade. | — (independe das demais) | 3, 9 |
| PL-11 | Onboarding de planejamento | Wizard guiado que percorre PL-01 → PL-04 reaproveitando dados existentes (categorias já usadas, médias históricas) para minimizar input manual — alinhado ao princípio de baixa fricção do método. | PL-01..04 | 1, 8 |

### 6.1 Trilhas de entrega sugeridas

- **Trilha A — "Fotografia"** (PL-01, PL-02, PL-10): menor risco, maior reaproveitamento de dados
  existentes (médias de transações já registradas), entrega valor analítico imediato mesmo sem
  nova entidade de dados (exceto campos opcionais em `Category`).
- **Trilha B — "Sonhos"** (PL-03, PL-04): primeira entidade nova (`Goal`), mas isolada — não
  interfere no fluxo de transações existente. Bom candidato para validar o bump de schema.
- **Trilha C — "Quadrantes"** (PL-05 → PL-09): trilha mais complexa, depende das anteriores;
  é o "motor" do método e provavelmente o maior épico — recomenda-se documento de handoff próprio
  (`QUADRANTES.md`, no estilo de `NET_WORTH.md`) quando for priorizada.
- **Trilha D — "Onboarding"** (PL-11): só faz sentido após A, B e C terem telas mínimas funcionais.

---

## 7. Riscos, Premissas e Questões Abertas

| # | Questão | Observação |
|---|---------|------------|
| Q1 | Granularidade de "semana" nos Quadrantes | O método define semana 4 como "absorvendo dias extras" — precisa decidir se o Gimbo replica essa regra exatamente ou usa semanas ISO calendário, que são mais simples de implementar e exibir, mas não batem 1:1 com a planilha original. |
| Q2 | Onde guardar o "pacote variável restante" | É estado derivado (recalculável a qualquer momento a partir de transações + orçamento) ou precisa ser persistido para permitir ajustes manuais do usuário (ex.: "redistribuir sobra da semana 1 para a semana 2")? Impacta se PL-06/08 são puramente funções derivadas ou exigem nova entidade persistida. |
| Q3 | Vínculo Goal ↔ Account | Um sonho pode ser financiado por múltiplas contas (ex.: parte em poupança, parte em investimento)? Ou 1:1? Afeta o cálculo de progresso da meta. |
| Q4 | Margem de segurança configurável vs. fixa | O método sugere ~15% como ponto de partida, não como regra rígida — confirmar se vira um campo configurável em `Settings`/`WorkspaceFile` ou fica embutido na tela da Fotografia. |
| Q5 | Convivência com Recurrence existente | `Recurrence` (M-35) já modela gastos fixos recorrentes — confirmar que PL-01/02/06 reaproveitam essa estrutura em vez de criar um sistema paralelo de "orçamento fixo". |
| Q6 | Aposentadoria | Aula 10 sugere tratá-la como "sonho" de prazo muito longo — provavelmente não exige modelagem própria além de um `Goal` com prazo distante; revisitar se isso é suficiente. |

---

## 8. Próximos Passos Sugeridos

1. Validar com o humano a numeração `PL-XX` (ou outro prefixo) e decidir se este épico recebe um
   código `F-XX` no `PRD.md` (próximo disponível: **F-29**) e/ou entradas correspondentes no
   `BACKLOG.md`.
2. Priorizar entre as Trilhas A–D (seção 6.1) — recomendação: começar pela **Trilha A
   ("Fotografia")**, por reaproveitar dados já existentes e não exigir bump de schema.
3. Para a Trilha C ("Quadrantes"), planejar um documento de handoff dedicado antes da implementação,
   no padrão de `plan/NET_WORTH.md`.
4. Resolver as questões abertas da seção 7 antes de detalhar o modelo de dados de `Goal` e do
   motor de projeção semanal.

---

## 9. Análise do Board of Advisors

> Análise independente realizada por quatro perfis especializados com base neste documento.
> Cada conselheiro produziu sua perspectiva sem acesso às posições dos outros. A seção 9.5
> consolida os pontos de convergência e divergência.

---

### 9.1 Product Manager (startup, consumer fintech)

**Top 3 insights do DSM com maior relevância de produto**

1. **Sonhos são o motor de retenção, não as features.** As pessoas abandonam orçamentos não por
   complexidade, mas por desconexão emocional. O salto de "registro" para "planejamento" só sustenta
   se houver um motivo visível e carregado de significado para abrir o app toda semana. Os sonhos são
   esse motivo — sem eles, a camada de planejamento é só mais uma planilha.

2. **O "pacote semanal" é a superfície de decisão do dia a dia.** Os Quadrantes reduzem um mês
   inteiro de decisões financeiras a um único número: "quanto me sobra esta semana?" Esse é o tipo
   de métrica simples e consultável que forma hábito. O usuário não precisa entender o modelo todo —
   precisa saber se pode sair para jantar.

3. **"Nunca recuperar o atraso" é um princípio de design de produto, não só uma nota metodológica.**
   A maioria dos apps de orçamento falha porque envergonham o usuário com números vermelhos de três
   semanas atrás. O princípio do DSM de sempre projetar para frente a partir do saldo real atual é
   uma restrição de UX: a camada de planejamento nunca pode exigir limpeza retroativa, ou o usuário
   abandona na primeira semana que perder.

**MVP recomendado: PL-01 + PL-02 + PL-08**

- **PL-01** é a fundação dos dados, sem risco de schema (campos opcionais na `Category` existente).
  A sugestão automática a partir do histórico entrega valor imediato: "o Gimbo já sabe que você gasta
  ~R$800/mês em mercado."
- **PL-02** converte esses dados no número mais importante das finanças pessoais: "quanto sobra depois
  de todas as despesas planejadas?" É o primeiro momento em que o app deixa de descrever o passado e
  começa a prescrever o futuro — o "aha moment" do usuário de registro.
- **PL-08** é a âncora de hábito. Sem ele, o usuário configura a Fotografia uma vez e nunca volta.
  É a razão de abrir o Gimbo numa terça-feira.

Esse trio entrega o arco completo "setup → insight → hábito" sem exigir bump de schema.

**Features a adiar:** PL-09 (o método funciona sem ela); PL-11 (o wizard deve emergir dos pontos de
abandono observados, não ser projetado antes de conhecer a jornada do usuário experiente); PL-06/07
(o épico mais valioso a longo prazo, mas complexo demais para MVP antes de validar o engajamento
com a Fotografia).

**Wildcard não listado — "Budget vs. Actual" inline nos Lançamentos:** assim que as categorias
tiverem `budgetAmount` (PL-01), mostrar uma barra de progresso sutil no chip de categoria da tela
de Lançamentos existente. Nenhuma tela nova — apenas reforço contextual no momento de revisão de
transação. "Estou em 80% do orçamento de mercado com 12 dias restantes." Melhor relação
custo/retenção de qualquer item da lista.

**Maior risco de retenção:** o setup da Fotografia exige 30–60 minutos de classificação honesta de
categorias. Se o usuário encontrar fricção (muitas transações sem categoria, distinção FIXO/VARIÁVEL
não clara, sem defaults inteligentes), ele sai e nunca volta. A sugestão automática de PL-01 mitiga
isso, mas se os dados forem esparsos (usuário novo), o wizard vira um formulário em branco. O MVP
precisa de um fallback: **templates de categorias brasileiras pré-classificadas como
FIXO/VARIÁVEL/SAZONAL**.

---

### 9.2 Analista de Investimento (Vale do Silício / ex-CTO)

**Matriz de esforço**

| ID | Esforço | Motivação principal |
|----|---------|---------------------|
| PL-01 | Baixo | Campos opcionais em `Category`; sem bump de schema se `.optional()` no Zod; sugestão de médias é um `useMemo` sobre transações existentes. |
| PL-02 | Baixo–Médio | Agregação pura de UI sobre dados de PL-01; risco é a heurística de renda ser ruidosa para rendas irregulares. |
| PL-03 | Alto | Nova entidade `Goal` com sub-itens aninhados; bump de schema v5→v6; nova superfície de CRUD; lógica de progresso vinculada a saldos de contas. Grande área de superfície. |
| PL-04 | Médio | Aproveita o `Goal` do PL-03; adiciona flag, ordenação e alvo sugerido. Complexidade no algoritmo de alocação, não na modelagem. |
| PL-05 | Baixo | Quase inteiramente reutiliza `getInvoicePeriod`/`getInvoiceTotal` já em `lib/utils.ts`. |
| PL-06 | Alto | Motor de projeção compõe quatro cadências (Recurrence, budgetAmount, faturas futuras, receitas) em horizonte de 3 meses. Casos de borda multiplicam-se: semanas parciais nas bordas de mês, regra DSM "semana 4 absorve extras" vs. semanas ISO (Q1), e ancoragem do saldo real a cada nova transação. |
| PL-07 | Médio | UI de grade sobre output de PL-06; complexidade na visualização, não no cálculo. |
| PL-08 | Baixo–Médio | Trivial se fronteiras de semana estiverem resolvidas no PL-06; não trivial se não estiverem. |
| PL-09 | Baixo | Flag em `Account`, gerar `Recurrence` de TRANSFER. Nenhum novo modelo. |
| PL-10 | Baixo | Um gráfico novo em Analytics: agrupar por `accountId`/`Account.type`. Dados e biblioteca existentes. |
| PL-11 | Médio | Sequenciamento de steps, estado de navegação, lógica de skip. Sem novos dados. Custo de manutenção cresce conforme cada tela subjacente evolui. |

**Risco de schema:** PL-03 é o bump mais arriscado — nova entidade com sub-itens aninhados, sem
caminho de rollback em app local-first. Recomendações: (a) verificar se PL-01 é realmente
schema-additive sem bump (campos `.optional()` no Zod); (b) quando chegar ao PL-03, incluir PL-04
no mesmo bump, não dois incrementos separados.

**Melhor ROI:** PL-10 (um gráfico, zero schema), PL-05 (reutiliza motor de fatura com glue code
mínimo, entrega visão genuinamente nova), PL-01+PL-02 como unidade (fundação de todo o restante com
menor custo estrutural).

**Pior ROI:** PL-11 — wizards são caros de construir, caros de testar, decaem mais rápido que
qualquer outro elemento de UI, e entregam valor só para usuários de primeira vez, depois que o resto
já está polido. ROI próximo de zero até que Trilhas A, B e C estejam estáveis em produção.

**Armadilha oculta — PL-06:** parece "uma função pura em `lib/utils.ts`" mas esconde complexidade
de manutenção composta: quatro fluxos de input com requisitos de corretude próprios; o problema de
ancoragem (cada transação real postada recomputa a projeção da semana em diante); e a decisão ISO
week vs. semana DSM (qualquer escolha quebra o modelo mental de alguém). Este é o feature que vai
gerar mais bug reports por linha de código, indefinidamente.

**Reordenação sugerida:** mover **PL-10 para o início de tudo**, antes da Trilha A — é independente,
entrega em um sprint, e dá sinal precoce de engajamento analítico antes de comprometer toda a
arquitetura de planejamento. Dentro da Trilha C, **não iniciar PL-07 (UI) no mesmo sprint que
PL-06 (motor)** — resolver Q1 e Q2 em documento escrito antes de escrever uma linha de PL-06.

---

### 9.3 Especialista em UX (escola nórdica)

**Arquitetura de informação**

O tab de "Planejamento" não deve ser adicionado imediatamente ao nav — deve ser *ganho*, não
concedido. A abordagem correta é **progressive disclosure ancorada no Dashboard existente**:

- **Fase 1 (Fotografia):** Card persistente no Dashboard — "Fotografia do Mês" — mostrando ratio
  budget vs. gasto real, com CTA "Configurar" para novos usuários. Zero nova navegação.
- **Fase 2 (Quadrantes):** Quando o usuário completar o setup da Fotografia, o tab "Planejamento"
  aparece no nav inferior. Gateado por prontidão, não por feature flag.
- **Fase 3 (PL-11):** Wizard disparado explicitamente pelo usuário, nunca auto-lançado.

Nenhum usuário encontra uma tela de planejamento vazia. O tab aparece quando há dados que o tornam
significativo.

**Fluxo A — Setup da Fotografia (primeira vez)**

O usuário toca "Configurar" no card do Dashboard. Um bottom sheet abre com uma única pergunta:
"Quanto você recebe por mês?" (pré-preenchido com a média das transações INCOME dos últimos 3 meses,
editável). Na próxima tela, as categorias existentes aparecem pré-ordenadas por volume de gasto, cada
uma com tipo sugerido (FIXO/VARIÁVEL/SAZONAL) derivado da variância das transações — gasto estável
= FIXO, volátil = VARIÁVEL. O usuário revisa e corrige; a maioria não precisa alterar nada. Define
um valor-alvo por categoria, pré-preenchido com médias de 3 meses. Uma tela final de resumo mostra:
total orçado vs. renda, dial de margem de segurança (alvo 15%), superávit mensal projetado. Tempo
total para usuário com 6 meses de histórico: **menos de 8 minutos**. Regra crítica: nunca mostrar
categorias sem transações.

**Fluxo B — Check-in semanal (usuário recorrente)**

O usuário abre o app. O card do Dashboard mostra "Semana 2 de junho — R$180 restantes de R$400 de
pacote variável." Ele navega para a tela de Quadrantes. A célula da semana atual está destacada e
mostra saldo real, pacote variável restante e débitos fixos previstos na semana. Ele vê que a próxima
semana ficará apertada — a fatura do cartão cai na quinta. Decide gastar menos esta semana. Fecha o
app. Interação toda de leitura, menos de 3 minutos.

**Wireframe — Fotografia**

```
┌─────────────────────────────────────────────┐
│  Fotografia · Junho 2026            [Editar] │
├─────────────────────────────────────────────┤
│  Renda            R$ 8.500                  │
│  Orçamento        R$ 7.000  ████████░░  82% │
│  Margem           R$   735  (10,5%)         │
│  ──────────────────────────────────         │
│  Superávit mensal R$   765                  │
├─────────────────────────────────────────────┤
│  FIXOS            R$ 3.200 / R$ 3.200  ✓   │
│  Aluguel          R$ 2.000                  │
│  Assinaturas      R$   450                  │
│  Financiamento    R$   750                  │
│                                             │
│  VARIÁVEIS        R$ 2.180 / R$ 2.400  91% │
│  Alimentação      R$   980 / R$ 1.000       │
│  Transporte       R$   340 / R$   400       │
│  Lazer            R$   860 / R$ 1.000  ⚠   │
│                                             │
│  SAZONAIS         R$   620 / R$   400  ⚠   │
│                                             │
│  [Ver linha do tempo de faturas →]          │
└─────────────────────────────────────────────┘
```

Notas: renda e superávit são os dois números que mais importam — ancoram a tela. Os três grupos
ficam colapsados ao nível do grupo por padrão; toque expande ao detalhe por categoria. O ícone ⚠
aparece apenas quando o real supera o orçado — nunca vermelho (vermelho reservado para saldo
negativo). O link de linha do tempo de faturas é ação secundária, não tab.

**Wireframe — Quadrantes**

```
┌─────────────────────────────────────────────┐
│  Quadrantes              Jun · Jul · Ago     │
├─────────────────────────────────────────────┤
│  JUNHO                                      │
│  ┌────────┬────────┬────────┬────────┐      │
│  │ Sem 1  │ Sem 2  │ Sem 3  │ Sem 4  │      │
│  │ ✓ ok   │ ◉ atual│ projet.│ projet.│      │
│  │ +8.500 │        │        │        │      │
│  │ -2.100 │  -600  │  -600  │  -600  │      │
│  │   -900 │  -900  │  -900  │  -900  │      │
│  │        │        │-3.400⚡│        │      │
│  │ ─────  │ ─────  │ ─────  │ ─────  │      │
│  │  5.300 │  4.800 │   -100 │  (...) │      │
│  └────────┴────────┴────────┴────────┘      │
│                                             │
│  Sem 3: fatura do cartão (R$ 3.400)         │
│  Projeção negativa: R$ 100                  │
│  Sugestão: reduza variável na Sem 2         │
└─────────────────────────────────────────────┘
```

Notas: a célula da semana atual é a âncora visual — sempre centralizada em mobile. Semanas passadas
ficam em contraste reduzido. O alerta de shortfall aparece como sentença em linguagem natural abaixo
da grade, não como tooltip dentro da célula — a grade é para escanear, não para ler. Meses são tabs
horizontais (máximo 3). Layout mobile = um card por semana com swipe horizontal; desktop = grade
completa. São dois layouts genuinamente diferentes, não um squeeze responsivo.

**Top 3 riscos de UX**

1. **Abandono de setup na classificação de categorias.** Lista longa = paralisação. Máximo 6
   categorias por tela, pré-classificadas com confirmação de um toque. Exigir classificação
   explícita apenas para as categorias que representam os 80% superiores de gasto; o resto
   default para VARIÁVEL silenciosamente.
2. **Grade dos Quadrantes ilegível em 320px.** Uma grade de 4 colunas com dados financeiros não
   cabe em um celular sem truncar números ou reduzir texto abaixo do legível.
3. **Projeções desatualizadas destroem a confiança.** Se o usuário registra uma despesa grande
   e a tela de Quadrantes ainda mostra a projeção antiga, ele para de confiar e de consultar.
   A tela deve sempre recalcular a partir do saldo real ao abrir — sem botão "atualizar", sem
   timestamp "última atualização". Qualquer sinal visível de staleness será interpretado como bug.

**Princípio nórdico aplicável: *Tillräcklighet* (suficiência)**

A meta não é o orçamento mais detalhado — é a estrutura mínima que mantém o usuário no controle
com o menor esforço contínuo. A Fotografia mostra três números no topo antes de qualquer outra
coisa. Os Quadrantes mostram a semana atual e o próximo alerta antes de qualquer outra coisa.
Quando houver dúvida sobre incluir um elemento, removê-lo e observar se algo quebra. Se nada
quebrar, não era necessário.

---

### 9.4 Planejador Financeiro Pessoal (CFP)

**Fidelidade metodológica**

A decomposição está sólida e a cadeia de dependências espelha como Amuri sequencia o método. Duas
ressalvas:

- O documento captura a *estrutura* da Fotografia mas subestima seu **núcleo comportamental**. A
  divisão Fixo/Variável/Sazonal não é apenas taxonomia — é o mecanismo pelo qual os clientes param
  de lutar contra si mesmos. Gastos Fixos são não-negociáveis; Variáveis são a única alavanca que o
  cliente realmente controla. O PL-02 deveria surfaçar isso explicitamente na UI, não apenas no enum
  `budgetType`. O cliente precisa *ver* que apenas um bucket é o seu para controlar.
- O sinal da Aula 10 sobre aposentadoria (Q6) é tratado como nota de rodapé. Na prática, clientes
  que não criam um `Goal` de aposentadoria cedo quase nunca o adicionam depois. Deveria ser um
  **prompt obrigatório no onboarding**, não um "revisitar se necessário."

**Features de maior impacto em resultados reais**

1. **PL-08 (Pacote variável semanal):** o feature de maior alavancagem de toda a lista. Clientes não
   falham anualmente — falham numa terça-feira quando não sabem se podem sair para jantar. Um widget
   "R$180 restantes esta semana" elimina essa incerteza sem exigir disciplina de categorização em
   tempo real. Clientes que adotaram o conceito de pacote semanal reduziram gastos por impulso em
   6–8 semanas.

2. **PL-04 (Reserva de Emergência como meta com valor-alvo):** a RE para de ser abstrata no momento
   em que ganha um número. "3 meses de fixos = R$6.400" é motivante. "Tenho uma conta poupança" não
   é. A barra de progresso em direção a uma meta concreta é o que mantém o cliente poupando nos
   meses entediantes.

3. **PL-02 (Fotografia — comparação orçamento vs. renda):** muitos clientes nunca viram o número
   "seu piso de gasto mensal é R$X" calculado automaticamente a partir do próprio histórico. O choque
   desse número — geralmente 20–30% maior do que estimavam — é um ponto de inflexão comportamental.
   O Gimbo já tem todos os dados; só precisa surfaçá-los.

**A armadilha da Fotografia**

Aproximadamente 60% dos clientes preenchem a Fotografia uma vez e nunca mais tocam nela. A solução
de produto **não** é notificar o usuário para atualizar o orçamento — é fazer o orçamento
**se auto-atualizar por padrão**, com overrides opcionais. O `budgetAmount` deveria ser derivado da
média dos últimos 3 meses de transações reais por categoria, com o usuário podendo sobrescrever
individualmente quando quiser estabelecer uma meta deliberada. Isso muda o modelo mental de "preciso
manter um orçamento" para "o orçamento reflete o que eu realmente faço, e posso mudar linhas
específicas intencionalmente." Um prompt trimestral leve — "Seu gasto médio em mercado aumentou
R$180 vs. seu orçamento — atualizar a Fotografia?" — é suficiente para manter vivo sem ansiedade.

**Meta mínima viável para Reserva de Emergência**

Comece com **1 mês de gastos fixos, não 3–6**. A recomendação padrão paralisa clientes porque o
número parece impossível. Um mês é alcançável em 3–6 meses para a maioria dos assalariados de renda
média. Depois de atingi-lo, quase todos continuam poupando sem estímulo adicional. O Gimbo deveria
oferecer **dois marcos visuais distintos na mesma barra de progresso**: 1 mês (meta inicial) e 3
meses (meta ideal).

**O que o DSM não cobre — lacuna crítica: triagem de dívidas**

O conceito mais importante ausente do método inteiro é a **triagem de dívidas**. O DSM assume que
o usuário entra no método em estado razoavelmente estável. Na prática, uma parcela significativa dos
clientes chega com dívida rotativa de cartão (15–20% a.m.), empréstimos pessoais ou consignado que
tornam qualquer poupança fútil enquanto a dívida não for endereçada.

A Fotografia desses clientes vai mostrar "sobra negativa" sem oferecer orientação. O Gimbo deveria
adicionar uma camada simples de triagem — mesmo que seja apenas permitir marcar contas-passivo com
uma **taxa de juros** e surfaçar um metric "custo mensal da dívida" ao lado da comparação
orçamentária. A intervenção comportamental é simples: "Você está pagando R$X/mês em juros.
Eliminar essa dívida em Y meses liberaria R$X para poupança." Esse insight único, surfaçado no
momento certo, vale mais para clientes de alto endividamento do que o sistema de Quadrantes inteiro.

> Esta lacuna sugere a adição de **PL-12 — Triagem de Dívidas** como feature de baixa complexidade
> técnica (campo `interestRate` opcional em `Account` + metric derivado), com alto impacto para um
> subconjunto crítico de usuários.

---

### 9.5 Síntese — Convergências e Tensões do Board

**Consenso unânime**

| Ponto | Posição consolidada |
|-------|---------------------|
| Feature mais importante | **PL-08** — PM chama de "âncora de hábito", planejador chama de "maior alavancagem em resultados reais", analista classifica como baixo esforço. |
| Ponto de entrada correto | **PL-01 + PL-02 (Fotografia)** — todos convergem por razões complementares. |
| PL-11 (wizard) | **Não construir agora** — deve emergir do produto maduro, não o preceder. |
| Fotografia estática | **A auto-atualização é necessária** — PM e planejador identificaram independentemente a mesma armadilha. |

**Tensão produtiva**

| Tema | Divergência |
|------|-------------|
| PL-10 (insights de pagamento) | Analista: melhor ROI imediato, entrega em um sprint. PM: não menciona no MVP. Resolução sugerida: **quick win paralelo** à Trilha A, sem bloquear nem ser bloqueado. |
| Timing dos Quadrantes | PM quer adiar até validar a Fotografia. Analista alerta sobre armadilha de manutenção. UX já tem wireframes prontos. Consenso implícito: **projetar e documentar agora, implementar depois.** |

**Contribuição fora do escopo original — a mais importante**

O planejador identificou uma lacuna não coberta pelo DSM nem pelos PL-01..11: **triagem de dívidas
(PL-12)**. Para usuários com dívida rotativa de alto custo, o módulo de planejamento inteiro é
contraproducente sem antes surfaçar o custo mensal dessa dívida. Proposta de baixa complexidade:
campo `interestRate?: number` opcional em `Account` + metric "custo mensal da dívida" derivado na
tela da Fotografia.

**Ordem de build recomendada pelo board**

```
PL-10  →  PL-01  →  PL-02  →  PL-08  →  PL-12  →  PL-03  →  PL-04  →  PL-05  →  PL-06  →  PL-07
(quick     (Fotografia MVP)    (hábito)   (dívidas)  (Sonhos)           (Quadrantes — épico próprio)
 win)
```

PL-09 e PL-11 ficam fora da sequência principal: PL-09 é opcional por design; PL-11 só após todas
as telas estarem estáveis.
