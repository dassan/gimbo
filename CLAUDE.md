# Gimbo — CLAUDE.md

> Instruções permanentes para qualquer IA que trabalhe neste projeto.
> Leia este arquivo integralmente antes de propor ou implementar qualquer coisa.
> Em caso de conflito entre este arquivo e instruções verbais da sessão, questione antes de agir.

---

## Identidade do Projeto

**Gimbo** — app web de finanças pessoais **local-first**, instalável como PWA.
Toda a informação reside em um `data.json` controlado pelo usuário, sem servidor, sem nuvem.
Workflow de desenvolvimento IA + humano definido em `plan/RULES.md`.

---

## Documentação Técnica

| Documento | Caminho | Conteúdo |
|-----------|---------|---------|
| Arquitetura | `plan/ARCHITECTURE.md` | Stack, estrutura de diretórios, modelo de dados, APIs, fluxos de persistência, testes |
| Requisitos de produto | `plan/PRD.md` | Features F-1 a F-26, critérios de aceite |
| Backlog | `plan/BACKLOG.md` | Bugs (B-XX), melhorias (M-XX), relatórios (R-XX) com status |
| Cartão de crédito | `plan/CREDIT_CARD.md` | Decisões de produto e desafios técnicos do módulo CC |
| Cenários de sync | `plan/SYNC_SCENARIOS.md` | 14 cenários de sincronização e recuperação |
| Telemetria e bug report | `plan/METRICS.md` | Decisões de privacidade, arquitetura do F-26 (Bug Report System), tasks TASK-BR-01 a BR-08 |
| Relatórios avançados | `plan/REPORTS.md` | Épico do módulo analítico (4 views) |
| Sistema de design | `design/DESIGN.md` | Cores, tipografia, espaçamento, sombras, componentes (fonte única) |
| Workflow | `plan/RULES.md` | SDLC, cerimônias, divisão de responsabilidades |

---

## Padrões Críticos

### Parsing de datas — `parseDateLocal()`
Toda comparação de `tx.date` com mês/ano deve usar `parseDateLocal()` de `@/lib/utils`.
Nunca `new Date(tx.date)` para `.getMonth()`/`.getFullYear()` — causa bugs de fuso UTC.

### Saldo de conta — derivado de transações
O campo `Account.balance` representa o **saldo inicial** (editável no modal). O saldo exibido é
`balance + INCOME − EXPENSE − TRANSFER` (via `useMemo`). Contas CREDIT usam
`creditMetadata.limit − getCurrentInvoiceBalance()`. Nunca exibir `acc.balance` diretamente.

### Motor de fatura virtual
Quatro funções puras em `lib/utils.ts`: `getInvoicePeriod`, `getInvoiceDueDate`,
`getCurrentInvoiceBalance`, `getEffectiveCashFlowDate`. Regra: `getEffectiveCashFlowDate`
apenas no gráfico de fluxo de caixa; categorias usam `tx.date`; `CREDIT_PAYMENT` excluído de totais.

### Tradução de tipos de conta
Sempre `t(\`accounts.${type.toLowerCase()}\`)`. Nunca exibir enum bruto.

### Dois caminhos de persistência
- `importFileToIdb(file)` — onboarding/import (replace total)
- `syncToFile(local, diskSnapshot)` — sync recorrente (merge por UUID)
**Nunca misturar os dois caminhos.**

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
Referência obrigatória ao ID (M-XX, B-XX, CC-XX, R-XX) quando aplicável.
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
- **Nunca** chamar `syncToFile()`/`saveDataFile()` fora de `persist()`
- **Nunca** chamar `importFileToIdb()` no fluxo de sync recorrente
- **Nunca** incrementar `unsyncedCount` manualmente
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
5. Ler os arquivos-fonte relevantes **antes** de propor mudanças
6. Confirmar escopo da sessão com o humano (1–3 itens, no máximo)

---

## Princípios do Workflow

1. **O CI é o árbitro** — se passa no pipeline, está pronto
2. **IA propõe, humano decide** — nunca o contrário
3. **Documentação ativa** — `BACKLOG.md` e `PRD.md` atualizados a cada ciclo
4. **CI falhou? Sessão para.** Não acumula dívida de pipeline
5. **Fim de sessão:** commit descritivo → `BACKLOG.md` atualizado → push

---

## Estado Atual (2026-05-31)

**Schema v2** | Cobertura: ~97% statements

Todas as features do PRD (F-1 a F-28 Nível 1) implementadas. Módulo de Cartão de Crédito completo (CC-01 a CC-30). Melhorias M-01 a M-33 resolvidas. Relatórios avançados R-01 a R-18 resolvidos.

Features concluídas desde 2026-05-27:
- **F-24** — Patrimônio Líquido: `/net-worth`, stat cards, breakdown por conta, gráfico AreaChart (NW-01 a NW-07)
- **F-25** — Demo Mode: `lib/demo.ts`, dados sintéticos, banner, deploy Vercel (DM-01 a DM-05)
- **F-26** — Bug Report System: `lib/telemetry.ts`, `BugReportDialog`, ErrorBoundary, Settings (TASK-BR-01 a BR-08)
- **F-27** — Mobile PWA: bottom nav, layouts responsivos, bottom sheet, manifest standalone, E2E mobile (MB-01 a MB-07)
- **F-28 Nível 1** — Backup Local: `lib/backupDir.ts`, aba "Backup & Sync", auto-backup, `WelcomeModal`, doc pages (BK-01 a BK-03, BK-05 a BK-07)
- **R-17/R-18** — View "Faturas" em Analytics: `FaturasView.tsx`, aba 5 na sub-nav, 14 testes unitários

Itens em aberto:
- **M-22** — Estornos em contas CREDIT (baixa prioridade)
- **MB-08** — Analytics responsivo para mobile (média prioridade)
- **BK-04** — Banner de re-permissão da pasta de backup no startup (média prioridade)
- **F-28 Nível 2** — Cloud Sync Google Drive/Dropbox (CS-01 a CS-12) — demand-driven

Decisões arquiteturais (2026-05-27, mantidas):
- Estratégia mobile = PWA responsiva (não app nativo). X-3 do PRD atualizado.
- Sync multi-dispositivo = Google Drive/Dropbox do usuário como camada de sync (sem servidor Gimbo).
- Política de conflito = merge aditivo; duplicatas offline sobrevivem, usuário remove manualmente.
- `SYNC_SCENARIOS.md` cobre SQLite atual (S-01 a S-07) e sync futuro (S-08 a S-15).
