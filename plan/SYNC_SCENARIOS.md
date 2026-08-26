# Sincronização — Cenários e Recuperação

> **Histórico:** O documento original descrevia a arquitetura de sync IndexedDB ↔ File System Access API + JSON,
> removida em 2026-05-26 em favor do SQLite/OPFS (veja decisão arquitetural em `ARCHITECTURE.md`).
> Este documento foi reescrito para cobrir: (1) os cenários atuais de armazenamento SQLite single-device,
> (2) o sync multi-desktop via pasta compartilhada com arquivo por dispositivo (F-28 Nível 2, Fase 1) e
> (3) o sync multi-dispositivo (incl. mobile) via Google Drive / Dropbox (F-28 Nível 2, Fase 2).

> **Roadmap de implementação em fases (decidido em 2026-07-24, ver `FABLE-BRAINSTORM.md`):**
>
> | Fase | Escopo | Cenários | Itens do backlog |
> |------|--------|----------|------------------|
> | **0** | Motor de merge (`updatedAt` + `merge.ts`), sem transporte | — | CS-04, CS-05, CS-10 |
> | **1** | Pasta compartilhada + **um arquivo `.db` por dispositivo** (multi-desktop) | S-16 a S-20 | CS-13 a CS-17 |
> | **2** | Google Drive API (OAuth2 PKCE) — desbloqueia **mobile** | S-08 a S-15 | CS-01 a CS-03, CS-06 a CS-09 |
> | **3** | Dropbox (2º provider) | S-08 a S-15 (idênticos) | CS-11, CS-12 |
>
> O **motor de merge é o mesmo nas três fases** — só o transporte muda. WebDAV como transporte
> adicional foi adiado (`M-65` em `BACKLOG.md`).

---

## Parte 1 — Armazenamento Atual (SQLite/OPFS, Single-Device)

O Gimbo mantém um único arquivo `gimbo.db` no OPFS (Origin Private File System) do browser.
O usuário não vê esse arquivo diretamente; o app oferece Export/Import manual via aba "Dados" em Configurações.

---

### S-01. Usuário Novo (Cold Start)

**Contexto:** Primeira abertura no browser. OPFS vazio.

**Fluxo:**
- `storage.loadDataFile()` retorna `null`.
- Route guard redireciona para `/onboarding`.
- Usuário escolhe "Criar novo" ou "Importar backup existente (`.db` ou `.json` legado)".
- Ao criar, `createEmptyDataFile()` é escrito no SQLite e `loadData()` hidrata o store.

---

### S-02. Retorno Após Reload / Reabertura do Browser

**Contexto:** OPFS tem dados persistidos de sessões anteriores.

**Fluxo:**
- `storage.loadDataFile()` retorna `DataFile` diretamente do SQLite.
- App renderiza sem qualquer interação do usuário — experiência instantânea.
- Nenhum badge de sync ou permissão é necessário (SQLite não depende de File System Access API).

---

### S-03. Export Manual de Backup

**Contexto:** Usuário quer guardar uma cópia do seu banco de dados.

**Fluxo:**
- Usuário acessa Configurações → Dados → "Exportar backup".
- `storage.exportBlob()` executa WAL checkpoint e lê o arquivo OPFS como `ArrayBuffer`.
- Browser faz download do arquivo `gimbo-backup.db`.
- Usuário pode armazenar no local de sua preferência (pasta local, Dropbox, Google Drive manual, pendrive).

**Risco:** Se o usuário nunca exportar, uma limpeza de cache do browser apaga os dados sem aviso.
**Mitigação planejada:** Alerta periódico e sync automático via cloud (F-28).

---

### S-04. Import de Backup

**Contexto:** Usuário está em um dispositivo sem dados (cache limpo, novo browser, novo computador).

**Fluxo:**
- Usuário acessa Onboarding → "Importar backup existente" e seleciona `.db` ou `.json`.
- Para `.db`: `storage.importBlob()` — fecha DB, escreve bytes no OPFS, remove WAL/journal, reabre, re-executa migrations, chama `loadData()`.
- Para `.json` legado: `validateDataFile()` → `storage.replaceAll()` → `loadData()`.

**Proteção:** Se o arquivo `.db` for inválido (não é SQLite), a operação falha com erro exibido em toast. O OPFS existente não é sobrescrito até a importação ser bem-sucedida.

---

### S-05. Limpeza de Cache do Browser (Perda de Dados)

**Contexto:** Usuário limpa dados do browser ou sistema operacional libera espaço do OPFS.

**Fluxo atual:**
- `storage.loadDataFile()` retorna `null`.
- App volta para `/onboarding` — todos os dados foram perdidos.
- Se o usuário tiver um backup `.db` exportado previamente, pode restaurar via S-04.
- Se não tiver backup, os dados são irrecuperáveis.

**Impacto:** Este é o maior risco da arquitetura atual. Mitigado pela implementação do F-28 (sync cloud automático).

---

### S-06. Múltiplas Abas Abertas Simultaneamente

**Contexto:** Usuário abre o Gimbo em duas abas do mesmo browser.

**Risco:** As duas abas disputam escritas no SQLite via worker OPFS. A segunda aba pode sobrescrever mutações da primeira.

**Fluxo:**
- `tabGuard.ts` detecta aba ativa via `BroadcastChannel`.
- Segunda aba exibe banner vermelho: *"O Gimbo já está aberto em outra aba. Use apenas uma aba por vez para evitar conflitos de dados."*
- Segunda aba opera em modo somente-leitura — mutações são bloqueadas.

---

### S-07. Migração de Schema (Upgrade de Versão)

**Contexto:** Usuário importa um `.db` ou `.json` de versão anterior do schema.

**Fluxo:**
- `validateDataFile()` detecta `schemaVersion < CURRENT_SCHEMA_VERSION`.
- Aplica funções de migração encadeadas (ex.: v1→v2).
- Schema atualizado é escrito no SQLite e `loadData()` é chamado.
- A experiência para o usuário é invisível — os dados carregam com a versão atualizada.

---

### Nota Técnica — Pasta de Backup Local Dentro de um Cliente de Sync de Nuvem (Nível 1, `BK-01..08`)

**Contexto:** o usuário configura a pasta de backup automático (`BK-01..03`) apontando para dentro do
Google Drive/Dropbox/OneDrive local. Isso **não é o Nível 2** (sem OAuth, sem API) — é só o cliente
desktop da nuvem replicando um arquivo comum que o Gimbo já escreve na pasta.

**Comportamento (decisão registrada em 2026-07-11):**
- O cliente de nuvem trata `gimbo-backup.db` como binário opaco — replica o arquivo **inteiro** a
  cada mudança, sem diff de conteúdo; não entende SQLite.
- Isso é seguro: `storage.exportBlob()` faz WAL checkpoint antes de ler (o blob exportado já é uma
  foto consistente, sem depender de `-wal`/`-shm`), e a escrita via `createWritable()` (File System
  Access API) é atômica — grava num arquivo temporário e só substitui o `.db` no `close()`. O
  cliente de nuvem nunca vê um arquivo parcialmente escrito.
- Efeito colateral aceito: cada mutação (debounce de 5s) reenvia o arquivo inteiro — não incremental.
- **Risco a comunicar ao usuário:** se a mesma pasta sincronizada for usada em dois dispositivos com
  o Gimbo aberto simultaneamente, o cliente de nuvem não faz merge — cria uma cópia duplicada em
  conflito (`gimbo-backup (1).db`) silenciosamente, sem avisar que os dados divergiram. Só o Nível 2
  (merge aditivo por UUID em nível de aplicação, `S-11`) resolve isso de verdade. O conteúdo de
  `/docs/backup-local` deve deixar essa distinção explícita.

---

## Parte 2 — Fase 1: Multi-Desktop via Pasta Compartilhada (F-28 Nível 2, Fase 1)

> **Status:** Resolvido em 2026-07-24. Tarefas `CS-13` a `CS-17` em `BACKLOG.md`;
> especificação técnica na Fase 16 de `SPEC.md`; implementação em `app/src/lib/cloudSync/folderSyncService.ts`.

### Princípio Arquitetural

O Nível 1 falha em multi-dispositivo por um motivo específico e evitável: **dois dispositivos
escrevem o mesmo arquivo** (`gimbo-backup.db`), e o cliente de nuvem — que não entende SQLite —
resolve a escrita concorrente criando uma cópia em conflito.

A Fase 1 elimina esse problema por construção: **cada dispositivo escreve exclusivamente o seu
próprio arquivo**. Nenhum arquivo tem dois escritores, então o cliente de nuvem nunca observa
conflito. O merge acontece **em nível de aplicação**, dentro do Gimbo, lendo os arquivos dos
outros dispositivos.

```
Pasta escolhida pelo usuário (dentro do Drive/Dropbox/OneDrive/Syncthing/NAS)
  └── gimbo/
        ├── device-a1b2c3.db     ← escrito SÓ pelo desktop de casa
        ├── device-d4e5f6.db     ← escrito SÓ pelo notebook do trabalho
        └── ...

Desktop A (SQLite/OPFS) ──escreve──► device-a1b2c3.db
                        ──lê──────► device-d4e5f6.db (e demais) → mergeForSync()
```

**Decisões de produto/arquitetura (2026-07-24):**

- **Formato: snapshot `.db` completo por dispositivo** (não oplog). Reusa `storage.exportBlob()`
  sem nenhuma máquina nova de compactação/GC de log. O custo de reescrever o arquivo inteiro a
  cada mutação já é aceito e praticado no Nível 1 hoje.
- **Identidade do dispositivo: UUID persistido no OPFS** (arquivo `device-id` ao lado do
  `gimbo.db`), gerado no primeiro boot. OPFS foi escolhido em vez de `localStorage` porque
  sobrevive a limpezas parciais de dados do browser — um `deviceId` novo a cada limpeza geraria
  arquivos órfãos acumulando na pasta.
- **Cifragem client-side: opcional, off por padrão** (mesma decisão de §6 do
  `FABLE-BRAINSTORM.md`). Ligada, o arquivo por dispositivo vira um blob AES-GCM ilegível fora
  do app; desligada (padrão), o `.db` continua importável manualmente pelo usuário.
- **Não substitui o Nível 1** — é uma evolução dele. Um usuário single-device continua com o
  backup simples; o modo multi-dispositivo é um toggle na mesma aba "Backup & Sync".
- **Escopo: apenas desktop** (Chrome/Edge com File System Access API). Mobile é resolvido pela
  Fase 2 — a Fase 1 não deve prometer sync mobile em nenhuma superfície de UI.

---

### S-16. Ativação do Modo Multi-Dispositivo (Fase 1)

**Contexto:** usuário já tem (ou configura agora) uma pasta de backup local e quer usar o Gimbo
em um segundo desktop.

**Fluxo:**
1. Settings → "Backup & Sync" → toggle "Sincronizar entre meus computadores".
2. App gera (ou lê) o `deviceId` do OPFS e passa a gravar em `<pasta>/gimbo/device-<id>.db`
   em vez do `gimbo-backup.db` único.
3. Aviso explícito na ativação: *"Escolha uma pasta sincronizada (Google Drive, Dropbox,
   OneDrive). Cada computador escreve seu próprio arquivo — não edite nem remova esses arquivos
   manualmente."*
4. O `gimbo-backup.db` legado (Nível 1) **não é apagado** — permanece como backup histórico.

---

### S-17. Segundo Desktop Entra na Pasta

**Contexto:** usuário instala o Gimbo no segundo computador e aponta para a mesma pasta
sincronizada. OPFS local vazio.

**Fluxo:**
1. Onboarding detecta OPFS vazio → oferece "Restaurar de uma pasta".
2. Usuário seleciona a pasta; o app encontra N arquivos `device-*.db`.
3. Se N ≥ 1: importa o primeiro e aplica `mergeForSync()` com os demais → estado consolidado.
4. Gera seu **próprio** `deviceId` e passa a escrever `device-<novo-id>.db`.
5. Resultado: os dois dispositivos convergem no próximo ciclo de leitura de cada um.

---

### S-18. Fluxo Diário — Merge no Startup

**Contexto:** usuário abre o Gimbo num desktop já configurado; o outro desktop gravou alterações.

**Fluxo:**
1. App carrega **instantaneamente** do SQLite/OPFS local (nunca espera a pasta).
2. Em background: lista `<pasta>/gimbo/device-*.db`, ignorando o próprio arquivo.
3. Para cada arquivo com `lastModified` mais recente que o último merge conhecido: lê o blob,
   monta um `DataFile` em memória e aplica `mergeForSync(local, remote)`.
4. Se o merge alterou algo: `storage.replaceAll(merged)` + regrava o próprio `device-<id>.db`.
5. Badge discreto: *"Sincronizado agora"*. Sem modal, sem interrupção.

> A leitura de arquivo alheio é **somente leitura** — o Gimbo nunca escreve no `device-*.db`
> de outro dispositivo. É o que garante o invariante de escritor único.

---

### S-19. Dispositivo Aposentado / Arquivo Órfão

**Contexto:** o usuário trocou de computador; o `device-<antigo>.db` continua na pasta.

**Comportamento:**
- O arquivo antigo continua sendo lido no merge — inofensivo, pois o merge é aditivo e o
  conteúdo é um subconjunto já convergido (nada novo entra).
- Settings → "Backup & Sync" lista os dispositivos detectados (id abreviado + data da última
  escrita) com ação **"Remover este dispositivo"**, que apaga o arquivo da pasta.
- **Nunca** há remoção automática: apagar arquivo do usuário sem pedir é inaceitável num app
  de finanças. O app apenas sinaliza dispositivos sem escrita há mais de 90 dias.

---

### S-20. Arquivo de Dispositivo Corrompido ou em Escrita

**Contexto:** um `device-*.db` está corrompido, é de uma versão futura do schema, ou está sendo
replicado pelo cliente de nuvem no exato momento da leitura.

**Comportamento:**
- Falha ao abrir/validar um arquivo alheio **nunca** interrompe o boot nem contamina o estado
  local: o arquivo é **pulado**, com log em telemetria (contador, sem nome de arquivo).
- Se o arquivo for de `schemaVersion` **maior** que o local, é pulado com banner discreto:
  *"Um dos seus computadores está numa versão mais nova do Gimbo. Atualize este para
  sincronizar."* — evita merge com schema desconhecido.
- Escrita atômica do próprio arquivo via `createWritable()` (grava em temporário, substitui no
  `close()`) — o mesmo mecanismo já validado no Nível 1 garante que outros dispositivos nunca
  leiam um arquivo parcialmente escrito.
- O merge é **idempotente**: reler um arquivo já mesclado não produz efeito, então pular e
  tentar no próximo boot é sempre seguro.

---

## Parte 3 — Fase 2/3: Sync Multi-Dispositivo via Nuvem (F-28 Nível 2, Fases 2 e 3)

> **Status:** Fase 2 (Google Drive) resolvida e validada em produção em 2026-07-25 — `CS-01` a
> `CS-03` e `CS-06` a `CS-09` em `BACKLOG.md`, implementação em `googleAuth.ts`/`googleDrive.ts`.
> Fase 3 (Dropbox) segue planejada, demand-driven — `CS-11`/`CS-12`, sem especificação técnica
> nem módulo no código ainda.
>
> **Esta é a fase que desbloqueia o mobile** — sem File System Access API, o PWA mobile só
> participa do sync por rede. A Fase 1 (Parte 2) resolve multi-desktop; esta resolve o resto.

### Princípio Arquitetural

O Google Drive (ou Dropbox) do usuário atua como **camada de sync**, não como servidor do Gimbo.
Os dados pertencem ao usuário, armazenados na conta de nuvem dele, em uma pasta `Gimbo/`.
O Gimbo acessa essa pasta via API (OAuth2 PKCE + `client_secret` bundlado — sem backend, sem
servidor próprio; ver achado técnico no `CLAUDE.md`: clientes OAuth "Aplicativo da Web" do Google
exigem `client_secret` mesmo com PKCE, não existe tipo de cliente que dispense o secret e aceite
`redirect_uri` HTTPS de produção).

```
Google Drive do usuário
  └── Gimbo/
        └── gimbo.db          ← fonte de verdade compartilhada

Desktop (SQLite/OPFS)   <──pull/push──>   Drive
Mobile PWA (SQLite/OPFS) <──pull/push──>  Drive
```

**Regra de sync:**
- **Pull ao abrir** — se o arquivo no Drive é mais recente que o local, baixar e aplicar merge.
- **Push ao fechar / após N mutações** — enviar estado local para o Drive.
- **Offline** — mutações acumulam localmente; sync acontece na próxima conexão disponível.

> **Decisões de produto/arquitetura (2026-07-11, revisadas em 2026-07-24):**
> - ~~**Verificação OAuth do Google é pré-requisito, não opcional.**~~ **Revisado (2026-07-24):** a premissa estava superdimensionada. O escopo `drive.file` é classificado pelo Google como **não-sensível**, e apps que usam apenas escopos não-sensíveis **não são obrigados** a passar pela verificação completa (revisão de tela de consentimento, vídeo de demonstração); a avaliação de segurança anual aplica-se apenas a escopos **restritos** (`drive` completo), que o Gimbo não usa. O processo é **por app, uma única vez**, feito pelo mantenedor — o usuário final nunca participa de verificação, apenas consente em 2 cliques. **Ressalvas reais que permanecem no `CS-01`:** (a) publicar o app em *publishing status* **"Production"** — em "Testing" o aviso "app não verificado" aparece e há teto de usuários; (b) *brand verification* (processo leve) se quisermos exibir logo/nome próprios na tela de consentimento; (c) ~~validar tudo isso na prática com um client_id de teste antes de dar o `CS-01` por resolvido~~ — **feito**: validação empírica em 2026-07-25, `CS-01` resolvido e sync com Google Drive funcionando em produção.
> - **O arquivo `gimbo.db` é visível na pasta `Gimbo/` do Drive do usuário** (a API do Drive não permite ocultá-lo do Web UI do próprio usuário, mesmo com escopo `drive.file`). Isso vaza a implementação técnica (SQLite/OPFS) para uma superfície que o Gimbo não controla — o usuário pode abrir o Drive, ver um binário que não consegue abrir, e ficar em dúvida se pode apagar. Mitigação: aviso explícito na primeira conexão (S-08) + doc page (mesmo padrão de `BK-07`) explicando que o arquivo é gerenciado pelo Gimbo e não deve ser editado/movido/removido manualmente pelo usuário.

---

### S-08. Primeira Conexão ao Google Drive

**Contexto:** Usuário habilita sync pela primeira vez em Configurações → Backup & Sync.

**Fluxo:**
1. Usuário clica "Conectar Google Drive".
2. OAuth2 PKCE redirect → Google autoriza o app a gerenciar apenas a pasta `Gimbo/` (escopo `drive.file`).
3. Token de acesso + refresh token armazenados no `localStorage` (criptografados, sem dados financeiros).
4. App verifica se `Gimbo/gimbo.db` existe no Drive:
   - **Não existe:** faz upload do estado local → Drive passa a ser a fonte de verdade.
   - **Existe:** baixa o arquivo, faz merge com o estado local (S-11), salva resultado em ambos os lados.

---

### S-09. Fluxo Diário — Dispositivo já Conectado

**Contexto:** Usuário abre o Gimbo num dispositivo que já autenticou com o Drive.

**Fluxo:**
1. App carrega instantaneamente do SQLite local (sem esperar rede).
2. Em background: baixa metadados do Drive (`gimbo.db` → `modifiedTime`).
3. **Se Drive é mais recente:** aplica merge silencioso (S-11). Badge discreto: *"Sincronizado agora"*.
4. **Se local é mais recente ou igual:** nenhuma ação.
5. Mutações do usuário disparam push debounced (5s após última mutação).

---

### S-10. Configuração em Dispositivo Novo (Mobile ou Segundo Desktop)

**Contexto:** Usuário instala o Gimbo como PWA em um novo dispositivo. OPFS local está vazio.

**Fluxo:**
1. Onboarding detecta OPFS vazio → exibe `/onboarding`.
2. Usuário escolhe "Restaurar via Google Drive".
3. OAuth2 PKCE → encontra `Gimbo/gimbo.db` no Drive.
4. Baixa e importa o arquivo (`importBlob()`).
5. App inicializa com todos os dados do usuário — experiência idêntica ao dispositivo principal.

---

### S-11. Merge Aditivo — Resolução de Conflito

**Contexto:** Usuário criou lançamentos em dois dispositivos offline. Ambos tentam fazer push ao Drive.

**Política:** Merge aditivo por UUID, sem intervenção manual obrigatória.

**Regras:**
- **Transação nova em A, não existe em B:** sobrevive (union por `id`).
- **Transação nova em B, não existe em A:** sobrevive.
- **Mesma transação editada nos dois lados:** último `updatedAt` vence (campo a adicionar ao `Transaction`).
- **Transação deletada em A:** o `id` entra em `deletedIds` — não é recuperada do outro lado.
- **Resultado:** pode haver duplicatas visíveis se o usuário criou a mesma despesa nos dois dispositivos offline.

**UX do conflito:**
- O app não exibe modal de conflito — merge é automático e silencioso.
- Se o saldo exibido parecer incorreto, o usuário verifica seus lançamentos e remove a duplicata manualmente (comportamento esperado, idêntico ao Organizze).
- Nenhum dado é perdido automaticamente.

---

### S-12. Operação Offline (Sem Conectividade)

**Contexto:** Usuário usa o Gimbo sem internet.

**Fluxo:**
- App funciona normalmente — toda leitura e escrita é local (SQLite/OPFS).
- Badge de sync mostra estado "Offline — X alterações pendentes".
- Ao reconectar: push automático → merge com o Drive (S-11).
- Se Drive tem mudanças de outro dispositivo: merge aditivo aplicado silenciosamente.

---

### S-13. Arquivo Corrompido no Drive

**Contexto:** O `gimbo.db` no Drive foi corrompido (sync parcial, edição manual, conflito de merge do próprio cliente do Drive).

**Fluxo:**
- App baixa o arquivo e tenta `importBlob()`.
- SQLite rejeita o arquivo (assinatura inválida) → `importBlob()` lança erro.
- App mantém o estado local intacto.
- Exibe banner: *"O arquivo de sync no Drive está corrompido. Seus dados locais estão seguros. Clique para sobrescrever o Drive com sua cópia local."*
- Usuário confirma → push forçado do estado local para o Drive.

---

### S-14. Revogar Acesso / Desconectar Drive

**Contexto:** Usuário quer desativar o sync ou trocar de provider.

**Fluxo:**
- Usuário acessa Configurações → Backup & Sync → "Desconectar".
- Token de acesso removido do `localStorage`.
- Dados locais permanecem intactos no OPFS.
- Arquivo `Gimbo/gimbo.db` permanece na conta do Drive do usuário (não é deletado pelo app — dado pertence ao usuário).
- App volta a funcionar em modo single-device (S-01 a S-07).

---

### S-15. Token Expirado / Sessão OAuth Inválida

**Contexto:** Token de acesso expirou (Google: 1h) ou foi revogado pelo usuário nas configurações do Google.

**Fluxo:**
- Push/pull falha com `401 Unauthorized`.
- App tenta refresh via `refresh_token` armazenado.
  - **Sucesso:** novo access token salvo, operação retentada uma vez.
  - **Falha (refresh inválido):** badge de sync em vermelho. *"Sessão de sync expirada. Clique para reconectar ao Google Drive."*
- App continua funcionando offline (somente OPFS local) até o usuário reconectar.

---

## Resumo das Políticas

### Comuns a todas as fases (motor de merge — Fase 0)

| Situação | Comportamento |
|----------|---------------|
| OPFS vazio, sem sync | Onboarding |
| Conflito de edição na mesma entidade | Último `updatedAt` vence (LWW) |
| Entidade nova em apenas um lado | Sobrevive (union por `id`) |
| Transação duplicada (offline em 2 devices) | Ambas sobrevivem; usuário remove manualmente |
| Deleção em qualquer device | `deletedIds` (union) impede recuperação no merge |
| Merge reaplicado sobre o mesmo insumo | Idempotente — sem efeito |
| Offline | App funciona normalmente (local-first); sync na próxima oportunidade |

### Fase 1 — Pasta compartilhada, arquivo por dispositivo (multi-desktop)

| Situação | Comportamento |
|----------|---------------|
| OPFS vazio, pasta com `device-*.db` | Importa + merge de todos → app pronto (S-17) |
| Outro dispositivo gravou desde o último boot | Merge silencioso no startup + regrava o próprio arquivo (S-18) |
| Escrita concorrente no mesmo arquivo | **Impossível por construção** — um escritor por arquivo |
| Arquivo de dispositivo aposentado | Lido e ignorado (inofensivo); remoção só manual, via Settings (S-19) |
| Arquivo alheio corrompido / em escrita | Pulado silenciosamente; boot nunca bloqueia; retenta no próximo (S-20) |
| Arquivo alheio com `schemaVersion` maior | Pulado + banner "atualize este computador" (S-20) |
| Mobile | **Fora de escopo** — sem File System Access API (usar Fase 2) |

### Fases 2/3 — Nuvem via API (Drive/Dropbox; inclui mobile)

| Situação | Comportamento |
|----------|---------------|
| OPFS vazio, cloud conectado | Pull do Drive → import → app pronto (S-10) |
| OPFS com dados, cloud mais recente | Merge silencioso (pull + merge) (S-09) |
| OPFS com dados, cloud igual | Nenhuma ação |
| Arquivo cloud corrompido | Estado local preservado; push forçado após confirmação (S-13) |
| Token expirado | Refresh automático + retry único; badge vermelho se falhar (S-15) |
| Desconectar provider | Tokens removidos; dados locais intactos; arquivo permanece na nuvem (S-14) |

---

## Parte 4 — Diário de Sessão: Sync Multi-Dispositivo sob Carga Real (2026-08-25/26)

> **Propósito desta seção:** diferente do resto do documento (cenários de comportamento, atemporais),
> isto é um **relato cronológico** de uma sessão específica de trabalho — branch
> `dassan/sync-drive-fixes` — escrito para que uma sessão futura (humana ou IA) entenda o que
> aconteceu, por quê, e o que ficou em aberto, sem precisar reconstruir isso a partir de 17 entradas
> de `BACKLOG.md` fora de ordem. Os itens `CS-20`, `CS-24` a `CS-36` citados abaixo têm o registro
> técnico canônico em `plan/BACKLOG.md`; o texto aqui é o *porquê* e o *como pensamos*, não uma
> duplicata do *o quê*.

### 0. Gatilho: uso real em produção, não um teste sintético

A sessão começou com o mantenedor relatando problemas reais usando o Gimbo em produção, sincronizando
via Google Drive um cofre de verdade — não um fixture de teste — com **~25-26,5 mil transações e
~13-15MB**. Dois sintomas relatados de início:

1. O primeiro sync no celular (conectando o Drive pela primeira vez, wifi comum) levou **minutos**.
2. Um lançamento feito **logo depois** desse sync sumiu após um refresh na web.

O segundo sintoma virou `CS-24` (bug de race grave — ver abaixo). Mas o padrão de trabalho que se
estabeleceu a partir daí definiu o resto da sessão: em vez de investigar com dados sintéticos, cada
correção foi validada contra o **cofre real do mantenedor**, testado manualmente entre dois
browsers reais (tipicamente Chrome escrevendo, Firefox lendo, ou vice-versa) — porque a
infraestrutura de teste automatizado do projeto (`vitest`/jsdom) **não roda wa-sqlite/OPFS de
verdade**, então bugs desta camada (performance de query real, corrupção do módulo WASM, tempo de
round-trip de uma API real) são estruturalmente invisíveis a testes unitários. Isso gerou um ciclo
de trabalho recorrente ao longo de toda a sessão: **fix → suíte completa verde → e2e Playwright
contra wa-sqlite real → o mantenedor testa contra o cofre real de novo → novo achado → repete.**
Esse ciclo produziu 13 itens de backlog (`CS-24` a `CS-36`) numa única sessão contínua.

### 1. O dilema estratégico: servidor de sync próprio vs. investir na camada local

Depois de uma primeira leva de correções (`CS-24` e `CS-25`, ambos bugs de orquestração — ver
§2), o mantenedor levantou uma preocupação de nível mais alto, não sobre um bug específico: **o
custo de manutenção da própria camada de sync estava crescendo rápido demais** — 5 bugs reais
numa única sessão de trabalho (`CS-24` a `CS-29`) é um sinal de que a superfície é frágil. A
pergunta explícita foi se valia a pena recuar da arquitetura "sync client-side puro contra a nuvem
do próprio usuário" (o desenho de todo o F-28 Nível 2, decidido em 2026-07-24) em favor de um
servidor de sync próprio do Gimbo.

Isso foi discutido e explorado, mas **descartado** — não por ser tecnicamente inviável, mas porque
contradiria o princípio de produto mais fundamental do Gimbo (`CLAUDE.md`, identidade do projeto):
"local-first... sem servidor, sem nuvem", com os dados sempre na infraestrutura do próprio usuário.
Um servidor de sync do Gimbo resolveria os sintomas de performance, mas ao custo de abandonar
exatamente a proposta de valor que diferencia o produto. A decisão foi **investir em reduzir o
próprio custo recorrente do sync local**, atacando a causa estrutural em vez de trocar de
arquitetura: por que o merge de sync continuava reescrevendo/relendo o cofre inteiro a cada ciclo,
quando o `M-73` já tinha resolvido exatamente esse problema — reescrita total → diff — para
mutação normal do dia a dia?

A resposta original do `M-73` para essa pergunta ("o merge pode tocar uma fração não-limitada de
entidades, o diff degradaria pro custo de reescrita total mesmo") foi reavaliada à luz da
telemetria real coletada nesta sessão (`CS-20`/`CS-24` a `CS-29`): é um argumento de pior caso que
não se sustenta para o caso comum (sync do dia a dia, poucas linhas mudam) — e no pior caso (primeiro
sync, tudo diverge), o diff nunca é *pior* que a reescrita total que ele substitui, só igual.

O mantenedor então propôs, por conta própria, uma segunda ideia complementar: **uma tabela de
controle com hash por partição** (por tabela pequena inteira, por ano para `transactions`) — comparar
hashes *antes* de ler/parsear o `.db` do peer, pulando inteiramente as partições que baterem. Essa
ideia não veio de mim; foi oferecida pelo mantenedor e explorada e formalizada a partir daí.

Isso virou um plano de 2 fases, desenhado via Plan Mode (agentes Explore + Plan), aprovado
explicitamente pelo mantenedor ("Quero, vamos seguir com o plano") depois de uma discussão
explícita sobre riscos aceitos — arquivo completo em
`/home/dassan/.claude/plans/crystalline-seeking-pearl.md`:

- **Fase 1** — trocar `storage.replaceAll(merged)` (reescrita total) por
  `storage.applyMutation(merged, diffTransactions(baseline, merged.transactions))` (mesmo
  mecanismo do `M-73`) nos três pontos que faziam merge de sync. Baixo risco: reaproveita 100% de
  mecanismo já existente e testado, nenhuma mudança de formato de dado.
- **Fase 2** (2a schema+manutenção, 2b leitura seletiva) — a tabela de hash por partição proposta
  pelo mantenedor, para atacar o custo de *ler* o `.db` do peer (que a Fase 1 não toca — ela só
  resolve o custo de *escrever* o resultado do merge).

**Risco aceito explicitamente, documentado no plano e recorrente ao longo da sessão:** qualquer
comparação nesta camada (hash local vs. hash do peer, snapshot pré-pull vs. estado atual) precisa
ser feita contra o estado **atual** do disco, nunca contra um snapshot anterior a uma operação
potencialmente longa (o pull pode levar segundos a minutos) — é exatamente a classe de bug já
encontrada no `CS-24` e reencontrada no `CS-29`. **Mitigação de UX aceita como fora de escopo
deste trabalho de camada de dados:** o primeiro sync de um dispositivo novo continua sendo o caso
mais caro por natureza (nada nas duas fases muda isso) — o mantenedor decidiu que a mitigação
correta para isso é uma feature de UI separada (um spinner bloqueante durante o primeiro sync),
não algo a resolver aqui.

### 2. Bugs de orquestração encontrados antes do plano de 2 fases (`CS-24`, `CS-25`)

Estes dois antecederam a decisão estratégica acima e foram o gatilho dela:

- **`CS-24`** — o bug real que motivou a sessão: `runPeerSync` tirava um snapshot de `data` *antes*
  do pull (que pode levar minutos), e uma mutação feita nesse meio-tempo sobrevivia à sua própria
  escrita mas era apagada pelo `replaceAll(merged)` calculado a partir do snapshot já desatualizado.
  Corrigido religando `runPeerSync` para reler o estado atual após o pull e, só se divergiu do
  snapshot inicial, reconciliar com um segundo merge antes de publicar.
- **`CS-25`** — `runPeerSync()` disparava duas vezes concorrentemente na primeira conexão (boot de
  `App.tsx` + callback OAuth de `Settings`, mesma navegação), cada uma refazendo lookup e
  reenviando o cofre inteiro. Corrigido com uma guarda de reentrância (`if (get().syncStatus ===
  'syncing') return`, sem `await` antes — livre de race pela semântica run-to-completion do JS).

Junto com estes, `CS-20` criou a própria infraestrutura de telemetria que tornou o resto da sessão
possível: `lib/cloudSync/syncMetrics.ts`, **deliberadamente sempre ativo, inclusive em produção**
(diferente do padrão dev-only de `perfMonitor.ts`/M-71) — porque a latência real da API do Drive só
se manifesta no dispositivo real do usuário, nunca numa máquina de dev em localhost. Consumida via
o Bug Report System (F-26) já existente, como categoria "performance" do JSON exportado — é assim
que o mantenedor conseguiu colar os arquivos `chrome-N.json`/`firefox-N.json` usados para
diagnosticar cada rodada.

### 3. Fase 1 implementada e validada (`CS-30`, `CS-31`)

Os três pontos de sync que faziam `replaceAll()` passaram a usar `applyMutation()` +
`diffTransactions()`. Validado contra dado real: `sync.applyMutation` caiu para a faixa 100-400ms
esperada pelo `M-73`. Mas essa mesma validação revelou um achado colateral (`CS-31`, ainda **aberto**
no momento em que a Parte 4 deste documento foi escrita): a *leitura* do baseline local que o diff
precisa (`storage.loadDataFile()`, chamada nova introduzida pela própria Fase 1) custou **7,3s no
Firefox** contra **52ms no Chrome**, mesmo tamanho de cofre — um descompasso Firefox×Chrome que já
aparecia em outras coletas desta sessão (inclusive na hidratação de boot) mas nunca tinha sido
nomeado explicitamente como um padrão. Sem causa raiz investigada; a expectativa registrada é que a
Fase 2 (hash por partição, aplicada também ao lado local) mitigue o sintoma como efeito colateral,
sem resolver a causa raiz do descompasso em si.

### 4. Fase 2a e 2b implementadas — e o ciclo de "corrigido, mas não validado" (`CS-32` a `CS-34`)

- **`CS-32`** (Fase 2a) — schema `table_hashes` (migration v16) e manutenção incremental do hash
  (FNV-1a de 32 bits + XOR-fold, síncrono de propósito — `crypto.subtle` reintroduziria o mesmo
  overhead-por-chamada que o `M-72` já tinha corrigido). Um e2e novo pegou um bug real de
  normalização antes de qualquer leitura seletiva depender desses hashes (fallback `updatedAt ??
  ts` não espelhado no cálculo do hash, fazendo o hash mudar sozinho sem edição real).
- **`CS-33`** (Fase 2b) — leitura seletiva do peer usando os hashes acima. Validado com um teste
  e2e que usa **dois contextos de browser reais** (dois "dispositivos" de verdade) e que foi
  explicitamente estressado contra o pior caso possível: forçar `hashesMatch()` a sempre "bater"
  (pular tudo cegamente) — o teste falhou corretamente detectando perda de dado do peer, revertido
  antes de commitar. Essa verificação foi deliberada: perda silenciosa de dado é um risco mais
  grave do que o "sync lento" que motivou toda a Fase 2, e por isso ganhou cobertura específica.
- **`CS-34`** — o primeiro "não funcionou na prática" da Fase 2: o mantenedor repetiu o teste de
  dois browsers depois do `CS-33` e reportou **nenhum ganho de velocidade, "pelo contrário, pareceu
  mais lenta"**. Causa raiz: `table_hashes` só é mantida *incrementalmente* (só os anos que um
  delta realmente tocou ganham uma linha) — qualquer ano de histórico nunca tocado por uma mutação
  diffada desde que a v16 existe **nunca ganha uma linha na tabela**, e a ausência é tratada (por
  desenho, corretamente) como "sempre diverge" — então o histórico inteiro continuava sendo lido
  para sempre. O teste do `CS-33` não pegou isso porque semeava via `replaceAll()`, que já popula
  os hashes como efeito colateral — nunca exercitou "cofre com dado antigo, hashes vazias", que é
  exatamente o estado real de qualquer vault que existia antes da v16. Corrigido com
  `backfillTableHashesIfNeeded()` — checagem barata, popula tudo de uma vez só quando a tabela está
  vazia — chamada em `init()` (boot) e `readForeignDataFile()` (peer). **Extensão do mesmo item**,
  motivada por uma pergunta de esclarecimento do mantenedor sobre o procedimento de reteste
  ("importo → pago o custo do backfill → exporto → reuso esse arquivo daí em diante, certo?"): essa
  pergunta expôs que `importDb()` reabre `db` **fora** do caminho de boot de `init()`, então
  importar um `.db` antigo sem hashes só ganharia o backfill no *próximo reload*, não no mesmo
  carregamento em que o import acontece — contradizendo o fluxo que o mantenedor tinha acabado de
  propor. Adicionada a mesma chamada ao final do caminho de sucesso de `importDb()`.

**Achado técnico transversal a toda a Fase 2 (`CS-28`), grave o suficiente para virar regra
permanente em `CLAUDE.md`:** a primeira versão do fix do `CS-26` paralelizava três queries com
`Promise.all` dentro do worker — o que corrompe o módulo WASM do `wa-sqlite` (build Asyncify, que só
suporta **uma chamada em voo por vez**). Isso não era hipotético: crashou uma tentativa real de
importação do mantenedor minutos depois (`RuntimeError: unreachable executed`). A distinção que
causou a confusão original: `StorageService.getTransactions()` (main thread) já usa esse mesmo
padrão de `Promise.all` com segurança, porque cada chamada passa por `postMessage` → a fila
`enqueue()` do worker antes de chegar no wasm; código que já roda **dentro** de uma task do worker
(como o leitor de peer) não tem mais nenhuma serialização abaixo dele. Corrigido revertendo para
sequencial.

### 5. Esta sessão (retomada após compactação de contexto): `CS-35` e `CS-36`

O usuário enviou duas coletas reais novas (`chrome-2.json`/`firefox-2.json`, Firefox importando um
`.db` com hashes já backfilled, Chrome sincronizando esse mesmo `.db` via Drive) pedindo confirmação
de que o fix do `CS-34` resolveu o problema. A análise dessas duas coletas — cruzando os números
crus de `worker.query:SELECT...` (timings *cumulativos* dentro de um mesmo lote de leitura, não
durações independentes por query — uma armadilha de leitura do próprio formato de telemetria que
valeu a pena registrar aqui) com os metric names de mais alto nível (`sync.pullAndMerge.total`,
`sync.runPeerSync.total`, `worker.readPeer`) — revelou dois achados distintos, um confirmado e
corrigido (`CS-35`), outro deixado como pergunta em aberto instrumentada, não respondida (`CS-36`):

- **`CS-35` (confirmado via leitura do código, corrigido):** um `worker.query:SELECT t.* FROM
  transactions` isolado, custando **~8,85s no Chrome / ~6,5s no Firefox**, aparecia *depois* de
  `sync.pullAndMerge.total` já ter terminado — inclusive no Firefox, onde **nenhuma reconciliação
  de edição concorrente chegou a disparar** (ou seja, o valor lido nem sequer era usado). Ao ler o
  código-fonte (`syncService.ts`/`folderSyncService.ts`/`useDataStore.ts`), a causa ficou clara:
  `pullAndMergeInner`/`syncFromPeers` já computam o `DataFile` mergeado inteiro em memória e o
  persistem via `applyMutation` — mas o `SyncResult` que devolviam pro chamador descartava esse
  valor (`{status:'merged', peersMerged}`, sem o dado), forçando `runPeerSync` a chamar
  `storage.loadDataFile()` de novo só para reconstruir uma cópia equivalente do que já tinha sido
  calculado, pagando o mesmo custo de leitura completa que o `M-72` documentou (~3-9s num cofre
  real) a cada sync, usado ou não. Corrigido devolvendo o `DataFile` já calculado em `result.data`
  (`SyncResult`'s variante `'merged'`, `provider.ts`, ganhou um campo `data: DataFile`); a checagem
  de edição concorrente do `CS-29` deixou de precisar de qualquer I/O — passou a comparar
  `get().data.settings.fileUpdatedAt` (a cópia em memória do Zustand, atualizada de forma síncrona
  por todo `mutate()`, *antes* da sua própria escrita debounced de 300ms) em vez de reler o disco —
  mais rápido (zero custo) e, como efeito colateral, mais correto (não pode perder uma edição cujo
  `debouncedApplyMutation()` ainda não tenha concluído, o que uma releitura do disco poderia
  perder). Zero mecanismo novo — só threading de um valor já calculado através do tipo de retorno.
- **`CS-36` (pergunta em aberto, só instrumentada — não é ainda um "resolvido"):** depois do fix do
  `CS-35`, `worker.readPeer`/`sync.readPeerBlob` continuavam altos nas mesmas duas coletas (~11,3s
  Chrome / ~6,6s Firefox). Isso tem **duas explicações possíveis, indistinguíveis a partir do trace
  disponível**: (a) o hash-skip da Fase 2b não está de fato pulando nenhuma partição (bug ainda não
  identificado), ou (b) o par de dispositivos testado nesta rodada específica tinha estado
  genuinamente muito divergente — por exemplo, se o Chrome estava "atrasado" sincronizando pela
  primeira vez um histórico grande que o Firefox já tinha — cenário em que ler quase tudo é
  **esperado e correto** (o próprio plano da Fase 2 documentou isso como risco aceito: "primeiro
  sync continua caro", nenhuma das duas fases muda isso). Sem saber o histórico exato de cada
  dispositivo nesse teste específico, não dava para decidir entre as duas com confiança — decisão
  consciente de não adivinhar. Em vez disso, `readDataFileFromDbSelective` (`worker.ts`) passou a
  contar `tablesSkipped`/`tablesTotal` e `yearsSkipped`/`yearsTotal` enquanto decide o que ler, e
  esses números agora saem no JSON do Bug Report como `sync.readPeer.tablesSkipped`/`tablesTotal`/
  `yearsSkipped`/`yearsTotal` (mesmo padrão sempre-ativo do `CS-20`). **A próxima rodada de teste
  real vai responder isso diretamente, sem inferência.**

Ambos os itens (`CS-35` fix + `CS-36` telemetria) passaram pelo mesmo rigor de verificação do resto
da sessão: suíte completa (1005 testes unitários) verde, os 14 testes e2e relevantes de sync/import
(incluindo `SEC-05`/`SEC-06`, para garantir que a mudança no formato de `SyncResult` não afetou as
garantias de segurança de import) verdes, bundle de produção confirmado sem `__syncTest`/`__storage`
(`grep -c` = 0 em todos os arquivos). Commitados em dois commits separados (código+testes, depois
docs) na branch `dassan/sync-drive-fixes` — ainda não mergeada, sem PR aberta.

### 6. Estado no momento em que este relato foi escrito pela primeira vez (2026-08-26, manhã)

- **Resolvido e validado contra dado real, com confiança alta:** `CS-20`, `CS-24`, `CS-25`, `CS-26`,
  `CS-28`, `CS-29`, `CS-30`, `CS-32`, `CS-33`, `CS-34` (incl. extensão do import).
- **Resolvido, aguardando confirmação da próxima rodada real:** `CS-35` (a releitura redundante foi
  eliminada por leitura de código — correta com alta confiança — mas ainda não confirmada por uma
  nova coleta mostrando `sync.runPeerSync.total` mais próximo de `sync.pullAndMerge.total`).
- **Aberto, sem causa raiz, baixo risco percebido:** `CS-27` (latência anômala de
  `sync.drive.getMetadata`, não reproduzida numa segunda coleta — rebaixada a "provável anomalia de
  rede pontual"); `CS-31` (descompasso de performance Firefox×Chrome para a mesma query/mesmo
  tamanho de dado, causa raiz nunca investigada diretamente).
- **Instrumentado, pergunta genuinamente em aberto:** `CS-36` — não se sabia ainda se o hash-skip da
  Fase 2b estava funcionando como desenhado. A resposta dependia só de rodar o teste de novo e ler
  os quatro novos campos no JSON do Bug Report.

> Esta seção §6 ficou **desatualizada horas depois de escrita** — ver §8 abaixo para o estado
> revisado. Mantida aqui intacta (não editada retroativamente) porque documenta com precisão o que
> se sabia *no momento exato* em que a dúvida ainda estava aberta; útil para quem quiser entender a
> sequência de raciocínio, não só a conclusão final.

### 7. Fio solto no momento em que este relato foi escrito pela primeira vez

O mantenedor sinalizou, ao pedir este relato, que **passou a noite pensando numa abordagem
"levemente diferente"** para o problema geral de performance de sync — sem ainda detalhar qual —
e estava rodando uma nova rodada de teste real em paralelo a esta documentação.

> **Atualização (mesmo dia, poucas horas depois):** a rodada de teste voltou (ver §8) com um
> resultado muito positivo ("Ficou MUITO mais rápido") — mas **a abordagem alternativa em si ainda
> não foi compartilhada**. Continua um fio solto genuíno: uma sessão futura não deve assumir que o
> mantenedor abandonou essa ideia só porque o resultado atual foi bom.

### 8. Confirmação contra dado real (2026-08-26, mesmo dia — `CS-35` fechado, `CS-36` respondido com uma reviravolta)

O mantenedor repetiu o teste de dois browsers (mesmo cofre real, ~26,5 mil transações) e enviou o
resultado com uma única frase: **"Ficou MUITO mais rápido."** Os números confirmam isso sem
ambiguidade:

| Métrica | Antes (`CS-34` já aplicado, `CS-35` não) | Depois (`CS-35`+`CS-36` aplicados) |
|---|---|---|
| `sync.runPeerSync.total` (Chrome) | 31.247ms | **12.880,7ms** (~2,4x) |
| `sync.runPeerSync.total` (Firefox) | 31.236ms | **9.794ms** (~3,2x) |
| Gap `runPeerSync.total` − `pullAndMerge.total` (Chrome) | 9.789,6ms | **277,4ms** |
| Gap `runPeerSync.total` − `pullAndMerge.total` (Firefox) | 7.558ms | **294ms** |

**`CS-35` está confirmado, não só "correto por leitura de código":** o gap que media exatamente a
releitura redundante do cofre local caiu de segundos para bem abaixo de meio segundo nos dois
browsers — a causa raiz identificada (o `SyncResult` descartando o `DataFile` já calculado) era
mesmo a explicação certa, e a correção elimina o custo por completo, não só reduz.

**`CS-36` respondeu a pergunta que motivou sua criação — mas com uma reviravolta interessante,
ainda não totalmente fechada:**

- **Firefox** (pulling o `.db` que o Chrome tinha acabado de subir ao Drive, contendo 1 transação
  nova desde a última convergência entre os dois dispositivos): `yearsSkipped: 19` de
  `yearsTotal: 20` — só o ano da transação nova precisou ser lido de fato. `worker.readPeer` caiu
  para **756ms**. Isto é a confirmação positiva que faltava: **o hash-skip da Fase 2b funciona
  exatamente como desenhado no caso comum** (poucas linhas mudaram desde o último sync).
- **Chrome** (pulling o Drive no início da mesma rodada): `yearsSkipped: 0` de `yearsTotal: 20` —
  nenhum ano bateu hash, apesar do cofre já estar (supostamente) convergido com o do Firefox nas
  rodadas anteriores desta mesma sessão de testes.

**Hipótese líder para o "0 de 20" do Chrome, formulada mas *não confirmada com o mantenedor*:**
`scripts/sync_gimbo.py` carimba `updated_at = timestamp do momento em que o script roda` em
**toda** transação, a cada execução — decisão de projeto deliberada e documentada no próprio
script (comentário "B-32": é a chave LWW do merge multi-dispositivo, então precisa refletir "um
snapshot novo chegou", não "o conteúdo financeiro mudou"). Consequência direta, não-óbvia: **dois
arquivos `.db` gerados por duas execuções separadas do script carregam `updated_at` diferente em
literalmente toda transação, mesmo que o conteúdo financeiro subjacente (valor, data, descrição)
seja idêntico** — porque o hash de cada linha (`transactionRowKey`) inclui `updatedAt`. Se o `.db`
usado para semear o Chrome nesta rodada de teste veio de uma corrida do script diferente da que
gerou o `.db` que o Firefox tem, **o hash diverge de verdade, para cada ano, e isso é o
comportamento correto do hash-skip** (dado realmente diferente não deveria ser pulado) — não um
bug no mecanismo, e sim um artefato de como o fixture real foi (re)gerado/reimportado entre
rodadas de teste. Isso é coerente com o próprio procedimento de reteste que o mantenedor descreveu
em sessões anteriores (importar um `.db` "fresco" a cada rodada para reiniciar o estado de um dos
lados).

**Isto ainda não foi verificado com o mantenedor — é a pergunta mais importante em aberto agora:**
se ele confirmar que o `.db` do Chrome nesta rodada veio de uma corrida diferente do
`sync_gimbo.py` (ou de qualquer outra fonte com `updated_at` recalculado) do que o do Firefox, o
`CS-36` fecha como "telemetria fez seu trabalho, hash-skip validado, sem bug" — só uma nota de
metodologia de teste a registrar. Se ele confirmar que os dois lados deveriam ter exatamente os
mesmos `updated_at` nesta rodada (mesmo fixture, sem reimportação no meio), então o "0 de 20" é a
**primeira evidência real de um bug genuíno no hash-skip**, e merece investigação dedicada
(possivelmente relacionada ao `fileCreatedAt` usado como fallback de normalização em
`backfillTableHashesIfNeeded`/`refreshSmallTableHashes` — ver `merge.ts`: `mergeForSync` nunca
sincroniza `settings.fileCreatedAt` entre dispositivos, só `fileUpdatedAt`, então dois vaults que
não nasceram do mesmo arquivo literal podem ter `fileCreatedAt` diferente para sempre — um segundo
candidato a causa raiz, não descartado).

Ambos os documentos técnicos (`BACKLOG.md` CS-35/CS-36, `MONITORING.md`, `CLAUDE.md`) já foram
atualizados com esses números antes desta seção ser escrita.

### 9. Fio solto real, agora (final desta atualização)

Dois pontos genuinamente em aberto para quem continuar a partir daqui:

1. **A abordagem alternativa que o mantenedor pensou durante a noite (§7) ainda não foi
   compartilhada.** Perguntar antes de assumir que o caminho é só "seguir refinando a Fase 2".
2. **Confirmar com o mantenedor a origem do `.db` usado para semear o Chrome nesta última rodada**
   (§8) — essa resposta sozinha decide se `CS-36` fecha como "confirmado, sem bug" ou reabre como
   "bug real a investigar", e qual das duas não pode ser adivinhada, só perguntada ou verificada
   inspecionando o `fileCreatedAt`/`updated_at` reais dos dois cofres.
3. Não reabrir o leque de alternativas já descartado no §1 acima (servidor de sync próprio) sem um
   motivo novo e explícito — foi uma decisão de produto deliberada, não uma pendência técnica.
