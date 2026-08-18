# FABLE-BRAINSTORM — Alternativas de Sincronização Multi-Dispositivo

> Documento de brainstorm arquitetural (2026-07-24). Não é uma spec — é uma análise de
> alternativas com trade-offs, para subsidiar a decisão do épico CS (F-28 Nível 2).
> Baseado em `ARCHITECTURE.md`, `SYNC_SCENARIOS.md` e `BACKLOG.md` (CS-01..CS-12).
>
> **Nota (2026-08-18):** a análise abaixo (§1-§9) e a recomendação faseada continuam válidas como
> registro histórico da decisão — mas a "sincronização entre dispositivos" que a §1 descreve como
> não resolvida **já está resolvida hoje**: Fase 1 (multi-desktop via pasta compartilhada) e Fase 2
> (Google Drive, incluindo mobile) foram implementadas e validadas em produção em 2026-07-24 e
> 2026-07-25 respectivamente. Só a Fase 3 (Dropbox) segue em aberto. Ver `CLAUDE.md` para o
> roadmap com status atualizado.

---

## 1. Contexto e Problema

O Gimbo é local-first: `gimbo.db` (SQLite/OPFS) é a fonte de verdade, sem servidor, sem nuvem.
O backup está resolvido em dois níveis (Nível 0: OPFS; Nível 1: pasta local via FSA, que o
usuário pode apontar para dentro do Drive/Dropbox desktop). O que **não** está resolvido é a
**sincronização entre dispositivos** — e o Nível 1 explicitamente não resolve isso: dois
dispositivos escrevendo o mesmo `.db` numa pasta sincronizada geram cópia em conflito silenciosa
(`gimbo-backup (1).db`), como já documentado em `SYNC_SCENARIOS.md` (Nota Técnica S-07+).

A proposta atual (Nível 2, CS-01..CS-12) usa a API do Google Drive/Dropbox com OAuth2 PKCE.
A preocupação levantada: **"parece muito complexa para um usuário médio"**. Este documento
examina essa premissa e mapeia o espaço de alternativas, incluindo a ideia de um mini-backend
de sync self-hosted.

### Uma correção de premissa importante

A complexidade do OAuth é quase toda **do lado do desenvolvedor**, não do usuário. Para o
usuário, o fluxo é: clicar "Conectar Google Drive" → tela de consentimento do Google → pronto.
São dois cliques — é o mesmo fluxo de "Login com Google" que qualquer usuário médio já conhece.
O que é complexo (e caro) é:

- O processo de **verificação do app no Google** (revisão da tela de consentimento, prazo
  incerto, exigências de política de privacidade, re-verificação periódica) — já identificado
  como pré-requisito do CS-01.
- A manutenção de **dois providers** (Drive + Dropbox), cada um com sua API, seus limites de
  rate e suas quebras de contrato ao longo dos anos.
- O ciclo de vida de tokens no browser (refresh, expiração, revogação — S-15).

Ou seja: o problema real do Nível 2 não é UX do usuário médio — é **custo de engenharia e
dependência de gatekeepers** (Google pode recusar/revogar a verificação a qualquer momento).
Isso muda o peso relativo das alternativas abaixo.

### O gargalo real: mobile

No desktop (Chrome/Edge), o Nível 1 + cliente Drive/Dropbox já cobre backup e quase-sync.
O cenário que força uma solução de verdade é o **mobile PWA**: não há File System Access API
em mobile, não há cliente de sync de nuvem com pasta local acessível — a única forma de um
celular participar do sync é via **rede** (API de nuvem, backend, ou P2P). Qualquer alternativa
que não funcione no mobile não resolve o problema enunciado.

---

## 2. Restrições Invioláveis (herdadas do produto)

1. **Privacidade**: nenhum terceiro (incluindo o Gimbo) pode ler os dados financeiros. Se dados
   transitarem por infraestrutura de terceiros, devem estar cifrados no cliente (E2EE).
2. **Local-first**: o app funciona 100% offline; sync é camada opcional por cima (S-12).
3. **Dados pertencem ao usuário**: exportáveis, deletáveis, em formato aberto.
4. **Zero servidor obrigatório do Gimbo**: pode existir serviço *opcional*, nunca dependência.
5. **PWA no browser**: sem processos em background, sem daemon — sync só acontece com o app
   aberto. Isso descarta modelos tipo Syncthing puro.

---

## 3. Insight Central: Motor de Merge ≠ Transporte

Toda alternativa de sync se decompõe em duas camadas ortogonais:

| Camada | Pergunta que responde | Exemplos |
|--------|----------------------|----------|
| **Motor de merge** | Como dois estados divergentes viram um só? | Merge aditivo por UUID + LWW (`updatedAt`) + tombstones (`deletedIds`); CRDTs; oplog |
| **Transporte** | Como os bytes chegam de A a B? | API Drive/Dropbox, WebDAV, backend self-hosted, pasta sincronizada, WebRTC |

O plano atual (CS-04/CS-05/CS-06) já reconhece isso parcialmente com a interface `CloudProvider
{ upload, download, getMetadata, isConnected }`. A decisão estratégica correta é **investir no
motor de merge uma única vez** (ele é o mesmo em quase todas as alternativas) e tratar o
transporte como plugável. Assim, a escolha de transporte deixa de ser uma aposta única e vira
um cardápio: cada usuário usa o que já tem.

O merge aditivo por UUID + LWW já especificado em S-11 é adequado para o modelo de dados do
Gimbo (entidades com UUID, mutações raras e de baixa concorrência real — uma pessoa, dois
dispositivos, não edição colaborativa). CRDTs completos (ver Alternativa G) seriam
over-engineering para este perfil de conflito.

---

## 4. Alternativas

### A. APIs de nuvem do usuário — Drive/Dropbox via OAuth PKCE (plano atual, CS-01..12)

O Drive do usuário como camada de sync, `Gimbo/gimbo.db` como fonte compartilhada, pull no
startup, push debounced, merge aditivo.

- **Prós**: zero infraestrutura Gimbo; usuário médio já tem conta Google; UX de conexão em
  2 cliques; dados na nuvem *do usuário*; funciona em mobile (é só HTTP).
- **Contras**: verificação OAuth do Google é um processo pesado, recorrente e revogável;
  dois providers = dobro de manutenção; arquivo binário visível na pasta do usuário (risco de
  deleção acidental, já mapeado); upload do `.db` inteiro a cada push (não incremental);
  o conteúdo fica legível para o provedor de nuvem, a menos que se adicione cifragem
  client-side (ver §6).
- **Custo**: médio-alto (a maior parte no processo Google, não no código).
- **Veredito**: viável e já bem especificado, mas a dependência do processo de verificação do
  Google é o maior risco do plano — vale ter um plano B de transporte antes de começar.

### B. Pasta sincronizada + oplog por dispositivo (evolução do Nível 1)

Em vez de cada dispositivo escrever **o mesmo** `gimbo-backup.db` (que gera conflito), cada
dispositivo escreve **seu próprio arquivo** na pasta: um snapshot `device-<uuid>.db` ou um
changelog append-only `device-<uuid>.jsonl`. O cliente Drive/Dropbox replica os arquivos sem
nunca ver escrita concorrente no mesmo arquivo (cada arquivo tem um único escritor — elimina
por construção a cópia-em-conflito). No startup, o Gimbo lê os arquivos dos *outros*
dispositivos presentes na pasta e aplica o mesmo merge aditivo de S-11.

- **Prós**: **zero OAuth, zero backend, zero verificação do Google**; reusa toda a
  infraestrutura BK-01..08 (`backupDir.ts`, permissões, banner de reconexão); funciona com
  qualquer provedor que tenha cliente desktop (Drive, Dropbox, OneDrive, Syncthing, Nextcloud);
  o motor de merge é o mesmo do plano CS; incremental de verdade se usar oplog.
- **Contras**: **não funciona no mobile** (sem FSA) — resolve apenas multi-desktop;
  latência de sync depende do cliente de nuvem (segundos a minutos); exige lógica de
  compactação do oplog e de "garbage collection" de dispositivos abandonados.
- **Custo**: baixo (é o Nível 1 + motor de merge, sem nenhum transporte novo).
- **Veredito**: melhor custo-benefício para o caso multi-desktop; **não substitui** uma
  solução para mobile, mas entrega valor imediato e o motor de merge construído aqui é
  100% reutilizado depois. Forte candidato a primeiro passo.

### C. WebDAV / Nextcloud (padrão aberto, sem gatekeeper)

Transporte via WebDAV: o usuário informa URL + usuário + senha (ou app-password). Cobre
Nextcloud, ownCloud, Koofr, Fastmail, NAS domésticos (Synology/QNAP) e dezenas de provedores.
É o modelo do Joplin e do DAVx⁵ — consagrado no nicho de usuários que se importam com
privacidade (exatamente o público do Gimbo).

- **Prós**: **sem OAuth, sem verificação, sem SDK proprietário** — é HTTP com verbos extras;
  um único código cobre N provedores; funciona em mobile; alinhamento filosófico perfeito
  com o público local-first/self-host.
- **Contras**: usuário médio brasileiro não tem WebDAV (Google Drive não expõe WebDAV) — é
  uma opção de *power user*; CORS pode bloquear chamadas diretas do browser a servidores
  WebDAV de terceiros (Nextcloud próprio resolve com config; provedores comerciais variam) —
  este é o risco técnico nº 1 a validar num spike.
- **Custo**: baixo-médio.
- **Veredito**: excelente segundo transporte. Não serve como *único* caminho por não cobrir
  o usuário médio, mas atende o público self-host **sem** o Gimbo precisar manter um backend.

### D. Mini-backend de sync self-hosted (a proposta em análise)

Um servidor mínimo (um binário/container: endpoints `push`, `pull`, `metadata` + auth simples)
que o usuário roda em casa (NAS, Raspberry Pi) ou num PaaS. Modelo Actual Budget /
Vaultwardern: o projeto publica a imagem, a comunidade self-hosta.

- **Prós**: independência total de gatekeepers; funciona em mobile; permite sync incremental
  eficiente e até features futuras (múltiplos cofres, histórico de versões); com E2EE no
  cliente, o servidor é burro e o modelo de confiança permanece intacto.
- **Contras**: **o usuário médio não roda Docker** — quem citou complexidade no OAuth deveria
  descartar self-host para mainstream *a fortiori*: exige domínio ou DynDNS, TLS, porta
  exposta, backup do servidor, atualizações. A experiência do Actual Budget confirma: o
  público self-host é entusiasta, não médio. Além disso, cria uma superfície nova de
  segurança (um servidor de dados financeiros exposto à internet, mantido por amador).
- **Custo**: médio no servidor (é pequeno mesmo), mas **alto em suporte** — issues de
  infraestrutura do usuário viram carga do projeto (proxy reverso, certificados, CORS...).
- **Veredito**: não é a resposta para o usuário médio — é a resposta para o entusiasta que
  hoje já rodaria Nextcloud. E para esse entusiasta, a Alternativa C (WebDAV) entrega quase o
  mesmo resultado **sem o Gimbo escrever nem manter servidor nenhum**. Só faz sentido se, no
  futuro, o protocolo precisar de algo que WebDAV não dá (locking, notificação push, deltas
  server-side).

### E. Serviço de sync gerenciado pelo Gimbo, zero-knowledge (E2EE)

Sync como serviço opcional hospedado pelo projeto, com cifragem client-side: o servidor só vê
blobs cifrados (modelo Obsidian Sync / Bitwarden / ente.io). Chave derivada de passphrase do
usuário, nunca enviada.

- **Prós**: **a melhor UX possível para o usuário médio** (criar conta → digitar passphrase →
  sincronizado, em qualquer dispositivo); privacidade preservada criptograficamente, não por
  promessa; potencial fonte de sustentabilidade do projeto (assinatura).
- **Contras**: viola o espírito (não a letra) do "sem servidor Gimbo" — passa a existir
  infraestrutura, custo mensal, uptime, LGPD, e a responsabilidade de guardar dados (ainda que
  cifrados) de terceiros; recuperação de conta impossível por design (perdeu a passphrase,
  perdeu o sync — não os dados locais); esforço de operação permanente é incompatível com um
  projeto de uma pessoa, hoje.
- **Custo**: alto (não pelo código — pela operação contínua).
- **Veredito**: guardar como opção de longo prazo, *demand-driven*, e só se o projeto
  ganhar tração/receita. Não é o próximo passo.

### F. P2P direto entre dispositivos (WebRTC / rede local)

Dispositivos pareiam por QR code e sincronizam diretamente, sem storage intermediário
(WebRTC DataChannel; signaling mínimo ou manual).

- **Prós**: privacidade máxima (dados nunca saem dos dispositivos); zero storage de terceiros.
- **Contras**: **exige os dois dispositivos online simultaneamente com o app aberto** — em
  PWA, sem background sync confiável, isso degrada a UX a "abra os dois e espere"; NAT
  traversal sem servidor TURN falha em redes reais; não dá backup de graça (o storage
  intermediário das alternativas A–E é também um backup off-device).
- **Custo**: alto para uma UX frágil.
- **Veredito**: descartar como mecanismo principal. Eventualmente interessante como
  "transferência rápida para dispositivo novo" (S-10 sem nuvem), não como sync contínuo.

### G. Motor CRDT (cr-sqlite, Automerge) em vez de merge aditivo próprio

Substituir o merge S-11 por CRDTs: cada mutação vira operação comutativa; qualquer transporte
(inclusive os acima) carrega as operações; convergência garantida matematicamente.

- **Prós**: convergência provada; sync incremental natural (só operações novas); resolveria
  edição concorrente do mesmo campo com semântica melhor que LWW.
- **Contras**: `cr-sqlite` implicaria trocar/instrumentar a camada wa-sqlite (risco alto numa
  base estável com ~97% de cobertura); Automerge duplicaria o modelo de dados fora do SQLite;
  o perfil de conflito real do Gimbo (1 usuário, concorrência rara, entidades independentes
  por UUID) não exige essa maquinaria — LWW + union + tombstones cobre os cenários S-08..S-15.
- **Veredito**: complexidade desproporcional ao problema. Manter merge próprio, simples e
  testável (CS-05). Reavaliar apenas se surgirem requisitos de colaboração real (cofre
  compartilhado entre duas pessoas, por exemplo — hoje fora de escopo).

---

## 5. Matriz Comparativa

| Critério | A. Drive/Dropbox API | B. Pasta + oplog | C. WebDAV | D. Self-hosted | E. Gimbo E2EE | F. P2P |
|---|---|---|---|---|---|---|
| UX usuário médio | ★★★★ | ★★★ (já configura hoje) | ★★ | ★ | ★★★★★ | ★★ |
| Cobre mobile PWA | ✅ | ❌ | ✅ | ✅ | ✅ | ⚠️ frágil |
| Esforço de eng. inicial | Alto | **Baixo** | Médio | Médio | Alto | Alto |
| Manutenção/operação | Média (2 APIs + reviews) | **Baixa** | Baixa | Alta (suporte) | Alta (infra) | Alta |
| Dependência de gatekeeper | **Alta (Google review)** | Nenhuma | Nenhuma | Nenhuma | Nenhuma | Nenhuma |
| Privacidade sem E2EE extra | Provedor lê o `.db` | Provedor lê o `.db` | Depende do servidor | Total (casa do usuário) | N/A (E2EE nativo) | Total |
| Backup off-device incluso | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Reuso do motor de merge CS-05 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 6. Nota Transversal — Cifragem Client-Side

Hoje o Nível 1 já entrega o `.db` **em claro** ao Drive/Dropbox do usuário (o provedor pode
lê-lo). Se a premissa de privacidade for levada ao limite, qualquer transporte por terceiros
(A, B, C) deveria cifrar o blob no cliente antes do upload (WebCrypto: AES-GCM, chave derivada
de passphrase via PBKDF2/Argon2). Trade-offs: perde-se a legibilidade do backup pelo próprio
usuário (o `.db` deixa de ser importável sem o app + passphrase) e cria-se o risco de perda da
passphrase. Sugestão: **opcional, off por default** no backup (Nível 1), reavaliar como default
no sync (Nível 2). Decidir antes do CS-03, pois muda o formato do arquivo remoto.

---

## 7. Recomendação (faseada)

A estratégia de menor risco não é escolher *um* transporte — é construir o motor uma vez e
liberar transportes por ordem de custo-benefício:

**Fase 0 — Motor de merge (pré-requisito universal).**
`updatedAt` nas entidades mutáveis (CS-04) + `merge.ts` puro e exaustivamente testado (CS-05,
CS-10). Nenhuma linha de transporte ainda. Tudo o que vier depois depende disso e nada disso
é descartável.

**Fase 1 — Alternativa B: pasta sincronizada + arquivo por dispositivo.**
Resolve multi-desktop agora, com custo baixo, zero gatekeeper, reusando BK-01..08. De quebra,
elimina o pior footgun documentado hoje (cópia-em-conflito silenciosa do Nível 1 usado em dois
desktops). Entregável típico: `device-<uuid>.db` por dispositivo + merge no startup.

**Fase 2 — Mobile: Alternativa A (Drive primeiro, Dropbox depois — CS-12 como está).**
*(Decidido em 2026-07-24: WebDAV (Alternativa C) não entra agora — registrado como melhoria
futura no backlog, ver `M-65` em `BACKLOG.md`.)* O Drive API cobre o usuário médio e consome
o mesmo `merge.ts` e a mesma interface `CloudProvider` já planejada — o que mantém o WebDAV
implementável depois como mais um provider, sem retrofit.

**Fase 3 — demand-driven.** Serviço gerenciado E2EE (E) apenas se houver tração e modelo de
sustentação; mini-backend self-hosted (D) apenas se WebDAV se mostrar insuficiente para o
público entusiasta. P2P (F) e CRDT (G): fora do roadmap.

### Sobre a ideia do mini-backend, diretamente

A intuição de fugir das APIs de terceiros é boa — o risco do processo de verificação do Google
é real. Mas o self-hosted erra o público: ele troca "dois cliques de OAuth" (fácil para o
usuário médio, difícil para o dev) por "provisionar e manter um servidor" (impossível para o
usuário médio, ok para o entusiasta). Para o entusiasta, WebDAV/Nextcloud entrega o mesmo
resultado sem o projeto assumir um servidor para escrever, versionar e dar suporte. O
mini-backend só se justifica se um dia o protocolo exigir inteligência server-side — e nada
nos cenários S-08..S-15 exige.

---

## 8. Decisões Registradas (2026-07-24)

As questões em aberto da versão original deste documento foram decididas com o humano:

1. **WebDAV (Alternativa C): adiado.** Não entra no roadmap atual; registrado como melhoria
   futura (`M-65` em `BACKLOG.md`). A solução para mobile é a **Alternativa A** (Drive/Dropbox
   API, épico CS como planejado). O spike de CORS/WebDAV fica condicionado à eventual
   ativação do M-65.
2. **Verificação OAuth do Google: risco menor do que o assumido no CS-01.** O processo é
   **por app** (por projeto no Google Cloud Console), feito **uma única vez** pelo mantenedor —
   o usuário final não participa de verificação nenhuma (só consente em 2 cliques). Além
   disso, o escopo `drive.file` é classificado pelo Google como **não-sensível**: apps que
   usam apenas escopos não-sensíveis **não são obrigados a passar pela verificação completa**
   (o aviso "app não verificado" e a revisão pesada aplicam-se a escopos sensíveis/restritos;
   a avaliação de segurança anual, só a restritos como `drive` completo). Ressalvas: (a) em
   *publishing status* "Testing" o aviso aparece e há teto de usuários — é preciso publicar em
   "Production"; (b) exibir logo/nome verificado exige *brand verification* (leve); (c) validar
   na prática com um client_id de teste antes de dar o CS-01 por resolvido. A nota de 2026-07-11
   em `BACKLOG.md` (verificação como pré-requisito duro do CS-01) provavelmente está
   superdimensionada e pode ser revista.
3. **Formato do arquivo por dispositivo (Fase 1): snapshot `.db` completo** por dispositivo
   (`device-<uuid>.db`), reusando `exportBlob()`. Sem oplog/compactação.
4. **Cifragem client-side: opcional, off por padrão** (§6).
5. **Identidade de dispositivo: UUID persistido no OPFS** (junto ao `gimbo.db`), gerado no
   primeiro boot.

## 9. Questão Remanescente

1. **Telemetria de sync** (F-26): quais eventos de sync entram no ring buffer sem vazar
   metadados sensíveis? Proposta conservadora a validar: apenas eventos `action` com
   contadores agregados (`sync_merge`, `sync_push`, `sync_peer_skipped`, `sync_conflict_lww`
   + nº de entidades afetadas), nunca nomes de arquivos, `deviceId`, IDs de entidades ou
   valores — mesma regra de privacidade do `buildBugReportSnapshot`.
   **Registrada como `CS-20`** (seção Transversal do épico CS em `BACKLOG.md`); decidir ao
   iniciar CS-15 (Fase 1) ou CS-06 (Fase 2), o que vier primeiro.

---

## 10. Estado do Roadmap (2026-07-24)

O plano faseado da §7 foi desdobrado nos documentos de trabalho:

| Documento | O que recebeu |
|-----------|---------------|
| `BACKLOG.md` | Épico CS reestruturado em Fase 0/1/2/3 + seção Transversal; novos `CS-13` a `CS-20`; `CS-10` dividido em `CS-10a`/`CS-10b`; `CS-01` e `CS-03` revisados; `M-65` (WebDAV, adiado) |
| `SYNC_SCENARIOS.md` | Parte 2 nova (Fase 1, cenários `S-16` a `S-20`); Parte 3 (nuvem) renumerada; nota de verificação OAuth corrigida; Resumo de Políticas separado por fase |
| `SPEC.md` | Fase 16 — especificação técnica das Fases 0 e 1 (`TASK-CS-01` a `TASK-CS-08`) |
