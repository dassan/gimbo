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
* **F-9:** Motor de Armazenamento Local — SQLite via `wa-sqlite` (WASM) + OPFS, com export/import de um arquivo de backup `.db` portátil.
* **F-10:** Seletor de idioma (pt-BR / en-US).
* **F-11:** Onboarding: "Criar Novo Cofre" ou "Importar Backup Existente" (arquivo `.db`). Após a criação do cofre, exibir modal de boas-vindas (uma vez, com checkbox "não mostrar novamente" persistido em `localStorage`) explicando o app, sua proposta de privacidade local-first e o setup opcional de backup automático — com link interno para `/docs/why-browser-storage` e `/docs/backup-local`. Ver tarefa BK-06 em `plan/BACKLOG.md`.
* **F-12:** Auto-save em SQLite (OPFS) via `replaceAll()` numa transação atômica, com debounce de ~300ms após cada mutação.
* **F-13:** Audit Log com retenção configurável (200 entradas, ou ilimitado opt-in).
* **F-14:** ~~Badge de sync na Navbar com contagem de mutações pendentes.~~ **Removido** — não há mais um arquivo externo para sincronizar; cada mutação já é persistida localmente (F-12).
* **F-15:** Aba "Histórico" em Configurações — Audit Log agrupado por data (CREATE/UPDATE/DELETE).
* **F-16:** ~~Cold Start Sync — FileHandle persistido no IDB, restaurado no startup.~~ **Removido** — substituído pelo armazenamento SQLite/OPFS, que não depende de seleção de arquivo. Backup automático em pasta local é F-28 Nível 1.
* **F-17:** Hydration — validação Zod completa ao importar um backup `.db` (`importBlob()` + `runMigrations()`).
* **F-18:** ~~Conflict Sync — detecção de modificação externa via `lastModified`, modal de conflito.~~ **Removido** — cada dispositivo mantém seu próprio banco SQLite local, sem merge automático. Sync multi-dispositivo é F-28 Nível 2 (planejado).
* **F-19:** ~~Lost File Sync — detecção de `NotFoundError`, ícone vermelho, re-pick.~~ **Removido** — não aplicável ao OPFS (não depende de um `FileHandle` externo).
* **F-20:** ~~Re-permissão do FileHandle — `queryPermission` no startup, fluxo de prompt/denied.~~ **Removido** do fluxo principal; aplicável apenas à pasta de backup opcional (F-28 Nível 1 — banner de reconexão `BK-04`, aberto).
* **F-21:** Gestão de Lifecycle de Cartões de Crédito — `creditMetadata`, motor de fatura virtual, saldo disponível, página `/credit-card/:accountId`, painel de pagamento dedicado.
* **F-22:** Parcelas — N transações com sufixo `" (X/N)"`, modal de exclusão "só esta / todas".
* **F-23:** Pagamento de Fatura — tipo `CREDIT_PAYMENT`, exclusão dos totais de receita/despesa.
* **F-24:** Patrimônio Líquido (Net Worth) — página dedicada na navbar (`/net-worth`) com stat cards, breakdown por conta e gráfico de evolução histórica mensal (AreaChart). Ativos = contas não-CREDIT com `includeInBalance` + valuations de STOCKS/CRYPTO/FOREX/ASSET; passivos = `getTotalCreditLiability` de cada conta CREDIT (fatura atual em aberto). Toggle `netWorthIncludeHidden` controla a inclusão de contas com `includeInBalance=false`. Ver épico `plan/BACKLOG.md` (NW-01 a NW-08) e `plan/NET_WORTH.md`.
* **F-25:** Demo Mode — versão pública do app com dados sintéticos pré-carregados (`assets/demo-data.json`) e persistência desabilitada (mutações no-op). Ativado via `VITE_DEMO_MODE=true`. Inclui banner de aviso e deploy estático (build via `npm run build`, hospedável em qualquer host estático). Ver épico `plan/BACKLOG.md` (DM-01 a DM-05).

* **F-26:** Bug Report System — coleta local de eventos em ring buffer (sem transmissão automática), formulário de reporte opt-in com preview do snapshot seguro, envio via link GitHub Issues pré-preenchido. Ver épico completo em `plan/METRICS.md`.

* **F-27:** Mobile PWA — versão responsiva do Gimbo instalável em dispositivos móveis. Mesma codebase, layout adaptativo (bottom nav, bottom sheets, `DatePicker` nativo em mobile); sem app nativo separado. Cobre Dashboard, Lançamentos (CRUD completo), Configurações e Patrimônio. **Pendente:** Analytics ainda exibe placeholder "em breve" em telas pequenas (`MB-08`, aberto — gráficos Recharts não são responsivos). Ver épico `MB` em `plan/BACKLOG.md`.

* **F-28:** Backup & Sync — modelo em três níveis, cada um independente e opcional. O usuário escolhe o nível adequado ao seu perfil; níveis mais avançados só são implementados se houver demanda comprovada.

  | Nível | Mecanismo | Risco principal | Status |
  |-------|-----------|-----------------|--------|
  | 0 — Somente navegador | SQLite via `wa-sqlite` + OPFS | Browser limpa dados (`Clear site data`, troca de browser) | Implementado |
  | 1 — Pasta local | FSA `FileSystemDirectoryHandle` persistido via `idb`; escrita automática (`exportBlob()`) após cada mutação, debounced | Requer re-permissão por sessão (banner de reconexão); Chrome/Edge apenas; sem sync mobile | Implementado — ver épico `BK` em `plan/BACKLOG.md` |
  | 2 — Cloud Sync | Google Drive ou Dropbox via OAuth2 PKCE; merge aditivo por UUID | OAuth, conflitos multi-device, dependência de rede | Planejado — ver épico `CS` em `plan/BACKLOG.md` (CS-01 a CS-12), demand-driven |

  **Nível 1 — nota de produto:** se a pasta configurada estiver dentro do Google Drive, Dropbox ou OneDrive, o sync para a nuvem ocorre automaticamente pelo cliente desktop — sem OAuth, sem código adicional. Cobre a maioria dos usuários desktop sem implementar o Nível 2.

  **Nível 2 — nota de produto:** necessário para sync mobile real (onde não há cliente desktop instalado) e para usuários que não usam um cliente de nuvem. Requer `updatedAt` nas entidades mutáveis (schema v3). Política de conflito: último `updatedAt` vence em edições; transações duplicadas sobrevivem — usuário remove manualmente. Cenários em `plan/SYNC_SCENARIOS.md` (S-08 a S-15).

  **UX de configuração:** Settings → aba "Backup & Sync" exibe as opções dos Níveis 1 e 2 com texto explicativo, timestamp do último backup e link para a doc page interna correspondente. As opções são apresentadas como backup (não sync) enquanto o Nível 2 não estiver implementado. Ver tarefas BK-02, BK-06, BK-07 em `plan/BACKLOG.md`.

  **Doc pages:** rotas React estáticas dentro do app (funcionam offline), acessíveis a partir do modal de boas-vindas e da aba de Settings. Ver tarefa BK-07 em `plan/BACKLOG.md`.

### Fora do Escopo (Permanente)
* **X-1:** Criptografia do arquivo local.
* **X-2:** Sincronização via Open-Banking.
* **X-3:** App mobile nativo (iOS/Android separado) — a estratégia móvel é PWA responsiva (F-27).
* **X-4:** Login de servidor / modo multi-usuário partilhado.
* **X-5:** Audit Log em arquivo separado.
* **X-6:** Telemetria de uso automática (analytics de features) — incompatível com a proposta local-first enquanto não houver consentimento explícito e infraestrutura zero-servidor; decisão registrada em `plan/METRICS.md`.

## 6. Modelo de Dados e Arquitetura

Documentação detalhada em `ARCHITECTURE.md`. Resumo:

1. **Config UI (`localStorage nexus_workspace`):** Tema, idioma, visualização padrão, ambient shadows, inclusão de contas ocultas no Patrimônio.
2. **Ledger Financeiro:** persistido em SQLite local (`wa-sqlite` + OPFS), representado em memória como `DataFile` (schema v9). Entidades: `user`, `settings`, `accounts` (com `creditMetadata?`, `issuerIcon?`, `archived?`), `categories`, `tags`, `transactions` (com `installment?`, `recurrence?`, `transferAccountId?`, `referenceMonth?`, `invoiceDueDate?`), `valuations`, `auditLog`, `deletedIds`, `savedPeriods`.

```json
{
  "schemaVersion": 9,
  "user": { "name": "", "email": "", "createdAt": "", "updatedAt": "" },
  "settings": { "fileCreatedAt": "", "fileUpdatedAt": "", "auditLogRetentionLimit": 200 },
  "accounts": [{ "id": "", "name": "", "type": "RETAIL|SAVINGS|CREDIT|CRYPTO|FOREX|ASSET|STOCKS|OTHER", "balance": 0, "includeInBalance": true, "creditMetadata?": { "limit": 0, "closingDay": 1, "dueDay": 1 }, "issuerIcon?": "", "archived?": false }],
  "categories": [{ "id": "", "parentId": null, "name": "", "icon": "", "color": "", "type": "INCOME|EXPENSE" }],
  "tags": [{ "id": "", "name": "", "color": "" }],
  "transactions": [{ "id": "", "accountId": "", "categoryId": "", "amount": 0, "type": "INCOME|EXPENSE|TRANSFER|CREDIT_PAYMENT", "date": "", "description": "", "isPaid": false, "tags": [], "installment?": { "parentId": "", "currentIndex": 1, "total": 2 }, "recurrence?": { "frequency": "monthly", "parentId": "", "endDate?": "" }, "transferAccountId?": "", "referenceMonth?": "YYYY-MM", "invoiceDueDate?": "YYYY-MM-DD" }],
  "valuations": [{ "id": "", "accountId": "", "date": "", "marketValue": 0 }],
  "auditLog": [{ "id": "", "timestamp": "", "action": "", "entity": "", "entityId": "", "summary": "" }],
  "deletedIds": [],
  "savedPeriods": [{ "id": "", "name": "", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }]
}
```

Backup/restore: exportar/importar um arquivo `.db` (SQLite) ou configurar gravação automática numa pasta local via File System Access API (F-28 Nível 1).

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
* **Risco (perda de dados no browser):** o cofre vive no OPFS do navegador; limpar dados do site
  (`Clear site data`) ou trocar de browser/dispositivo apaga o cofre local. Mitigado por export
  manual de backup `.db` e pelo backup automático em pasta local (F-28 Nível 1).
* **Risco (uso multi-dispositivo):** sem Cloud Sync (F-28 Nível 2, planejado), cada dispositivo
  tem seu próprio cofre — uso intercalado exige export/import manual ou uma pasta de backup
  compartilhada via cliente de nuvem (Drive/Dropbox/OneDrive) do sistema operacional.
* **Risco (File System Access API):** o backup automático em pasta local (F-28 Nível 1) é
  Chrome/Edge-only; em Firefox/Safari essa opção fica oculta e o usuário depende do export manual.

## 10. Perguntas em Aberto
*(Nenhuma pergunta pendente no momento)*

## 11. Status de Implementação (2026-06-14)

### Features Must-have — todas implementadas

| Feature | Status |
|---------|--------|
| F-1 a F-20 | Perfil, contas, categorias, tags, transações, dashboard, analytics, persistência SQLite/OPFS, i18n, onboarding, audit log | ✅ |
| F-21 | Cartões de crédito — creditMetadata, motor de fatura virtual, saldo disponível, página dedicada, ícone de emissora, painel de pagamento | ✅ |
| F-22 | Parcelas — N transações com sufixo, modal de exclusão, selo "(X/N)" em Lançamentos e na fatura do cartão | ✅ |
| F-23 | Pagamento de fatura — CREDIT_PAYMENT, exclusão dos totais | ✅ |
| F-24 | Patrimônio Líquido — página dedicada, stat cards, breakdown por conta, gráfico de evolução (AreaChart) | ✅ |
| F-25 | Demo Mode — dados sintéticos, banner, persistência no-op | ✅ |
| F-26 | Bug Report System — telemetria local + reporte opt-in via GitHub Issues | ✅ |
| F-27 | Mobile PWA — bottom nav, layouts responsivos, bottom sheets, DatePicker nativo | ✅ (Analytics mobile pendente — `MB-08`) |
| F-28 Nível 0/1 | SQLite/OPFS local + backup automático em pasta local (FSA) | ✅ |
| F-28 Nível 2 | Cloud Sync (Google Drive/Dropbox) | 🔲 planejado (`CS-01` a `CS-12`) |

### Melhorias implementadas (M-01 a M-60)

Todas as melhorias até M-60 foram implementadas. Destaques desde a última revisão deste documento:

- **M-34 a M-44**: ícone de instituição emissora, ordenação de categorias em hierarquia, design
  system (chips, espaçamentos), remoção de elementos redundantes do Dashboard
- **M-42**: contas/cartões arquiváveis (`Account.archived`) — ocultos de seletores/listas, mas
  continuam contando em saldos e no Patrimônio
- **M-45**: períodos customizados salvos no seletor de Relatórios (`savedPeriods`, schema v9)
- **M-47**: `DatePicker` próprio (nativo em mobile, popup calendário em desktop), substituindo
  `<input type="date">` em todos os formulários
- **M-48/M-49**: rodapé de resumo de Lançamentos em coluna lateral (desktop) + "Saldo Geral" no
  Dashboard
- **M-50/M-59**: selo "(X/N)" para transações parceladas em Lançamentos e na fatura do cartão
- **M-51/M-52**: ferramenta de sync Organizze→Gimbo passa a refletir contas/cartões arquivados e
  normaliza nomes de tags (remove `#` duplicado)
- **M-53**: tooltip do gráfico de Entradas x Saídas corrigido para períodos > 12 meses (eixo X
  com chave única por ano)
- **M-54/M-55**: barra de filtro colapsável (categoria + busca por texto) na página do cartão,
  substituindo as chips horizontais
- **M-56/M-57**: navegação entre faturas movida para o cabeçalho da página do cartão; botão
  "Pagar Agora" oculto (não apenas desabilitado) quando a fatura está paga
- **M-58**: ação "mover para fatura anterior/seguinte" movida da linha do extrato para o
  `TransactionDrawer`
- **M-60**: padronização da exibição de categorias (sem `#`) entre Lançamentos e a fatura do
  cartão

### Relatórios Avançados — concluídos

Épico detalhado em `plan/REPORTS.md`. Todas as fases implementadas:
- ✅ Fase 1 — Navegação e Seletor de Período (R-01 a R-03)
- ✅ Fase 2 — Feature Toggle: Ambient Shadows (R-04 a R-06)
- ✅ Fase 3 — Cash Flow View (R-07 a R-08)
- ✅ Fase 4 — Categorias com Drill-Down (R-09 a R-10)
- ✅ Fase 5 — Contas com Drill-Down (R-11 a R-12)
- ✅ Fase 6 — Tags com Multi-filtro (R-13 a R-14)
- ✅ Fase 7 — Testes (R-15 a R-16)
- ✅ Fase 8 — Aba "Faturas" (R-17 a R-18)

### Cobertura de testes

**548 testes unitários** (21 arquivos) + **44 testes E2E** (5 specs, perfis desktop e mobile). Cobertura: ~97% statements.

### Melhorias e features em aberto

| ID | Descrição | Prioridade |
|----|-----------|-----------|
| MB-08 | Analytics responsivo para mobile — os 5 gráficos do Relatórios mostram placeholder "em breve" em telas pequenas | média |
| BK-04 | Banner de re-permissão da pasta de backup no startup (hoje só ocorre ao tentar gravar) | média |
| CC-34 | Agrupamento de parcelas importadas via `sync_gimbo.py` (`installment_parent_id` entre parcelas) | média |
| CS-01 a CS-12 | Cloud Sync (Nível 2) — Google Drive/Dropbox via OAuth2 PKCE, merge por UUID | demand-driven |
