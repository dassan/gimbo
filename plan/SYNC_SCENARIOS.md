# Sincronização — Cenários e Recuperação

> **Histórico:** O documento original descrevia a arquitetura de sync IndexedDB ↔ File System Access API + JSON,
> removida em 2026-05-26 em favor do SQLite/OPFS (veja decisão arquitetural em `ARCHITECTURE.md`).
> Este documento foi reescrito para cobrir: (1) os cenários atuais de armazenamento SQLite single-device e
> (2) a arquitetura planejada de sync multi-dispositivo via Google Drive / Dropbox (F-28).

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

## Parte 2 — Sync Multi-Dispositivo Planejado (F-28)

> **Status:** Planejado, não implementado. Especificação técnica a detalhar em `plan/SPEC.md` quando o épico CS for iniciado.
> Ver épico `CS` em `BACKLOG.md` para as tarefas.

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

| Situação | Comportamento |
|----------|---------------|
| OPFS vazio, sem cloud | Onboarding |
| OPFS vazio, cloud conectado | Pull do Drive → import → app pronto |
| OPFS com dados, cloud mais recente | Merge silencioso (pull + merge) |
| OPFS com dados, cloud igual | Nenhuma ação |
| Conflito de edição | Último `updatedAt` vence |
| Transação duplicada (offline em 2 devices) | Ambas sobrevivem; usuário remove manualmente |
| Deleção em qualquer device | `deletedIds` impede recuperação no merge |
| Arquivo cloud corrompido | Estado local preservado; push forçado após confirmação |
| Offline | App funciona normalmente; push ao reconectar |
