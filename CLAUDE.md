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
| Requisitos de produto | `plan/PRD.md` | Features F-1 a F-29, critérios de aceite |
| Backlog | `plan/BACKLOG.md` | Bugs (B-XX), melhorias (M-XX), cartão (CC-XX), relatórios (R-XX), backup (BK-XX), sync (CS-XX) |
| Especificação técnica | `plan/SPEC.md` | Tasks de implementação por fase (TASK-XX); Fase 16 = sync multi-dispositivo |
| Cartão de crédito | `plan/CREDIT_CARD.md` | Decisões de produto e desafios técnicos do módulo CC |
| Cenários de sync | `plan/SYNC_SCENARIOS.md` | 20 cenários: SQLite atual (S-01..07), multi-desktop por pasta (S-16..20), nuvem (S-08..15) |
| Brainstorm de sync | `plan/FABLE-BRAINSTORM.md` | Análise das 7 alternativas de sync multi-dispositivo, matriz de trade-offs, roadmap faseado e decisões |
| Histórico de storage | `plan/STORAGE.md` | Decisão e migração JSON/FSA → SQLite/OPFS |
| Telemetria e bug report | `plan/METRICS.md` | Decisões de privacidade, arquitetura do F-26 (Bug Report System), tasks TASK-BR-01 a BR-08 |
| Relatórios avançados | `plan/REPORTS.md` | Épico do módulo analítico (5 views) |
| Saúde Financeira | `plan/FINANCIAL_HEALTH.md` | Decisões de produto/design da tela `/health` (F-29), conceitos, fórmulas e pontos em aberto |
| Caixinhas (budgets) | `plan/BUDGETS.md` | Protótipo visual de `/budgets` (F-30): anatomia, decisões tomadas e pendências P/U/T a revisar |
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
Referência obrigatória ao ID (M-XX, B-XX, CC-XX, R-XX, BK-XX, HE-XX, CS-XX, MB-XX) quando aplicável.
Uma feature por commit/PR. CI verde obrigatório. Nenhum `TODO` no código.

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

## Estado Atual (2026-07-25)

**Schema em memória v14** | **Schema físico SQLite v10** (`migrations/v1..v10.sql`) | Cobertura: ~97% statements
**754 testes unitários** (29 arquivos) + **23 testes E2E** (5 specs, perfis `chromium` e `mobile-chrome`)

> Os dois números de schema são independentes e **não coincidem**: `CURRENT_SCHEMA_VERSION` (v14,
> em `lib/storage/schema.ts`) versiona o `DataFile` em memória; `PRAGMA user_version` (v10)
> versiona o DDL físico. Bumps de campos opcionais não exigem DDL novo — por isso o schema em
> memória está à frente. O bump v12→v13 (`updatedAt` em `Account`/`Category`/`Tag`/`Transaction`,
> CS-04) e o bump v13→v14 (`createdAt` em `Transaction`, B-24) são casos extremos desse padrão: as
> colunas `updated_at`/`created_at` já existiam fisicamente desde `v1.sql` (só não eram lidas ou
> eram sempre sobrescritas com um valor constante, no caso de `created_at`), então nenhum dos dois
> precisou de `.sql` novo.

Todas as features do PRD (F-1 a F-29, com F-28 no Nível 1) implementadas. Módulo de Cartão de Crédito completo (CC-01 a CC-34 — CC-34 resolvido junto do M-64, via `created_at` do Organizze como chave de agrupamento). Melhorias M-01 a M-64 resolvidas (M-61 parcial — 4 vulnerabilidades altas via `esbuild`/`vite` do `vitest`, exigem bump major); M-65 registrado como futuro. Relatórios avançados R-01 a R-18 resolvidos.

Features concluídas desde 2026-05-27:
- **F-24** — Patrimônio Líquido: `/net-worth`, stat cards, breakdown por conta, gráfico AreaChart (NW-01 a NW-07)
- **F-25** — Demo Mode: `lib/demo.ts`, dados sintéticos, banner, deploy Vercel (DM-01 a DM-05)
- **F-26** — Bug Report System: `lib/telemetry.ts`, `BugReportDialog`, ErrorBoundary, Settings (TASK-BR-01 a BR-08)
- **F-27** — Mobile PWA: bottom nav, layouts responsivos, bottom sheet, manifest standalone, E2E mobile (MB-01 a MB-07; MB-08 aberto — Analytics responsivo)
- **F-28 Nível 1** — Backup Local: `lib/backupDir.ts`, aba "Backup & Sync", auto-backup, `WelcomeModal`, doc pages, sync manual (BK-01 a BK-03, BK-05 a BK-08; BK-04 aberto — banner de re-permissão)
- **F-29** — Saúde Financeira: tela `/health` **completa**, incluindo Reserva de Emergência (HE-01 a HE-16 resolvidos: entidade `LOAN`, motor de dívida total/comprometido/horizonte, renda híbrida com override editável, custo mensal médio, saldo de reserva por conta marcada, meta em meses configurável, detalhamento expansível real por cartão/`LOAN`/empréstimo em conta comum). Ver `plan/FINANCIAL_HEALTH.md` §6-8.
- **R-17/R-18** — View "Faturas" em Analytics: `FaturasView.tsx`, aba 5 na sub-nav, 14 testes unitários
- **B-16/M-22** — Ciclo de fatura de cartão (Opção 2): pagamento vinculado ao período (`referenceMonth`, schema v4→v5), `CREDIT_PAYMENT` debita a conta pagadora, fatura líquida de créditos + selo de status (aberta/parcial/paga), estornos como `INCOME` na conta CREDIT; sync preserva sinal e infere `referenceMonth`
- **M-62/B-22** — Camada de projeção de 10 anos no Fluxo de Caixa (Relatórios) + janela rolante de recorrências sem `endDate`
- **M-64/CC-34** — `Installment.purchaseDate` (data de compra original em todas as parcelas, schema v10→v11) + correção definitiva do agrupamento de parcelas no sync do Organizze via `created_at` como chave de série

Itens em aberto:
- **F-30 — Caixinhas (budgets):** existe apenas como **protótipo visual mockado** na branch
  `dassan/caixinhas` (rotas `/budgets` e `/budgets/:budgetId`, dados em `pages/Budgets/mock.ts`).
  Nenhuma entidade no `DataFile`, nenhuma mutação, nenhum teste. **Sete decisões de produto (P-1 a
  P-7) ainda dependem do humano** — em especial como o lançamento entra na caixinha, se existe
  caixinha recorrente e como parcelas de cartão contam. Não implementar a camada de dados antes
  dessas respostas: ver `plan/BUDGETS.md` §6.
- **MB-08** — Analytics responsivo para mobile (média prioridade)
- **BK-04** — Banner de re-permissão da pasta de backup no startup (média prioridade)
- **M-63b** — Gráfico de tendência (passado real + futuro projetado) no Patrimônio Líquido (baixa; a fatia de Saúde Financeira do M-63 já foi resolvida)
- **M-61** — 4 vulnerabilidades altas via `esbuild`/`vite` do `vitest`; exigem bump major do `vitest` (parcial)
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

Ferramentas de desenvolvimento (2026-06-08, atualizado em 2026-07-24):
- **Sync Organizze → Gimbo** (`data/sync_gimbo.py`): script de benchmark que lê a API do Organizze por demanda e gera um `gimbo.db` (`PRAGMA user_version = 9`) para importar. IDs determinísticos (`uuid5`), saldos iniciais zerados (preenchidos à mão), janela `--start`/`--end` (com `--end` futuro para lançamentos não pagos). **Dois modos**: snapshot (`--start`, replace total, `--base` preserva só saldos) e incremental (`--window-months N`, busca só os últimos N meses e funde transações por id no `--base` — para run 1x/dia, ~7 chamadas de API). Documentação completa em `ARCHITECTURE.md` → "Ferramenta de Benchmark: Sync Organizze → Gimbo".

> **Armadilha recorrente:** todo bump de schema físico do app exige atualizar o `SCHEMA_DDL` e o
> `PRAGMA user_version` do `sync_gimbo.py` **junto**. Senão o `runMigrations()` do app pula o
> `ALTER TABLE` ao importar o `.db` gerado. Já aconteceu em M-51 e M-64 — e vai voltar no CS-04.
