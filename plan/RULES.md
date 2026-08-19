# Workflow de Desenvolvimento com IA — Guia Replicável

---

## Princípios fundamentais

Antes das práticas: três princípios que orientam tudo abaixo.

1. **O CI é o árbitro** — se passa no pipeline, está pronto. Opinião humana e opinião da IA ficam subordinadas ao que o CI aceita.
2. **IA executa, humano aprova** — a IA propõe e implementa, o humano decide o que entra. Nunca o contrário.
3. **Documentação ativa, não passiva** — os arquivos markdown do projeto (`BACKLOG.md`, `PRD.md`) são atualizados a cada ciclo, não depois que tudo está pronto.

---

## Estrutura de arquivos do projeto

```
raiz/
├── .github/
│   └── workflows/
│       ├── ci.yml          # pipeline principal (todo push/PR)
│       └── audit.yml       # auditoria semanal de dependências
├── plan/
│   ├── PRD.md              # requisitos e decisões de produto
│   ├── SPEC.md             # especificação técnica
│   └── BACKLOG.md          # bugs e melhorias priorizados
├── app/                    # código da aplicação
│   ├── src/
│   ├── e2e/
│   └── src/test/
└── CLAUDE.md               # instruções permanentes para a IA
```

**Regra:** `plan/` é o cérebro do projeto. Tudo que a IA e o humano precisam saber para tomar decisões está lá.

---

## Fases do SDLC

### Fase 0 — Bootstrap (uma vez por projeto)

**O que fazer:**
- Scaffold da aplicação + git init + primeiro commit
- CI configurado **antes** de qualquer feature
- Qualidade configurada **antes** de qualquer feature: lint, formatter, testes, E2E

**Por que antes:** uma vez que código ruim existe, há resistência psicológica para corrigir. Comece com as restrições e o código vai nascer dentro delas.

**Artefatos produzidos:**
- `CLAUDE.md` com stack, convenções e restrições do projeto
- `plan/PRD.md` com objetivos, usuário-alvo e não-objetivos
- Pipeline CI verde (mesmo que sem testes ainda)

---

### Fase 1 — Feature loop (repetido para cada entrega)

```
┌─────────────┐
│  1. Planejar │  humano + IA definem escopo no PRD/SPEC
└──────┬──────┘
       │
┌──────▼──────┐
│ 2. Implementar│  IA escreve código, humano revisa diff
└──────┬──────┘
       │
┌──────▼──────┐
│  3. Testar  │  IA escreve testes, CI valida
└──────┬──────┘
       │
┌──────▼──────┐
│  4. Commitar │  mensagem contempla o "porquê", não o "o quê"
└──────┬──────┘
       │
┌──────▼──────┐
│  5. Atualizar│  BACKLOG.md fechado/aberto, PRD atualizado
│  documentação│
└─────────────┘
```

**Regras do loop:**
- **Uma branch por tópico** (`dassan/<tópico>`) — agrupa todo um esforço relacionado e pode acumular
  vários itens do backlog antes de virar PR. Revisado em 2026-08-19; a regra anterior era "uma
  feature por PR". Nesta fase de construção, um tópico (segurança, mobile, sync) rende uma série de
  itens pequenos e interdependentes que sai mais barato revisar juntos. Ver `CLAUDE.md` → Git.
- **Um item do backlog por commit** — é o commit que carrega o ID e o "porquê"; é ele que dá
  rollback e histórico legível
- **CI verde antes de merge** — sem exceções
- **Nenhum `TODO` no código** — vai para o `BACKLOG.md`

---

### Fase 2 — Ciclo de qualidade (obrigatório a cada feature)

Executar **antes de cada commit**, sem exceção. O pipeline CI replica exatamente estes comandos — se passam localmente, passam no CI:

| Ordem | Check | Comando | O que buscar |
|---|---|---|---|
| 1 | Formatação | `npm run format:check` | Qualquer arquivo fora do padrão Prettier |
| 2 | Lint | `npm run lint` | Zero erros; warnings devem ser corrigidos ou suprimidos com justificativa |
| 3 | Tipos | `npx tsc -b --noEmit` | Zero erros de tipo |
| 4 | Testes unitários | `npx vitest run --coverage` | Arquivos críticos abaixo do threshold de 80% |
| 5 | E2E | `npx playwright test` | Fluxos críticos quebrados silenciosamente |

Adicionalmente, a cada 3–5 features ou antes de uma entrega importante:

| Check | Comando | O que buscar |
|---|---|---|
| Dependências | `npm audit` | Vulnerabilidades high/critical |
| Bundle size | `npm run build` | Crescimento inesperado |

**Regra:** warnings não são inofensivos — eles anestesiam. Se uma regra gera warnings que ninguém vai corrigir, mude para `off`. Se é importante, mude para `error`.

---

### Fase 3 — Gestão do backlog (contínua)

**Estrutura do `BACKLOG.md`:**

```markdown
## Bugs

| ID   | Descrição | Severidade | Status |
|------|-----------|------------|--------|
| B-01 | ...       | alta       | aberto |

## Melhorias

| ID   | Descrição | Impacto | Esforço | Status |
|------|-----------|---------|---------|--------|
| M-01 | ...       | alto    | médio   | aberto |
```

**Regras de classificação:**
- **Bug** = comportamento diferente do esperado. Sempre tem ID `B-XX`.
- **Melhoria** = comportamento correto, mas pode ser melhor. Sempre tem ID `M-XX`.
- **Severidade de bug:** crítica (quebra funcionalidade principal) / alta (funcionalidade prejudicada) / baixa (cosmético)
- **Impacto/Esforço de melhoria:** alto/médio/baixo — priorize alto impacto + baixo esforço

---

## Práticas específicas para trabalho com IA

### Sessão de trabalho

**Início de sessão:**
1. IA lê `CLAUDE.md`, `plan/PRD.md` e `plan/BACKLOG.md`
2. IA lê os arquivos relevantes para a tarefa antes de propor qualquer mudança
3. Humano define o escopo da sessão (1–3 itens do backlog, no máximo)

**Durante a sessão:**
- IA implementa em etapas verificáveis, não em big bangs
- Humano valida cada etapa antes de prosseguir
- CI falhou? A sessão para e conserta. Não acumula dívida de pipeline.

**Fim de sessão:**
- Commit com mensagem descritiva
- `BACKLOG.md` atualizado (fechar o que foi resolvido, abrir o que foi descoberto)
- Push — o CI confirma que o estado é válido

### Divisão de responsabilidades

| Responsabilidade | Humano | IA |
|---|---|---|
| Decidir o que construir | ✓ | — |
| Decidir como construir | Aprova | Propõe |
| Escrever código | Revisa | Escreve |
| Escrever testes | Revisa | Escreve |
| Detectar bugs | Reporta | Diagnostica |
| Corrigir bugs | Aprova | Corrige |
| Atualizar documentação | Valida | Atualiza |

### Múltiplas IAs no mesmo projeto

Quando usar mais de uma IA (Claude + Gemini, por exemplo):

- **`CLAUDE.md`** define as regras do projeto — qualquer IA que leia esse arquivo opera com o mesmo contexto
- **O CI é o árbitro neutro** — código de qualquer IA passa pelo mesmo pipeline
- **Nunca misture código de duas IAs no mesmo PR** — impossibilita rastreamento de problemas
- **Uma IA por contexto:** use a mais forte para arquitetura e implementação crítica, a outra para revisão, testes ou geração de dados

---

## `CLAUDE.md` — template mínimo

```markdown
# [Nome do Projeto]

## Stack
- [tecnologias principais]

## Convenções
- [padrões de código, nomenclatura, estrutura de arquivos]

## Restrições
- [o que NUNCA fazer: deps proibidas, padrões evitados, etc.]

## Qualidade
- Lint: `npm run lint` — zero erros permitidos
- Format: `npm run format:check`
- Testes: `npx vitest run --coverage` — threshold XX%
- E2E: `npx playwright test`
- CI verde é obrigatório antes de qualquer merge

## Contexto do projeto
- [decisões de arquitetura relevantes e por que foram tomadas]
```

---

## Sinais de que o workflow está funcionando

- CI fica verde consistentemente — falhas são exceção, não rotina
- `BACKLOG.md` cresce e encolhe — itens entram e saem, não só acumulam
- Commits têm mensagens que explicam o *porquê*
- Nenhuma surpresa em produção — os E2E cobrem os fluxos críticos
- Qualquer IA nova que entrar no projeto consegue trabalhar sem briefing verbal — o `CLAUDE.md` e o `plan/` são suficientes

## Sinais de que algo saiu dos trilhos

- CI com falhas ignoradas por mais de 1 dia
- `BACKLOG.md` nunca atualizado
- Commits com mensagens como "fix", "ajuste", "wip"
- Testes escritos depois do código estar "pronto"
- IA implementando sem o humano ter definido o escopo
