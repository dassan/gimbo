# Gimbo

> Gestão de finanças pessoais — 100% local, zero dependência de nuvem.

Gimbo é um **PWA local-first** que roda inteiramente no navegador. Seu histórico financeiro vive
num banco SQLite local (via WebAssembly + Origin Private File System), com export/import de um
arquivo de backup `.db` portátil a um clique. Sem contas, sem servidores, sem assinatura.

<img width="1858" height="959" alt="gimbo-dashboard" src="https://github.com/user-attachments/assets/a4ef1e12-d4ba-45af-bb19-14cb0069a1b9" />

---

## Por que o Gimbo

A maioria das ferramentas de finanças troca sua privacidade por conveniência — guardando seu
histórico de transações em servidores corporativos e monetizando seu padrão de consumo. O Gimbo
rejeita esse modelo:

- **Local-first:** todo o dado fica no seu dispositivo, num banco SQLite local — nada é enviado a lugar nenhum
- **Portátil:** exporte um único arquivo de backup `.db` e importe em qualquer outro dispositivo/navegador para continuar de onde parou
- **Backup automático opcional:** aponte o Gimbo para uma pasta em disco (ex.: uma sincronizada pelo Google Drive/Dropbox/OneDrive) e ele grava um backup lá a cada mudança
- **Sync opcional via nuvem própria:** conecte sua própria conta do Google Drive (OAuth2) para sincronizar entre dispositivos sem servidor do Gimbo no meio — o app só lê/escreve um arquivo `.db` na sua conta
- **Funciona offline:** instalado como PWA, funciona sem conexão
- **Sem aprisionamento:** exporte seus dados a qualquer momento como um arquivo SQLite portátil

---

## Funcionalidades

- **Lançamentos** — receitas, despesas, transferências e pagamento de fatura, com categorias hierárquicas, tags, parcelamento e recorrência
- **Dashboard** — resumo do mês, saldo por conta, utilização dos cartões, donut de despesas por categoria, últimos lançamentos
- **Cartões de crédito** — motor de fatura virtual (fechamento/vencimento, saldo em aberto, limite disponível), página dedicada por cartão com histórico de faturas
- **Relatórios avançados** — 5 visões analíticas: Categorias, Fluxo de Caixa (projeção ±3 meses), Contas, Tags e Faturas
- **Patrimônio Líquido** — ativos menos passivos, com breakdown por conta e evolução histórica
- **Saúde Financeira** — dívida total comprometida, peso no orçamento em relação à renda, reserva de emergência recomendada
- **Caixinhas** — metas financeiras declaradas (viagem, reforma, teto de gasto mensal), com receita automática opcional "Quadrantes" que gera 4 caixinhas por mês
- **Backup & Sync em 3 níveis** — só o navegador (OPFS), pasta local com escrita automática (File System Access API), ou sync multi-dispositivo via Google Drive (OAuth2, sem servidor do Gimbo)
- **PWA responsiva** — instalável em desktop e mobile, mesma base de código, navegação adaptada para telas pequenas
- **Reporte de bugs integrado** — snapshot seguro de contexto (nunca valores financeiros, nomes ou IDs de entidades) anexado a um link pré-preenchido do GitHub Issues

---

## Experimente

Um **modo demo** com dados sintéticos e persistência desabilitada está disponível — útil para
explorar a interface sem criar um cofre de verdade. Rode com `VITE_DEMO_MODE=true` (veja
[Como rodar localmente](#como-rodar-localmente)).

---

## Como rodar localmente

> **Pré-requisitos:** Node.js 22 e npm.

```bash
# 1. Clone o repositório
git clone git@github.com:dassan/gimbo.git
cd gimbo/app

# 2. Instale as dependências
npm install --legacy-peer-deps

# 3. Suba o servidor de desenvolvimento
npm run dev
```

Abra [http://localhost:5173](http://localhost:5173) — a tela de Onboarding vai guiar você na
criação do primeiro cofre ou na importação de um backup `.db` existente.

### Modo demo

```bash
VITE_DEMO_MODE=true npm run dev
```

Carrega um dataset sintético na inicialização e desabilita a persistência — toda mutação vira
no-op, então dá pra clicar à vontade. Um banner amarelo indica que o modo demo está ativo.

### Helpers de desenvolvimento (apenas em dev)

Dois query parameters funcionam ao rodar `npm run dev` (viram no-op em builds de produção):

| URL | Efeito |
|-----|--------|
| `http://localhost:5173/?devSeed` | Apaga o banco local e carrega o dataset sintético de seed (`public/dev/seed.json`). Cai no dashboard. |
| `http://localhost:5173/?devReset` | Apaga o banco local, limpa as preferências de workspace e qualquer pasta de backup configurada, e redireciona para o Onboarding. |

Depois da ação, o parâmetro é removido da URL via `history.replaceState`.

### Reportar problemas

Achou um bug ou tem uma sugestão? Abra uma issue no GitHub:

**[github.com/dassan/gimbo/issues](https://github.com/dassan/gimbo/issues)**

O app também tem um diálogo de **reporte de bugs** embutido (Configurações → Preferências) que
anexa um snapshot seguro — navegação recente, tipos de ação e stack traces de erro, **nunca**
valores financeiros, nomes ou IDs de entidades — e abre uma issue pré-preenchida no GitHub.

### Build de produção

```bash
npm run build      # gera em app/dist/
npm run preview    # serve o build de produção localmente
```

A pasta `dist/` é um PWA totalmente estático — sirva a partir de qualquer host estático (GitHub
Pages, Cloudflare Pages, Netlify, Vercel) ou abra `index.html` diretamente num navegador moderno.

---

## Compatibilidade de navegadores

| Funcionalidade | Chrome / Edge | Firefox | Safari |
|---|:---:|:---:|:---:|
| App principal (SQLite via OPFS) | ✅ | ✅ | ✅ |
| Instalação como PWA | ✅ | ✅ | ✅ |
| Backup automático em pasta local (File System Access API) | ✅ | ❌ | ❌ |
| Sync via Google Drive (OAuth2) | ✅ | ✅ | ✅ |

O app guarda o banco no **Origin Private File System (OPFS)** do navegador, disponível em todos os
navegadores modernos — sem permissões especiais.

A opção **"Backup & Sync → pasta local"** (Configurações) usa a **File System Access API** para
escrever um backup na pasta escolhida a cada mudança de dado. Essa API é exclusiva de Chrome/Edge;
no Firefox e Safari essa opção fica oculta e o backup manual via **Exportar** (Configurações →
Dados) continua disponível. Já o sync via **Google Drive** não depende dessa API — funciona em
qualquer navegador com suporte a OAuth2/fetch.

---

## Contribuindo

### Stack tecnológico

| Camada | Tecnologia | Versão |
|---|---|---|
| Framework | React | 19.x |
| Roteamento | React Router | 7.x |
| Build | Vite | 8.x |
| Linguagem | TypeScript (strict) | 6.x |
| Estilo | Tailwind CSS | 4.x |
| Estado | Zustand | 5.x |
| Validação | Zod | 4.x |
| Banco de dados | SQLite via `wa-sqlite` (WASM) + OPFS | 1.x |
| Gráficos | Recharts | 3.x |
| i18n | i18next + react-i18next | 26.x / 17.x |
| PWA | vite-plugin-pwa | 1.x |
| Ícones | Lucide React | 1.x |
| Testes unitários | Vitest + Testing Library | 3.x / 16.x |
| Testes E2E | Playwright | 1.x (Chromium desktop + mobile) |
| Lint | ESLint (flat config) | 9.x |
| Formatter | Prettier | 3.x |
| Deploy | Cloudflare Pages (via `wrangler`) | 4.x |

**Node.js 22** é requerido (mesma versão do CI).

### Estrutura do projeto

```
gimbo/
├── .github/
│   └── workflows/
│       ├── ci.yml          # type-check → lint → format → testes unitários → build → E2E
│       └── audit.yml       # auditoria semanal de dependências
├── plan/
│   ├── PRD.md              # Requisitos de produto (features F-1 a F-30)
│   ├── ARCHITECTURE.md     # Stack, modelo de dados, arquitetura de persistência
│   ├── BACKLOG.md          # Bugs (B-XX), melhorias (M-XX), cartão (CC-XX), relatórios (R-XX), backup (BK-XX), sync (CS-XX), caixinhas (BX-XX)
│   ├── REPORTS.md          # Épico do módulo analítico (Categorias/CashFlow/Contas/Tags/Faturas)
│   ├── CREDIT_CARD.md      # Decisões e arquitetura do módulo de cartão de crédito
│   ├── FINANCIAL_HEALTH.md # Decisões de produto da tela de Saúde Financeira
│   ├── BUDGETS.md          # Decisões de produto/UX das Caixinhas
│   ├── METRICS.md          # Telemetria local e Bug Report System
│   ├── SYNC_SCENARIOS.md   # Cenários de sincronização e recuperação
│   └── RULES.md            # Workflow de desenvolvimento IA + humano
├── design/
│   ├── DESIGN.md            # Sistema de design "Fluid Ledger" (fonte única)
│   └── *.png                # Mockups de telas
└── app/
    ├── src/
    │   ├── App.tsx              # Startup, hidratação, route guard, error boundary
    │   ├── types/index.ts        # Todas as entidades TypeScript
    │   ├── lib/
    │   │   ├── utils.ts            # cn(), formatCurrency(), parseDateLocal(), motor de fatura virtual
    │   │   ├── backupDir.ts        # Backup em pasta local via File System Access API
    │   │   ├── budgetRecipes.ts    # Receita "Quadrantes" das Caixinhas
    │   │   ├── cloudSync/          # Merge multi-dispositivo, Google Drive, pasta compartilhada
    │   │   ├── demo.ts             # Flag de modo demo + carregador de dados sintéticos
    │   │   ├── telemetry.ts        # Ring buffer de eventos + snapshot de bug report
    │   │   └── i18n/                # Config i18next + locales pt-BR / en-US
    │   ├── services/storage/
    │   │   ├── StorageService.ts   # API tipada usada pelo app (thread principal)
    │   │   ├── worker.ts           # Web Worker: wa-sqlite + OPFS, roda as migrações
    │   │   └── migrations/*.sql    # Schema físico incremental do SQLite
    │   ├── store/
    │   │   ├── useDataStore.ts         # Dados do cofre + mutações + persistência debounced
    │   │   └── useWorkspaceStore.ts    # Preferências de UI (tema, idioma, ordenação, shadows)
    │   ├── components/
    │   │   ├── AppLayout.tsx           # Shell: Navbar + Outlet + FAB + drawers + banners
    │   │   ├── TransactionDrawer.tsx    # Formulário de criação/edição de lançamento
    │   │   ├── WelcomeModal.tsx         # Explicador de privacidade e backup no primeiro uso
    │   │   ├── BugReportDialog.tsx      # Reporte opt-in com snapshot de telemetria
    │   │   └── ErrorBoundary.tsx        # Captura erros de render, oferece reporte
    │   ├── pages/
    │   │   ├── Onboarding/      # Criar novo cofre ou importar backup .db
    │   │   ├── Dashboard/       # Resumo mensal, contas, cartões, donut, lançamentos recentes
    │   │   ├── Transactions/    # Extrato de caixa (exclui cobranças de cartão)
    │   │   ├── Analytics/       # 5 abas: Categorias, CashFlow, Contas, Tags, Faturas
    │   │   ├── CreditCard/      # Detalhe de fatura de um cartão
    │   │   ├── NetWorth/        # Patrimônio líquido, com histórico de avaliação
    │   │   ├── Health/          # Saúde financeira: dívida, comprometimento, reserva
    │   │   ├── Budgets/         # Caixinhas: lista, detalhe, receita Quadrantes
    │   │   ├── Settings/        # Contas e Cartões, Categorias, Tags, Perfil, Preferências, Backup & Sync, Histórico
    │   │   ├── Docs/            # Páginas estáticas de ajuda (storage local, backup, sync via nuvem)
    │   │   └── Legal/           # Política de privacidade, termos de uso
    │   └── test/                # fixtures, testes de lib/store/componentes
    └── e2e/                     # Specs E2E do Playwright
```

### Modelo de dados

O cofre é persistido num banco SQLite local (uma tabela por entidade), também representado em
memória como um `DataFile` validado com Zod. Entidades principais: `accounts`, `categories`,
`tags`, `transactions`, `valuations`, `budgets`, `auditLog`. O schema evolui de forma aditiva e
idempotente — cada versão migra automaticamente a anterior. Modelo completo, decisões de
arquitetura e o motor de fatura virtual estão documentados em [`plan/ARCHITECTURE.md`](plan/ARCHITECTURE.md).

### Quality gates

Rode todas as checagens antes de abrir um PR — o CI executa os mesmos comandos, na mesma ordem:

```bash
cd app

npx tsc -b --noEmit          # TypeScript strict
npm run lint                  # ESLint
npm run format:check          # Prettier
npx vitest run --coverage     # testes unitários
npm run build                 # build de produção
npx playwright test           # testes E2E — desktop + mobile Chromium
```

Cobertura atual: **~96% statements** (testes unitários). Os testes E2E cobrem os fluxos principais
de onboarding, lançamentos, cartão de crédito, caixinhas, persistência e navegação mobile.

### Convenção de commits

```
<tipo>: <descrição imperativa em minúsculas>
```

| Tipo | Uso |
|---|---|
| `feat:` | Nova funcionalidade |
| `fix:` | Correção de bug |
| `test:` | Só testes |
| `style:` | Formatação (sem mudança de lógica) |
| `refactor:` | Refatoração sem mudança de comportamento |
| `docs:` | Documentação |
| `chore:` | Config, CI, dependências |

Referencie o ID relevante quando aplicável: `feat: M-54 barra colapsável de filtro de categoria`.
IDs são rastreados em [`plan/BACKLOG.md`](plan/BACKLOG.md) (`M-XX` melhorias, `B-XX` bugs, `CC-XX`
cartão de crédito, `R-XX` relatórios, `BK-XX`/`CS-XX` backup e sync, `BX-XX` caixinhas).

### Regras de desenvolvimento (resumo)

- **O CI é o árbitro** — pipeline verde = pronto; pipeline vermelho = sessão para
- **Ler antes de propor** — nunca sugerir mudanças em arquivos não lidos
- **Sem `TODO` no código** — vira entrada em `BACKLOG.md`
- **Uma feature por PR** — mantém review e rollback simples
- **Sem `console.log` em código de produção**
- Bugs e melhorias são rastreados em [`plan/BACKLOG.md`](plan/BACKLOG.md)
- Workflow completo documentado em [`plan/RULES.md`](plan/RULES.md)

---

## Roadmap

O release atual é completo para uso em **múltiplos dispositivos** — desktop e mobile, com sync
opcional via nuvem própria (Google Drive) ou pasta local compartilhada, sem servidor do Gimbo em
nenhum ponto do fluxo.

Planejado a seguir:

- **Dropbox** como segundo provedor de sync via nuvem, ao lado do Google Drive
- **Analytics responsivo no mobile** — só a aba Categorias tem versão mobile por ora; Fluxo de Caixa, Contas, Tags e Faturas ainda não

Fora de escopo para o ciclo atual:

- Open Banking / importação bancária automatizada
- App mobile nativo (iOS/Android) — a estratégia mobile é PWA responsiva
- Estornos além do modelo de reembolso de cartão já existente

---

## Licença

MIT — ver [`LICENSE`](LICENSE).

O app publicado embute código de terceiros cujas licenças exigem que o aviso de copyright acompanhe a redistribuição. As atribuições estão em [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) — todas permissivas (MIT, ISC, SIL OFL 1.1), nenhuma GPL/AGPL/SSPL.
