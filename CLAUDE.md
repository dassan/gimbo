# Gimbo — CLAUDE.md

> Instruções permanentes para qualquer IA que trabalhe neste projeto.
> Leia este arquivo integralmente antes de propor ou implementar qualquer coisa.
> Em caso de conflito entre este arquivo e instruções verbais da sessão, questione antes de agir.

---

## Identidade do Projeto

**Gimbo** — app web de finanças pessoais **local-first**, instalável como PWA.
Toda a informação reside em um banco **SQLite** (`gimbo.db`, via `wa-sqlite` + OPFS) no próprio
browser do usuário, exportável como arquivo `.db` que ele controla — sem servidor, sem nuvem.
Workflow de desenvolvimento IA + humano definido em `plan/RULES.md`.

> A camada `data.json` + File System Access API foi **substituída** por SQLite/OPFS em
> 2026-05-26 (ver `plan/STORAGE.md`). Referências a `data.json` em documentos antigos são
> históricas — o formato canônico atual é o `.db`.

---

## Documentação Técnica

| Documento | Caminho | Conteúdo |
|-----------|---------|---------|
| Arquitetura | `plan/ARCHITECTURE.md` | Stack, estrutura de diretórios, modelo de dados, APIs, fluxos de persistência, testes |
| Requisitos de produto | `plan/PRD.md` | Features F-1 a F-30, critérios de aceite |
| Backlog | `plan/BACKLOG.md` | Bugs (B-XX), melhorias (M-XX), cartão (CC-XX), relatórios (R-XX), backup (BK-XX), sync (CS-XX), segurança (SEC-XX) |
| Especificação técnica | `plan/SPEC.md` | Tasks de implementação por fase (TASK-XX); Fase 16 = sync multi-dispositivo |
| Cartão de crédito | `plan/CREDIT_CARD.md` | Decisões de produto e desafios técnicos do módulo CC |
| Cenários de sync | `plan/SYNC_SCENARIOS.md` | 20 cenários: SQLite atual (S-01..07), multi-desktop por pasta (S-16..20), nuvem (S-08..15) |
| Brainstorm de sync | `plan/FABLE-BRAINSTORM.md` | Análise das 7 alternativas de sync multi-dispositivo, matriz de trade-offs, roadmap faseado e decisões |
| Histórico de storage | `plan/STORAGE.md` | Decisão e migração JSON/FSA → SQLite/OPFS |
| Telemetria e bug report | `plan/METRICS.md` | Decisões de privacidade, arquitetura do F-26 (Bug Report System), tasks TASK-BR-01 a BR-08 |
| Relatórios avançados | `plan/REPORTS.md` | Épico do módulo analítico (5 views) |
| Saúde Financeira | `plan/FINANCIAL_HEALTH.md` | Decisões de produto/design da tela `/health` (F-29), conceitos, fórmulas e pontos em aberto |
| Caixinhas (budgets) | `plan/BUDGETS.md` | Decisões de produto/UX de `/budgets` (F-30, implementada — BX-01 a BX-11) |
| Sistema de design | `design/DESIGN.md` | Cores, tipografia, espaçamento, sombras, componentes (fonte única) |
| Workflow | `plan/RULES.md` | SDLC, cerimônias, divisão de responsabilidades |

---

## Padrões Críticos

### Parsing de datas — `parseDateLocal()`
Toda comparação de `tx.date` com mês/ano deve usar `parseDateLocal()` de `@/lib/utils`.
Nunca `new Date(tx.date)` para `.getMonth()`/`.getFullYear()` — causa bugs de fuso UTC.

### Saldo de conta — derivado de transações
O campo `Account.balance` representa o **saldo inicial** (editável no modal). O saldo exibido é
`balance + INCOME − EXPENSE − TRANSFER − CREDIT_PAYMENT` (o pagamento debita a conta pagadora via
`transferAccountId` — vale em Dashboard, Settings, Lançamentos **e** NetWorth/`applyTx`). Contas CREDIT
exibem **limite disponível** = `creditMetadata.limit − getOpenCreditBalance()`. Nunca exibir `acc.balance` diretamente.

### Motor de fatura virtual (B-16, Opção 2)
Funções puras em `lib/utils.ts`: `getInvoicePeriod`, `getInvoiceDueDate`, `getEffectiveCashFlowDate`,
`getInvoiceTotal` (charges − créditos do período), `getInvoicePaid` (Σ `CREDIT_PAYMENT` com
`referenceMonth` == período), `getInvoiceStatus` (aberta/parcial/paga), `getOpenCreditBalance`
(**fatura atual em aberto** = total do período corrente − pagamentos do período; base do limite
disponível e do passivo), `getCurrentInvoiceBalance` (fatura corrente, líquida), `getTotalCreditLiability`
(= open balance), `isCardCredit` (estorno = INCOME em conta CREDIT). Regras: `getEffectiveCashFlowDate`
só no gráfico de fluxo de caixa; categorias usam `tx.date`; `CREDIT_PAYMENT` excluído de Receitas×Despesas;
estornos abatem despesas (nunca contam como receita de caixa). **Escopo do passivo/limite = fatura atual**
(passado tratado como quitado; futuro excluído) — robusto a históricos longos e a snapshots com meses
de lançamentos futuros, onde "atual+futuras" estourava o limite.

### Tradução de tipos de conta
Sempre `t(\`accounts.${type.toLowerCase()}\`)`. Nunca exibir enum bruto.

### Caminhos de persistência (SQLite/OPFS)

> Corrigido em 2026-07-24: as funções `importFileToIdb()`/`syncToFile()` descritas aqui
> anteriormente **não existem mais no código** — pertenciam à camada IndexedDB/FSA removida em
> 2026-05-26. Os caminhos reais são:

| Caminho | Função | Quando |
|---------|--------|--------|
| Mutação normal | `storage.replaceAll(data)` | Toda mutação, via `debouncedReplaceAll()` (300ms) dentro de `mutate()` |
| Import de backup | `storage.importBlob(blob)` | Onboarding/Settings — **replace total**: fecha o DB, escreve os bytes no OPFS, reabre e roda `runMigrations()` |
| Export / backup | `storage.exportBlob()` | Botão "Exportar" e backup automático em pasta (WAL checkpoint antes de ler) |
| Backup em pasta | `writeBackupToDir(handle, blob)` | Após `replaceAll()`, se houver pasta configurada (`lib/backupDir.ts`) |

**Nunca misturar os caminhos:** `importBlob()` é replace destrutivo e nunca deve ser usado num
fluxo recorrente; `replaceAll()` nunca deve ser chamado fora de `mutate()`/`debouncedReplaceAll()`.
Falha de backup em pasta jamais interrompe o fluxo principal.

---

## Convenções de Código

### TypeScript
- **Strict mode**: `noUnusedLocals`, `noUnusedParameters`, `noImplicitAny`
- Type imports: `import type { DataFile } from '@/types'`
- Alias `@/` para `src/`
- Enums como union types de string

### Formatação
- Prettier: 100 chars, sem ponto-e-vírgula, aspas simples, trailing commas, 2 espaços

### Componentes
- Funcionais com hooks, `useMemo` para dados derivados pesados
- Interface de props exportada acima do componente

### Nomenclatura
- Componentes: PascalCase | Páginas: `index.tsx` em pasta | Stores: `use` + PascalCase
- Testes: `*.test.ts` (unit), `*.spec.ts` (E2E) | Constantes: UPPER_SNAKE_CASE
- Handlers: `handle` prefix | Privados de módulo: `_` prefix

---

## Git

```
<tipo>: <descrição imperativa em minúsculas>
```

Tipos: `feat:` | `fix:` | `test:` | `style:` | `refactor:` | `docs:` | `chore:`
Referência obrigatória ao ID (M-XX, B-XX, CC-XX, R-XX, BK-XX, HE-XX, CS-XX, MB-XX, SEC-XX) quando aplicável.
CI verde obrigatório. Nenhum `TODO` no código.

### Branch por tópico (revisado em 2026-08-19)

**Uma branch por tópico**, não por feature — `dassan/<tópico>` (ex.: `dassan/security-audit`,
`dassan/landing-page`, `dassan/sync-mobile`). Um tópico agrupa todo um esforço relacionado e pode
acumular vários itens do backlog antes de virar PR; a branch só fecha quando o tópico fecha.

**Um item por commit continua valendo.** É o commit que carrega o ID (`SEC-03`, `MB-08`…) e o
"porquê" — a granularidade que dá rollback e leitura de histórico. O que mudou foi só o escopo da
branch, não o do commit.

> A regra anterior era "uma feature por commit/PR". Foi revisada porque, nesta fase de construção
> da aplicação, features isoladas raramente descrevem bem o trabalho real: um tópico como segurança
> ou responsividade mobile rende uma série de itens pequenos e interdependentes, que revisar juntos
> é mais barato do que abrir uma PR por item. Reavaliar quando o app estabilizar e as mudanças
> passarem a ser majoritariamente incrementais.

---

## Scripts de Qualidade

```bash
cd app && npm run format:check
cd app && npm run lint
cd app && npx tsc -b --noEmit
cd app && npx vitest run --coverage
cd app && npx playwright test      # opcional local, obrigatório no CI
```

---

## Restrições — O Que NUNCA Fazer

### Código
- **Nunca** usar `as SomeType` para contornar validação Zod
- **Nunca** mutar estado Zustand diretamente — sempre via `mutate()`
- **Nunca** chamar `storage.replaceAll()` fora de `mutate()`/`debouncedReplaceAll()`
- **Nunca** chamar `storage.importBlob()` em fluxo recorrente — é replace destrutivo (só import/onboarding)
- **Nunca** exibir `acc.balance` diretamente — o saldo é derivado das transações
- **Nunca** usar `new Date(tx.date)` para extrair mês/ano — sempre `parseDateLocal()`
- **Nunca** deixar falha de backup em pasta interromper o fluxo principal
- **Nunca** adicionar `TODO` no código — vai para `BACKLOG.md`
- **Nunca** usar `console.log` em produção

### Testes
- **Nunca** substituir mock de FSA dos testes E2E por mocks em memória
- **Nunca** pular testes com `skip` sem registrar no BACKLOG

### Git/CI
- **Nunca** merge com CI vermelho
- **Nunca** `--no-verify` para pular hooks
- **Nunca** commits genéricos (`fix`, `ajuste`, `wip`)

### Dependências
- Não adicionar sem justificativa explícita
- Verificar `npm audit` a cada 3–5 features

---

## Início de Sessão — Checklist

1. Ler este arquivo (`CLAUDE.md`) integralmente
2. Ler `plan/BACKLOG.md` para estado atual de bugs e melhorias
3. Ler `plan/PRD.md` se a tarefa envolver produto/features novas
4. Ler `plan/ARCHITECTURE.md` se a tarefa envolver arquitetura/persistência/sync
5. Se a tarefa for do épico **CS (sync multi-dispositivo)**: ler também `plan/SPEC.md` (Fase 16),
   `plan/SYNC_SCENARIOS.md` e `plan/FABLE-BRAINSTORM.md` — as decisões já foram tomadas, não
   reabrir o leque de alternativas sem motivo novo
6. Ler os arquivos-fonte relevantes **antes** de propor mudanças
7. Confirmar escopo da sessão com o humano (1–3 itens, no máximo)

---

## Princípios do Workflow

1. **O CI é o árbitro** — se passa no pipeline, está pronto
2. **IA propõe, humano decide** — nunca o contrário
3. **Documentação ativa** — `BACKLOG.md` e `PRD.md` atualizados a cada ciclo
4. **CI falhou? Sessão para.** Não acumula dívida de pipeline
5. **Fim de sessão:** commit descritivo → `BACKLOG.md` atualizado → push

---

## Estado Atual (2026-08-18)

**Schema em memória v17** | **Schema físico SQLite v12** (`migrations/v1..v12.sql`) | Cobertura: ~96% statements
**841 testes unitários** (31 arquivos) + **59 testes E2E** (7 specs, perfis `chromium` e `mobile-chrome`)

> Os dois números de schema são independentes e **não coincidem**: `CURRENT_SCHEMA_VERSION` (v17,
> em `lib/storage/schema.ts`) versiona o `DataFile` em memória; `PRAGMA user_version` (v12)
> versiona o DDL físico. Bumps de campos opcionais não exigem DDL novo — por isso o schema em
> memória está à frente. Os bumps mais recentes vieram de F-30/Caixinhas: v14→v15 (entidade
> `Budget` + `Transaction.budgetIds`, `BX-03`, DDL novo em `migrations/v11.sql`) e v15→v16→v17
> (`Settings.quadrantesEnabled` + `Budget.createdAt`, `BX-07`/`BX-06`, DDL novo em
> `migrations/v12.sql`).

Todas as features do PRD (F-1 a F-30, com F-28 no Nível 1) implementadas. Módulo de Cartão de Crédito completo (CC-01 a CC-34 — CC-34 resolvido junto do M-64, via `created_at` do Organizze como chave de agrupamento). Melhorias M-01 a M-64 resolvidas (M-61 resolvido em 2026-08-18 — ver nota abaixo); M-65 registrado como futuro. Relatórios avançados R-01 a R-18 resolvidos.

Features concluídas desde 2026-05-27:
- **F-24** — Patrimônio Líquido: `/net-worth`, stat cards, breakdown por conta (NW-01 a NW-07). **Sem gráfico de evolução histórica** — apesar do que versões antigas desta nota diziam, nenhum `AreaChart`/série temporal existe no código; é exatamente o que `M-63b` (aberto, abaixo) pretende adicionar.
- **F-25** — Demo Mode: `lib/demo.ts`, dados sintéticos, banner, deploy público (DM-01 a DM-05; originalmente Vercel, migrado para **Cloudflare Pages** — ver nota abaixo)
- **F-26** — Bug Report System: `lib/telemetry.ts`, `BugReportDialog`, ErrorBoundary, Settings (TASK-BR-01 a BR-08)
- **F-27** — Mobile PWA: bottom nav, layouts responsivos, bottom sheet, manifest standalone, E2E mobile (MB-01 a MB-07). Bottom nav mobile atual: Dashboard, Lançamentos, Caixinhas e Relatórios (Configurações mudou para um menu no pill do nome do cofre, `MB-16`/`MB-17`). Analytics no mobile só tem a aba Categorias responsiva por ora (`MB-18`, parcial — ver `MB-08` abaixo).
- **F-28 Nível 1** — Backup Local: `lib/backupDir.ts`, aba "Backup & Sync", auto-backup, `WelcomeModal`, doc pages, sync manual (BK-01 a BK-03, BK-05 a BK-08; BK-04 aberto — banner de re-permissão)
- **F-29** — Saúde Financeira: tela `/health` **completa**, incluindo Reserva de Emergência (HE-01 a HE-16 resolvidos: entidade `LOAN`, motor de dívida total/comprometido/horizonte, renda híbrida com override editável, custo mensal médio, saldo de reserva por conta marcada, meta em meses configurável, detalhamento expansível real por cartão/`LOAN`/empréstimo em conta comum). Ver `plan/FINANCIAL_HEALTH.md` §6-8.
- **R-17/R-18** — View "Faturas" em Analytics: `FaturasView.tsx`, aba 5 na sub-nav, 14 testes unitários
- **B-16/M-22** — Ciclo de fatura de cartão (Opção 2): pagamento vinculado ao período (`referenceMonth`, schema v4→v5), `CREDIT_PAYMENT` debita a conta pagadora, fatura líquida de créditos + selo de status (aberta/parcial/paga), estornos como `INCOME` na conta CREDIT; sync preserva sinal e infere `referenceMonth`
- **M-62/B-22** — Camada de projeção de 10 anos no Fluxo de Caixa (Relatórios) + janela rolante de recorrências sem `endDate`
- **M-64/CC-34** — `Installment.purchaseDate` (data de compra original em todas as parcelas, schema v10→v11) + correção definitiva do agrupamento de parcelas no sync do Organizze via `created_at` como chave de série
- **F-30** — Caixinhas: entidade `Budget` real (N:N com `Transaction` via `budgetIds`), CRUD completo em `useDataStore`, motor de derivação (`budgetCurrent`/`budgetProgress`/`getBudgetStatus`), telas reais em `pages/Budgets/*` (sem `mock.ts`), receita automática "Quadrantes" (`lib/budgetRecipes.ts`, 4 caixinhas/mês por intervalo de dias), sync/merge multi-dispositivo, dados de demo e testes E2E (`BX-01` a `BX-11`, resolvido 2026-08-12). Bottom nav mobile tem slot próprio desde `MB-13`. Ver `plan/BUDGETS.md` e `plan/BACKLOG.md` seção "Caixinhas — F-30".

> **Deploy migrado de Vercel para Cloudflare Pages (antes de 2026-08-13, data exata não registrada).**
> `app/wrangler.jsonc` é a config de deploy atual; produção serve em `https://gimbo.com.br`. A
> migração não foi propagada para nenhuma config externa que referencia o domínio — já causou um
> incidente real: as "Authorized redirect URIs"/"Authorized JavaScript origins" do OAuth client do
> Google Drive (CS-01/CS-02) ficaram apontando para o domínio antigo da Vercel, e conectar o sync a
> partir de `gimbo.com.br` falhava com `Error 400: redirect_uri_mismatch` até serem atualizadas
> manualmente no Google Cloud Console. Qualquer outra allowlist amarrada ao domínio (CORS, CSP
> `connect-src`, webhooks) merece a mesma checagem antes de assumir que aponta para o lugar certo.

> **Repositório migrado de `dassan/gimbo-app` (privado) para `dassan/gimbo` (público) em
> 2026-08-18.** O histórico de commits foi reescrito para remover dados financeiros pessoais reais
> (nome completo de familiar, saldos/faturas de cartão, nomes de empregadores, fragmento de
> endereço) que estavam espalhados em revisões antigas de `plan/BACKLOG.md` e em
> `scripts/sync_gimbo.py`. O repo novo foi criado **do zero, sem compartilhar objetos git** com o
> antigo — não é um `push --force` no mesmo repo — porque uma PR squash-merged (#1, nunca
> incorporada a `main`) continha extratos bancários OFX reais e permanece acessível via
> `refs/pull/1/head` no GitHub para sempre, fora do alcance de qualquer reescrita de histórico
> local. `dassan/gimbo-app` está **aposentado e deve permanecer privado para sempre** — não
> reabrir, não tornar público, não apontar deploy/CI para lá. Uma sessão futura que notar a
> divergência de histórico entre os dois repos (commits diferentes, sem ancestral comum) não deve
> tentar "reconciliar" ou reescrever nada — é o resultado esperado e intencional da migração.
> Deploy (Cloudflare Pages) e `app/wrangler.jsonc` referem-se ao projeto de deploy, não ao nome do
> repositório GitHub — os dois podem divergir (`gimbo` vs. `gimbo-app`) sem que isso seja um erro.

> **M-61 resolvido em 2026-08-18.** As 16 vulnerabilidades acumuladas desde a última passada (a
> premissa de que faltava um bump major do `vitest` estava desatualizada — o projeto já estava em
> `vite@8`/`vitest@3.2.x`) foram corrigidas com `npm audit fix --legacy-peer-deps`, 14/16 in-range
> sem tocar `package.json`. As 2 restantes não tinham fix upstream e vinham só de
> `@vite-pwa/assets-generator` (gerador de ícones PWA usado uma única vez no F-27, não referenciado
> em nenhum script/CI) — **removido** de `devDependencies`; os ícones já gerados continuam em
> `app/public/icons/`, e o pacote pode ser rodado sob demanda via `npx` se precisar regenerá-los.
> Resta 1 vulnerabilidade baixa de `esbuild` vendorizada internamente pelo próprio `vite@8.2.1`
> (Windows-only, dev server apenas, abaixo do gate `--audit-level=high` do CI) — sem como corrigir
> sem esperar um patch novo do Vite; não é um item de ação.

Itens em aberto:
- **SEC-01 a SEC-15** — Auditoria de segurança pré-open-source (2026-08-18/19, branch `dassan/security-audit`) — ver `plan/BACKLOG.md` seção "Segurança — Auditoria Pré-Open-Source (SEC)". **0 Critical, 2 High, 3 Medium, 4 Low, 5 Info**, mais o `SEC-15` achado ao implementar o `SEC-03`. Nenhum achado foi causado por tornar o código público (histórico git limpo de segredos, `.env` nunca versionado). **Resolvidos: SEC-02 a SEC-09, SEC-14 e SEC-15** — headers de segurança em produção (`app/public/_headers`, com CSP), `refresh_token` do Google fora do `localStorage` (cifrado em IndexedDB + teto de 30 dias), import que valida antes de destruir o cofre, migrations atômicas com resgate de boot, fonte Inter self-hospedada, actions fixadas por SHA, escopo do bug report reduzido, `legacy-peer-deps` removido e `THIRD-PARTY-NOTICES.md`. **Aceitos: SEC-10 a SEC-13.** **Em aberto: `SEC-01`** — auditar as "Authorized redirect URIs" do OAuth client no Google Cloud Console. É ação manual no console, não código, e é o **único controle de acesso restante** dado que o `client_secret` é público por construção (ver `googleAuth.ts`). Deve conter exclusivamente `https://gimbo.com.br/settings`. > **Nada disso está em produção até rodar `npm run deploy`** — os headers e a fonte self-hospedada só valem no build publicado.
- **Cofre protegido por senha** — épico separado, decidido em 2026-08-19: bloqueio por senha com expiração por inatividade, e criptografia em repouso. **Reverte parcialmente o `X-1` do `PRD.md`** ("Criptografia do arquivo local", hoje listado como fora de escopo permanente) e encosta no `CS-18`. Ainda não desenhado — decisão pendente: se o backup exportado continua abrível em qualquer ferramenta SQLite ou vira blob opaco.

- **MB-08** — Analytics responsivo para mobile (média prioridade; parcial — aba Categorias resolvida em `MB-18`, as outras 4 abas — CashFlow, Contas, Tags, Faturas — seguem sem versão mobile)
- **BK-04** — Banner de re-permissão da pasta de backup no startup (média prioridade)
- **M-63b** — Gráfico de tendência (passado real + futuro projetado) no Patrimônio Líquido (baixa; a fatia de Saúde Financeira do M-63 já foi resolvida)
- **M-65** — WebDAV como transporte de sync adicional (baixa, demand-driven — adiado em 2026-07-24)
- **F-28 Nível 2** — Sync multi-dispositivo (CS-01 a CS-20) — demand-driven, ver roadmap abaixo. **Fases 0, 1 e 2 resolvidas** (motor de merge + multi-desktop via pasta compartilhada em 2026-07-24, CS-19/CS-04/CS-05/CS-10a e CS-13 a CS-17; Google Drive em 2026-07-25, CS-01 a CS-03 e CS-06 a CS-09, validado ponta-a-ponta contra a API real). **Achado que corrigiu o design original:** clientes OAuth "Aplicativo da Web" do Google exigem `client_secret` mesmo com PKCE — não existe tipo de cliente que aceite `redirect_uri` HTTPS de produção **e** dispense o secret. `VITE_GOOGLE_CLIENT_SECRET` passou a ser bundlada no build público (ver comentário em `googleAuth.ts` sobre por que isso não compromete a segurança real do fluxo).

> `BK-09` (aviso de cópia-em-conflito do Nível 1 em `/docs/backup-local`) foi absorvido pelo `CS-17` acima e está resolvido — o modo multi-dispositivo elimina o conflito por construção, e a doc page agora explica os dois cenários.
- **B-21** — Fronteira do dia de fechamento de fatura: marcado como *won't fix* (aceito)

### Roadmap de Sync Multi-Dispositivo (F-28 Nível 2) — decidido em 2026-07-24

Princípio central: **motor de merge único, transporte plugável.** Análise completa das
alternativas em `plan/FABLE-BRAINSTORM.md`; cenários em `SYNC_SCENARIOS.md`; spec técnica na
Fase 16 de `SPEC.md`.

| Fase | Transporte | Entrega | Itens |
|------|-----------|---------|-------|
| **0** ✅ | — | Motor de merge (`updatedAt` + `merge.ts` + testes) — **resolvido 2026-07-24** | CS-19, CS-04, CS-05, CS-10a |
| **1** ✅ | Pasta compartilhada, **um `.db` por dispositivo** | Multi-desktop, sem OAuth — **resolvido 2026-07-24** | CS-13 a CS-17 |
| **2** ✅ | Google Drive API (OAuth2 + client secret bundlado — PKCE puro não é suportado pelo Google para clientes Web) | **Desbloqueia mobile** — **resolvido e validado em produção 2026-07-25** | CS-01..03, CS-06..09, CS-10b |
| **3** | Dropbox | 2º provider | CS-11, CS-12 |
| — | Transversal | Cifragem opcional, telemetria de sync | CS-18, CS-20 |

Decisões que qualquer IA deve respeitar ao implementar:
- **Um escritor por arquivo** (Fase 1): cada dispositivo grava só o seu `device-<uuid>.db`. É o
  que elimina a cópia-em-conflito do Nível 1 **por construção** — nunca escrever no arquivo alheio.
- **Merge idempotente** é requisito, não detalhe: é o que torna seguro pular um arquivo ilegível
  e retentar no boot seguinte.
- **Falha de peer é sempre não-fatal** — nunca bloquear o boot; o app hidrata do OPFS local primeiro.
- `deviceId` no **OPFS** (não `localStorage`); snapshot `.db` completo (não oplog); cifragem
  client-side **opcional e off por padrão**.
- Fase 1 é **desktop apenas** (File System Access API) — nenhuma superfície de UI pode sugerir
  sync com celular antes da Fase 2.
- **Verificação OAuth do Google (CS-01):** `drive.file` é escopo **não-sensível** → não exige a
  revisão completa. O necessário é publicar em *publishing status* "Production" (a premissa
  anterior, de que a verificação era um bloqueio duro, foi revisada em 2026-07-24).

Decisões arquiteturais (2026-05-27, mantidas):
- Estratégia mobile = PWA responsiva (não app nativo). X-3 do PRD atualizado.
- Política de conflito = merge aditivo por UUID + LWW por `updatedAt`; duplicatas offline sobrevivem, usuário remove manualmente; deleções protegidas por `deletedIds`.
- Nenhum servidor Gimbo em nenhuma fase — a camada de sync é sempre infraestrutura do próprio usuário.

Ferramentas de desenvolvimento (2026-06-08, atualizado em 2026-08-12):
- **Sync Organizze → Gimbo** (`scripts/sync_gimbo.py` — versionado desde 2026-08-10, antes vivia só em `data/`, gitignored): script de benchmark que lê a API do Organizze por demanda e gera um `gimbo.db` (`PRAGMA user_version = 12`) para importar. IDs determinísticos (`uuid5`), saldos iniciais zerados (preenchidos à mão), janela `--start`/`--end` (com `--end` futuro para lançamentos não pagos). **Dois modos**: snapshot (`--start`, replace total, `--base` preserva só saldos) e incremental (`--window-months N`, busca só os últimos N meses e funde transações por id no `--base` — para run 1x/dia, ~7 chamadas de API). A saída (`gimbo.db`) continua em `data/` por padrão (default de `--out`), mesmo o script morando em `scripts/`. Documentação completa em `ARCHITECTURE.md` → "Ferramenta de Benchmark: Sync Organizze → Gimbo".

> **Armadilha recorrente:** todo bump de schema físico do app exige atualizar o `SCHEMA_DDL` e o
> `PRAGMA user_version` do `sync_gimbo.py` **junto**. Senão o `runMigrations()` do app pula o
> `ALTER TABLE` ao importar o `.db` gerado. Já aconteceu em M-51 e M-64 — e vai voltar no CS-04.

> **Limitação conhecida (2026-08-12, F-30):** Caixinhas e a receita Quadrantes não têm equivalente
> no Organizze, então `sync_gimbo.py` nunca as popula — `budgets`/`transaction_budgets` saem
> sempre vazias e `settings.quadrantes_enabled` sai sempre `0` (o `DEFAULT` da coluna), **mesmo
> em modo incremental com `--base`** — `read_base_data()` não lê a tabela `settings`, então o
> toggle e as caixinhas do `--base` nunca são carregados de volta. Mesmo padrão que
> `audit_log_retention_limit` já tinha (sempre hardcoded, nunca preservado do `--base`), não é
> regressão da F-30. Como a importação em Configurações → Dados é **replace total**, rodar este
> script e importar o `.db` resultante **apaga qualquer caixinha criada manualmente no app e
> desliga a receita Quadrantes se estiver ligada**. Se algum dia isso virar problema real (ex.:
> sync incremental 1x/dia rodando junto de uso ativo de Caixinhas), a correção é estender
> `read_base_data`/`write_db` para preservar `budgets` e `quadrantes_enabled` do `--base`, no
> mesmo espírito de como `balance`/`include_in_balance`/`archived` já são preservados por id —
> ainda não implementado, decisão de produto em aberto.
