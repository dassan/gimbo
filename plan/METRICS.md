# Gimbo — Telemetria Local & Sistema de Reporte de Bugs

> Documento de produto e arquitetura gerado a partir do brainstorm de 2026-05-27.
> Registra decisões de privacidade, arquitetura técnica e plano de implementação.
> Feature: **F-26 — Bug Report System**.

---

## 1. Contexto e Decisão de Produto

### O problema original
Explorar métricas de uso (quais features são mais/menos usadas) para informar melhorias de UX.

### Por que analytics tradicional não se encaixa no Gimbo
O Gimbo é um app de finanças pessoais **local-first**: sem servidor, sem nuvem, dados do usuário em arquivo local. Introduzir telemetria automática — mesmo "anonimizada" — quebraria a promessa central do produto. Usuários que instalam um PWA local-first têm expectativa explícita de privacidade; surpresas com transmissão de dados, mesmo inocentes, destroem confiança.

### A decisão
**Não coletar métricas de uso automáticas.** Em vez disso:
- **Analytics local**: dados de comportamento ficam no dispositivo do usuário, nunca transmitidos
- **Bug reporting opt-in**: o usuário aciona o reporte, escolhe o que enviar, e vê exatamente o que será enviado antes de confirmar

---

## 2. Exploração de Alternativas (Registro para Referência Futura)

| Abordagem | Descrição | Veredicto para o Gimbo |
|-----------|-----------|----------------------|
| **Analytics local** | Eventos gravados no dispositivo, nunca transmitidos | ✅ Compatível; limitação: o desenvolvedor não vê nada |
| **Feedback explícito (pull)** | Botão "Reportar problema" com formulário livre | ✅ Adotado como base do F-26 |
| **Telemetria opt-in** | Usuário consente; só contadores de eventos enviados | ⚠️ Possível no futuro, mas requer UI de consentimento robusta |
| **Plausible / Fathom** | Serviços de analytics privacy-focused, sem cookies | ⚠️ Ainda transmite dados a terceiros; fora da proposta local-first |
| **Umami (self-hosted)** | Open-source, controlado pelo desenvolvedor | ⚠️ Exige infraestrutura; desvio da proposta zero-servidor |
| **Google Analytics / Mixpanel** | Analytics tradicionais | ❌ Incompatível com proposta de privacidade |

---

## 3. Feature F-26 — Bug Report System

### 3.1 Descrição
Sistema de reporte de bugs que combina:
1. **Coleta local passiva** — ring buffer em memória de eventos de navegação, ações e erros
2. **Formulário de reporte** — campo livre para o usuário descrever o problema
3. **Snapshot seguro** — metadados do ambiente e do comportamento do app (zero dados financeiros)
4. **Transparência total** — preview expansível do que será enviado antes do envio
5. **Envio opt-in** — o usuário aciona e confirma; nada é transmitido automaticamente

### 3.2 Regra de Ouro de Privacidade do Snapshot

**Seguro incluir:**
| Categoria | Exemplos |
|-----------|----------|
| Ambiente | versão do app, browser + versão, OS, resolução, modo PWA/browser |
| Navegação | sequência de rotas visitadas (`/accounts → /transactions → /settings`) |
| Ações recentes | tipos de evento (`transaction_created`, `account_edited`, `invoice_viewed`) |
| Erros JS | stack trace completo, mensagem de erro |
| Estado estrutural | número de contas, número de transações no período, schema version |
| Performance | tempo de carregamento de páginas, tempo de operações lentas |

**Nunca incluir:**
- Valores monetários, nomes, categorias, datas de transações
- IDs de usuário ou qualquer PII
- Parâmetros de rota que contenham IDs financeiros
- Conteúdo de variáveis que apareçam no stack trace

### 3.3 Fluxo do Usuário

```
[Erro ocorre / usuário percebe problema]
         ↓
[Usuário clica em "Reportar problema" — Settings ou toast de erro]
         ↓
[BugReportDialog abre]
  ┌─ Campo de texto livre: "descreva o que aconteceu"
  ├─ Seção expansível "O que será enviado" (preview do snapshot)
  ├─ Checkboxes para incluir/excluir categorias do snapshot
  └─ Botão "Enviar Relatório"
         ↓
[Link GitHub Issues pré-preenchido abre em nova aba]
         ↓
[Usuário vê e confirma o issue no GitHub antes de submeter]
```

### 3.4 Destino do Reporte — Decisão: GitHub Issues via Link

**Por que GitHub Issues via link pré-preenchido:**
- Zero backend, zero token, zero infra
- Transparência máxima: o usuário vê exatamente o que será postado
- O usuário controla a submissão (tem conta no GitHub ou pode criar)
- URL formato:

```
https://github.com/dassan/MyFinanceApp/issues/new
  ?title=Bug: <título gerado automaticamente>
  &body=<snapshot formatado em Markdown>
  &labels=bug
```

**Alternativas descartadas para MVP:**
| Opção | Motivo da descarte |
|-------|--------------------|
| GitHub Issues API com token | Exige backend ou expor token no front-end |
| Email via `mailto:` | Depende de cliente de e-mail configurado |
| Tally / Typeform | Dados em terceiros |
| Clipboard + instrução | Alta fricção para o usuário |

---

## 4. Arquitetura Técnica

### 4.1 Módulo `lib/telemetry.ts`

Ring buffer em memória (não persiste entre sessões — mais seguro):

```typescript
type SafeEvent =
  | { type: 'navigation'; route: string; ts: number }
  | { type: 'action'; name: string; ts: number }       // ex: 'invoice_viewed'
  | { type: 'error'; message: string; stack: string; route: string; ts: number }
  | { type: 'performance'; metric: string; ms: number; ts: number }

const MAX_EVENTS = 100

const _buffer: SafeEvent[] = []
let _currentRoute = '/'

export function track(event: SafeEvent): void {
  _buffer.push(event)
  if (_buffer.length > MAX_EVENTS) _buffer.shift()
}

export function trackNavigation(route: string): void {
  _currentRoute = route
  track({ type: 'navigation', route, ts: Date.now() })
}

export function trackAction(name: string): void {
  track({ type: 'action', name, ts: Date.now() })
}

export function trackError(error: Error): void {
  track({ type: 'error', message: error.message, stack: error.stack ?? '', route: _currentRoute, ts: Date.now() })
}

export function getSnapshot(): SafeEvent[] {
  return [..._buffer]
}

export function getCurrentRoute(): string {
  return _currentRoute
}
```

**Decisão: ring buffer em memória, não persistido**
Manter eventos apenas na sessão atual evita acumular dados entre sessões e simplifica a política de privacidade.

### 4.2 Hook `useTrackNavigation`

```typescript
// hooks/useTrackNavigation.ts
export function useTrackNavigation(): void {
  const location = useLocation()
  useEffect(() => {
    trackNavigation(location.pathname)
  }, [location.pathname])
}
```

Chamado uma vez no `AppLayout` — captura toda a navegação da sessão automaticamente.

### 4.3 Error Boundary aprimorado

O `ErrorBoundary.tsx` existente será aprimorado para:
1. Chamar `trackError(error)` no `componentDidCatch`
2. Exibir botão "Reportar este problema" no fallback UI

### 4.4 Gerador de Snapshot

```typescript
// lib/telemetry.ts
export function buildBugReportSnapshot(options: SnapshotOptions): BugSnapshot {
  return {
    appVersion: import.meta.env.VITE_APP_VERSION ?? 'unknown',
    schemaVersion: 2,
    browser: navigator.userAgent,
    pwa: window.matchMedia('(display-mode: standalone)').matches,
    resolution: `${screen.width}×${screen.height}`,
    locale: navigator.language,
    recentNavigation: options.includeNavigation
      ? getSnapshot().filter(e => e.type === 'navigation').slice(-10)
      : [],
    recentActions: options.includeActions
      ? getSnapshot().filter(e => e.type === 'action').slice(-20)
      : [],
    recentErrors: options.includeErrors
      ? getSnapshot().filter(e => e.type === 'error')
      : [],
    performance: options.includePerformance
      ? getSnapshot().filter(e => e.type === 'performance')
      : [],
    dataShape: options.includeDataShape
      ? buildDataShape()  // conta entidades sem valores
      : null,
  }
}

// Seguro: só conta entidades, não expõe dados
function buildDataShape(): DataShape {
  const data = useDataStore.getState().data
  if (!data) return null
  return {
    accountCount: data.accounts.length,
    transactionCount: data.transactions.length,
    categoryCount: data.categories.length,
    tagCount: data.tags.length,
    schemaVersion: data.schemaVersion,
    auditLogEntries: data.auditLog.length,
  }
}
```

### 4.5 `BugReportDialog`

Componente React que:
- Recebe `isOpen` e `onClose`
- Gerencia `description: string` (campo livre)
- Gerencia `SnapshotOptions` (checkboxes por categoria)
- Renderiza preview do snapshot em `<pre>` formatado em JSON/Markdown
- Gera e abre a URL do GitHub Issues no `onClick` do CTA

```typescript
interface BugReportDialogProps {
  isOpen: boolean
  onClose: () => void
  prefillTitle?: string    // para o caso do ErrorBoundary passar o título automaticamente
}
```

### 4.6 Ponto de Entrada no AppLayout

Botão discreto "Reportar problema" no rodapé ou em Settings → "Suporte". Estado `bugReportOpen: boolean` controlado pelo `AppLayout`.

---

## 5. Plano de Implementação (Tasks)

| Task | Descrição | Arquivo(s) |
|------|-----------|-----------|
| TASK-BR-01 | `lib/telemetry.ts` — ring buffer, tipos, `track*`, `getSnapshot`, `buildBugReportSnapshot` | `src/lib/telemetry.ts` |
| TASK-BR-02 | `useTrackNavigation` hook + integração no `AppLayout` | `src/hooks/useTrackNavigation.ts`, `AppLayout.tsx` |
| TASK-BR-03 | `trackAction` nos pontos de mutação críticos do store | `src/store/useDataStore.ts` |
| TASK-BR-04 | Aprimorar `ErrorBoundary` — `trackError` + botão "Reportar" | `src/components/ErrorBoundary.tsx` |
| TASK-BR-05 | `BugReportDialog` — formulário, preview, geração de URL GitHub | `src/components/BugReportDialog.tsx` |
| TASK-BR-06 | Integração no `AppLayout` + entrada em Settings | `AppLayout.tsx`, `pages/Settings/` |
| TASK-BR-07 | i18n — chaves `bugReport.*` em pt-BR e en-US | `locales/*.json` |
| TASK-BR-08 | Testes unitários — `telemetry.ts`, `BugReportDialog` | `src/test/lib/telemetry.test.ts`, `src/test/components/BugReportDialog.test.tsx` |

---

## 6. Critérios de Aceitação

```gherkin
Cenário: Usuário reporta um bug após erro de JS
  Dado que uma exceção não tratada é capturada pelo ErrorBoundary
  Quando o usuário clica em "Reportar este problema"
  Então o BugReportDialog abre com o título pré-preenchido
  E o stack trace já está incluído no snapshot
  E o campo de descrição está vazio (aguardando input do usuário)

Cenário: Usuário revisa o snapshot antes de enviar
  Dado que o BugReportDialog está aberto
  Quando o usuário expande a seção "O que será enviado"
  Então ele vê navegação recente, ações recentes e metadados do ambiente
  E não vê nenhum valor monetário, nome de conta ou dado financeiro

Cenário: Usuário opta por não incluir ações recentes
  Dado que o BugReportDialog está aberto
  Quando o usuário desmarca "Incluir ações recentes"
  Então o preview do snapshot é atualizado em tempo real sem as ações
  E a URL gerada para o GitHub não contém ações

Cenário: Usuário submete o relatório
  Dado que o BugReportDialog tem uma descrição preenchida
  Quando o usuário clica em "Enviar Relatório"
  Então uma nova aba abre com a URL do GitHub Issues pré-preenchida
  E o título, body e label=bug estão presentes na URL
  E o dialog fecha após o clique
```

---

## 7. Rastreabilidade

| Artefato | Referência |
|----------|-----------|
| Feature no PRD | F-26 |
| Tasks de implementação | TASK-BR-01 a TASK-BR-08 |
| Seção de arquitetura | `ARCHITECTURE.md` → "Bug Report System" |
| Especificação de implementação | `SPEC.md` → Fase 15 |
