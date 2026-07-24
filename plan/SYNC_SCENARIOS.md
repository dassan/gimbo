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

> **Status:** Planejado, não implementado. Tarefas `CS-13` a `CS-17` em `BACKLOG.md`;
> especificação técnica na Fase 16 de `SPEC.md`.

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

> **Status:** Planejado, não implementado. Especificação técnica a detalhar em `plan/SPEC.md` quando o épico CS for iniciado.
> Ver épico `CS` em `BACKLOG.md` para as tarefas.
>
> **Esta é a fase que desbloqueia o mobile** — sem File System Access API, o PWA mobile só
> participa do sync por rede. A Fase 1 (Parte 2) resolve multi-desktop; esta resolve o resto.

### Princípio Arquitetural

O Google Drive (ou Dropbox) do usuário atua como **camada de sync**, não como servidor do Gimbo.
Os dados pertencem ao usuário, armazenados na conta de nuvem dele, em uma pasta `Gimbo/`.
O Gimbo acessa essa pasta via API (OAuth2 PKCE — sem backend, sem servidor próprio).

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
> - ~~**Verificação OAuth do Google é pré-requisito, não opcional.**~~ **Revisado (2026-07-24):** a premissa estava superdimensionada. O escopo `drive.file` é classificado pelo Google como **não-sensível**, e apps que usam apenas escopos não-sensíveis **não são obrigados** a passar pela verificação completa (revisão de tela de consentimento, vídeo de demonstração); a avaliação de segurança anual aplica-se apenas a escopos **restritos** (`drive` completo), que o Gimbo não usa. O processo é **por app, uma única vez**, feito pelo mantenedor — o usuário final nunca participa de verificação, apenas consente em 2 cliques. **Ressalvas reais que permanecem no `CS-01`:** (a) publicar o app em *publishing status* **"Production"** — em "Testing" o aviso "app não verificado" aparece e há teto de usuários; (b) *brand verification* (processo leve) se quisermos exibir logo/nome próprios na tela de consentimento; (c) validar tudo isso na prática com um client_id de teste antes de dar o `CS-01` por resolvido.
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
