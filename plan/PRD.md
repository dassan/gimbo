# [PRD] Gimbo - App de Finanças Pessoais (Client-Side)

Este documento atua como a Fonte da Verdade para o desenvolvimento do Gimbo.

---

## 1. Resumo Executivo (TL;DR)
O Gimbo é um aplicativo web (PWA Client-side) de gestão de finanças pessoais focado em extrema privacidade, velocidade de uso diário e planejamento avançado. Ele combina uma UX simples e rápida — inspirada em ferramentas comerciais — com uma arquitetura local (100% de leitura de arquivo JSON) que isenta a dependência de servidores terceiros e devolve ao usuário a propriedade de seus dados, enquanto também provê ferramentas sofisticadas para análise e previsão de fluxo de caixa.

## 2. Visão Geral e Problema
**Declaração do Problema:** Usuários rigorosos com suas finanças sofrem com a falta de privacidade de ferramentas comuns (que armazenam dados em nuvens corporativas), além de esbarrarem na limitação analítica dessas plataformas, não conseguindo ter clareza de como seu fluxo de passivo/ativo se comportará num horizonte temporal de curto/médio prazo.
**Objetivo (Por que agora?):** Construir uma plataforma de uso estritamente local (JSON) com zero instalação exigida (basta abrir um link), que consiga unir entrada rápida de dados diários com poderosos painéis de análise de "3 meses para trás e 3 meses para frente".
**Público-alvo:** Usuários organizados da área de finanças e tech, que demandam UX premium mas não abrem mão de privacidade e análises detalhadas.

## 3. Metas e Métricas de Sucesso (KPIs)
* **Tempo de Inserção de Despesa:** Lançamentos em < 6 segundos e no máximo 2 cliques da tela principal.
* **Performance e Latência de Renderização:** Troca instantânea entre telas e abas do aplicativo (< 100ms) visto que não há chamadas a backends.
* **Latência de Salvamento:** O motor de armazenamento vai gravar as mutações no arquivo em disco (em background) em < 300ms, sem congelamentos na UI.
* **Qualidade de bugs reportados:** Com o Bug Report System (F-26), cada reporte inclui snapshot de contexto seguro — objetivo é reduzir ciclos de ida-e-volta para reprodução de bugs.

## 4. Histórias de Usuário
* **US-1:** "Como usuário zeloso com dados, quero guardar meu histórico em um arquivo JSON puramente local para que bancos ou empresas terceiras não acessem ou comercializem meu padrão de vida."
* **US-2:** "Como planejador, quero um gráfico no dashboard agrupado por semanas que me mostre meus ganhos e projeções negativas nos próximos três meses, utilizando transações não-pagas, para eu visualizar a viabilidade do meu caixa."
* **US-3:** "Como observador, quero analisar um gráfico de pizza filtrado por período para analisar as proporções de gastos nas minhas categorias (e subcategorias)."
* **US-4:** "Como usuário diário do sistema, quero adicionar despesas, vincular tags e categorias com rapidez e sem passos confusos para manter minha adoção do produto consistente."

## 5. Escopo e Funcionalidades

### Dentro do Escopo (Must-have)
* **F-1:** Criação simples de perfil de usuário (Nome, E-mail, datas de edição).
* **F-2:** Sistema completo de Gestão de Contas com 8 tipos e flag `includeInBalance`. Saldo inicial editável no modal de criação/edição. Campo `issuerIcon` para contas CREDIT.
* **F-3:** Gestão de Categorias com suporte a hierarquia de Sub-categorias via "ParentId".
* **F-4:** Sistema de Tags personalizáveis e associáveis a múltiplas transações.
* **F-5:** CRUD rápido de Transações (Receitas, Despesas, Transferências).
* **F-6:** Dashboard do mês atual: receitas, despesas, saldo consolidado, card "Minhas Contas", seção "Meus Cartões" com barra de utilização, donut de despesas por categoria, últimos lançamentos (1ª parcela apenas para parcelados).
* **F-7:** Painel Analítico: Gráfico de linha/barra (Fluxo de Caixa ±3 Meses), com transações não-pagas.
* **F-8:** Painel Analítico: Gráfico de pizza de Despesas por Categoria.
* **F-9:** Motor de Arquivo Client-Side PWA (Exportar/Importar `data.json` local).
* **F-10:** Seletor de idioma (pt-BR / en-US).
* **F-11:** Onboarding: "Criar Novo Arquivo" ou "Importar data.json Existente".
* **F-12:** Auto-save via IndexedDB (debounce ~300ms).
* **F-13:** Audit Log com retenção configurável (200 entradas ou 90 dias, opt-in ilimitado).
* **F-14:** Badge de sync na Navbar com contagem de mutações pendentes.
* **F-15:** Tela "Modificações Recentes" em Configurações.
* **F-16:** Cold Start Sync — FileHandle persistido no IDB, restaurado no startup.
* **F-17:** Hydration Sync — validação Zod completa ao importar.
* **F-18:** Conflict Sync — detecção de modificação externa via `lastModified`, modal de conflito.
* **F-19:** Lost File Sync — detecção de `NotFoundError`, ícone vermelho, re-pick.
* **F-20:** Re-permissão do FileHandle — `queryPermission` no startup, fluxo de prompt/denied.
* **F-21:** Gestão de Lifecycle de Cartões de Crédito — `creditMetadata`, motor de fatura virtual, saldo disponível, página `/credit-card/:accountId`, painel de pagamento dedicado.
* **F-22:** Parcelas — N transações com sufixo `" (X/N)"`, modal de exclusão "só esta / todas".
* **F-23:** Pagamento de Fatura — tipo `CREDIT_PAYMENT`, exclusão dos totais de receita/despesa.
* **F-24:** Patrimônio Líquido (Net Worth) — página dedicada na navbar com snapshot e evolução histórica mensal. Todas as contas participam: não-CREDIT somam como ativos, CREDIT contribui como passivo. Ver épico `plan/BACKLOG.md` (NW-01 a NW-07).
* **F-25:** Demo Mode — versão pública do app com dados sintéticos pré-carregados e persistência desabilitada (`persist()` no-op). Ativado via `VITE_DEMO_MODE=true`. Inclui banner de aviso e deploy no Vercel. Ver épico `plan/BACKLOG.md` (DM-01 a DM-05).

* **F-26:** Bug Report System — coleta local de eventos em ring buffer (sem transmissão automática), formulário de reporte opt-in com preview do snapshot seguro, envio via link GitHub Issues pré-preenchido. Ver épico completo em `plan/METRICS.md`.

### Fora do Escopo (Futuro)
* **X-1:** Criptografia do arquivo JSON.
* **X-2:** Sincronização via Open-Banking.
* **X-3:** App mobile nativo.
* **X-4:** Login de servidor / modo partilhado.
* **X-5:** Audit Log em arquivo separado.
* **X-6:** Telemetria de uso automática (analytics de features) — incompatível com a proposta local-first enquanto não houver consentimento explícito e infraestrutura zero-servidor; decisão registrada em `plan/METRICS.md`.

## 6. Modelo de Dados e Arquitetura

Documentação detalhada em `ARCHITECTURE.md`. Resumo:

1. **Config UI (`localStorage nexus_workspace`):** Tema, idioma, visualização padrão, ambient shadows.
2. **Ledger Financeiro (`data.json`):** Schema v2. Entidades: `user`, `settings`, `accounts` (com `creditMetadata?`, `issuerIcon?`), `categories`, `tags`, `transactions` (com `installment?`, `transferAccountId?`), `auditLog`, `deletedIds`.

```json
{
  "schemaVersion": 2,
  "user": { "name": "", "email": "", "createdAt": "", "updatedAt": "" },
  "settings": { "fileCreatedAt": "", "fileUpdatedAt": "", "auditLogRetentionLimit": 200 },
  "accounts": [{ "id": "", "name": "", "type": "RETAIL|SAVINGS|CREDIT|...", "balance": 0, "includeInBalance": true, "creditMetadata?": {}, "issuerIcon?": "" }],
  "categories": [{ "id": "", "parentId": null, "name": "", "icon": "", "color": "", "type": "INCOME|EXPENSE" }],
  "tags": [{ "id": "", "name": "", "color": "" }],
  "transactions": [{ "id": "", "accountId": "", "categoryId": "", "amount": 0, "type": "INCOME|EXPENSE|TRANSFER|CREDIT_PAYMENT", "date": "", "description": "", "isPaid": false, "tags": [], "installment?": {}, "transferAccountId?": "" }],
  "auditLog": [{ "id": "", "timestamp": "", "action": "", "entity": "", "entityId": "", "summary": "" }],
  "deletedIds": []
}
```

## 7. Requisitos Não Funcionais (NFRs)
* **Arquitetura PWA/Static:** Sistema operando em Javascript puro sem servidor.
* **Internacionalização (i18n):** Multi-idiomas desde o dia 1 (pt-BR, en-US).
* **Performance Visual:** Renderizações sem spinners — In-Memory State tipado.
* **UI/UX Moderno:** Design responsivo mobile-first, paleta premium, toggle de ambient shadows.

## 8. Critérios de Aceitação (Gherkin Style)
* **Cenário:** Projeção correta do painel e fluxo de caixa de longo prazo.
  * *Dado que* o usuário acessa o Painel Avançado de ±3 meses.
  * *Quando* ele possuir títulos grandes de despesas não-pagas para os próximos 60 dias.
  * *Então* o gráfico de barras exibirá esses impactos negativos nas colunas de projeção corretamente.
* **Cenário:** Fechamento de fatura de crédito e salto inter-temporal de fluxo de caixa.
  * *Dado que* o cartão do usuário fecha no dia 10 e vence no dia 20.
  * *Quando* efetuar uma compra no dia 11.
  * *Então* a saída de caixa deve deslocar para o mês seguinte.

## 9. Riscos e Premissas
* **Risco (UX de Sync manual):** Uso intercalado exige que o usuário hospede seu `data.json` em cloud storage.
* **Risco (File API Access limits):** Se browsers móveis restringirem a FSA, o fallback import/export é a saída.

## 10. Perguntas em Aberto
*(Nenhuma pergunta pendente no momento)*

## 11. Status de Implementação (2026-05-24)

### Features Must-have — todas implementadas

| Feature | Status |
|---------|--------|
| F-1 a F-20 | Perfil, contas, categorias, tags, transações, dashboard, analytics, sync, i18n, onboarding, IndexedDB, audit log, badge, cold start, hydration, conflict, lost file, re-permissão | ✅ |
| F-21 | Cartões de crédito — creditMetadata, motor de fatura virtual, saldo disponível, página dedicada, ícone de emissora, painel de pagamento | ✅ |
| F-22 | Parcelas — N transações com sufixo, modal de exclusão | ✅ |
| F-23 | Pagamento de fatura — CREDIT_PAYMENT, exclusão dos totais | ✅ |
| F-24 | Patrimônio Líquido — página dedicada, snapshot + gráfico de evolução | 🔲 planejado |

### Melhorias implementadas (M-01 a M-33)

Todas as 33 melhorias planejadas foram implementadas, incluindo:
- M-23: Ícone da instituição emissora para contas CREDIT
- M-24: Separação visual "Contas e Cartões" no Settings
- M-25: Dashboard exibe apenas 1ª parcela de parcelados
- M-26: Tela de Lançamentos exclui transações de cartão
- M-27: Seletor de período com date-picker de mês
- M-28: Remoção da aba "Pag. Fatura" do TransactionDrawer
- M-29: Correção de sobreposição no centro do donut
- M-30: Painel dedicado "Pagar Fatura" na página do cartão
- M-31: Resumo de Gastos em coluna direita na página do cartão
- M-32: Resumo de Gastos em coluna direita na tela de Lançamentos
- M-33: Saldo inicial editável para contas

### Relatórios Avançados — concluídos

Épico detalhado em `plan/REPORTS.md`. Todas as fases implementadas:
- ✅ Fase 1 — Navegação e Seletor de Período (R-01 a R-03)
- ✅ Fase 2 — Feature Toggle: Ambient Shadows (R-04 a R-06)
- ✅ Fase 3 — Cash Flow View (R-07 a R-08)
- ✅ Fase 4 — Categorias com Drill-Down (R-09 a R-10)
- ✅ Fase 5 — Contas com Drill-Down (R-11 a R-12)
- ✅ Fase 6 — Tags com Multi-filtro (R-13 a R-14)
- ✅ Fase 7 — Testes (R-15 a R-16)

### Cobertura de testes

**474 testes unitários** (28 arquivos) + **19 testes E2E** (4 specs). Cobertura: ~97% statements.

### Melhorias e features em aberto

| ID | Descrição | Prioridade |
|----|-----------|-----------|
| M-22 | Estornos e chargebacks em contas CREDIT | baixa |
| F-24 | Patrimônio Líquido — página dedicada (NW-01 a NW-07) | média |
| F-25 | Demo Mode — dados sintéticos + persist no-op + deploy Vercel (DM-01 a DM-05) | alta |
| F-26 | Bug Report System — telemetria local + reporte opt-in via GitHub Issues (TASK-BR-01 a TASK-BR-08) | média |
