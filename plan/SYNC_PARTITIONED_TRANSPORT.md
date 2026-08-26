# Proposta: Transporte Particionado para Sync Remoto (pré-Plan Mode)

> **Status:** proposta revisada, pronta para virar um plano formal via Plan Mode — recomendado
> fazer isso numa sessão/branch nova (`dassan/sync-partitioned-transport` ou similar), não na
> branch `dassan/sync-drive-fixes` que fechou o ciclo `CS-30` a `CS-36`. Este documento é o
> hand-off entre as duas.
>
> **Origem:** proposta original do mantenedor (2026-08-26), avaliada em sessão de chat (não
> registrada linha a linha aqui — ver `SYNC_SCENARIOS.md` Parte 4 para o diário completo da sessão
> que motivou isso). Dois pontos de avaliação foram resolvidos por decisão explícita do mantenedor
> e estão incorporados abaixo; os demais seguem como perguntas em aberto para o Plan Mode.

## Motivação (recapitulando o porquê)

`CS-30`/`CS-35` (Fase 1) otimizaram o custo de **escrever** o resultado do merge localmente.
`CS-32`/`CS-33`/`CS-36` (Fase 2) otimizaram o custo de **ler/parsear** o `.db` do peer já baixado.
Nenhuma das duas toca o custo de **transferir** o `gimbo.db` inteiro (hoje ~13-15MB) pela rede a
cada sync — confirmado por um teste real em 5G onde o sync continuou lento mesmo com as duas fases
aplicadas, e a suspeita é de que agora o gargalo é majoritariamente bytes na rede, não computação
local. O `gimbo.db` nasceu como formato de **backup** (artefato sólido, único, atômico) e está
sendo reaproveitado como unidade de **transporte de sync** — são necessidades diferentes; a
proposta original identificou isso corretamente ("quadrado" vs. "círculo").

## Os dois pontos resolvidos nesta rodada

### 1. Escritor único por arquivo — mantido como já está na Fase 1

A proposta original tinha **um arquivo por tabela para o cofre inteiro** (`accounts.db`,
`transactions/2026-08.db`, um só, compartilhado entre todos os dispositivos). Isso reintroduz — um
nível acima — exatamente o problema que a Fase 1 eliminou por construção: dois dispositivos
escrevendo o mesmo arquivo. **Decisão: manter o princípio já implementado e validado da Fase 1**
("cada dispositivo escreve exclusivamente o seu próprio arquivo") e estendê-lo, não substituí-lo.

Isso resolve o problema por composição, não por mecanismo novo: em vez de **um** `device-<uuid>.db`
por dispositivo (hoje), cada dispositivo passa a publicar **sua própria árvore de arquivos
particionados**, continuando dono exclusivo dela:

```
Gimbo/
  device-a1b2c3/                    ← escrito SÓ pelo dispositivo a1b2c3
    manifest.json                   ← publicado por ÚLTIMO (ver "atomicidade" abaixo)
    accounts.db
    categories.db
    tags.db
    budgets.db
    valuations.db
    saved_periods.db
    audit_log.db
    deleted_ids.db
    transactions/
      2026-08.db                    ← ou granularidade a decidir no Plan Mode, ver Ponto 5
      2026-07.db
      ...
  device-d4e5f6/                    ← escrito SÓ pelo dispositivo d4e5f6
    manifest.json
    ...
```

Nenhum arquivo tem dois escritores possíveis — o mesmo invariante de sempre, só que granular. Um
leitor (outro dispositivo) nunca escreve na árvore de outro; ele só lê, decide (via o
`manifest.json` daquele peer, o equivalente remoto do `table_hashes` local) quais partições
daquele peer específico já conhece vs. quais mudaram desde o último sync com *aquele peer*, baixa
só as que mudaram, e alimenta o resultado no `mergeForSync()` — exatamente como hoje, só que a
etapa "baixar o `.db` do peer" deixa de ser monolítica.

**Atomicidade por dispositivo (reaproveita `S-20`):** cada dispositivo sobe suas próprias partições
alteradas primeiro e o `manifest.json` **por último** — o manifesto funciona como o "commit" desse
dispositivo. Um leitor que baixa o manifesto de um peer confia cegamente que todo arquivo que ele
lista já está lá; se a conexão cair no meio do upload das partições, o manifesto antigo continua
valendo (nunca aponta pra um arquivo que ainda não terminou de subir) e a próxima tentativa de sync
desse dispositivo resolve sozinha, sem lock nem coordenação entre dispositivos.

**Por que isso é melhor que inventar um mecanismo de concorrência novo:** a proposta original
tentava resolver concorrência via comparação de versão + retry no `index.json` compartilhado — um
compare-and-swap distribuído que a API do Drive não oferece nativamente (não há `If-Match`
confiável em `files.update` como teria um S3). Com escritor único por árvore, **não existe
concorrência a resolver**: cada dispositivo só decide sozinho quando publicar seu próprio manifesto,
sem nunca competir com ninguém pelo mesmo arquivo.

### 2. Resolução de conflito — mantém o motor de merge (LWW por `updatedAt`), não "local sempre vence"

A proposta original definia "a edição local prevalece sobre a remota" como regra de colisão. Isso
contradiz e é estritamente pior que o motor de merge já validado (`merge.ts`, `CS-05`): união por
`id` + **último `updatedAt` vence**, testado e em produção desde a Fase 0. "Local sempre vence"
erraria exatamente no caso que o LWW existe para resolver — duas edições reais na mesma entidade,
uma mais nova que a outra, em dispositivos diferentes.

**Decisão: o transporte particionado não muda a semântica de merge, só a forma de buscar os dados
de entrada para ela.** `mergeForSync(local, remote)` continua recebendo um `DataFile`-equivalente
"do peer" como hoje — a única diferença é que esse `DataFile` do peer agora é **reconstruído a
partir de partições baixadas seletivamente** (algumas frescas desta sincronização, outras
reaproveitadas do cache da sincronização anterior com esse mesmo peer, quando o hash não mudou) em
vez de vir de um único blob baixado por inteiro. Com escritor único por arquivo (Ponto 1), o
"conflito de escrita" que a proposta original tentava resolver no nível do transporte simplesmente
não existe mais nesse nível — o único lugar onde duas edições concorrentes de fato se encontram
continua sendo dentro do `mergeForSync`, exatamente como hoje.

## O que fica para o Plan Mode resolver (não decidido ainda)

Os demais pontos levantados na avaliação seguem em aberto — não bloqueiam o desenho acima, mas
precisam de decisão/pesquisa antes da implementação:

- **Tabelas de junção** (`transaction_tags`, `transaction_budgets`) não têm partição própria hoje.
  Opção mais simples: embutir as linhas relevantes no mesmo arquivo `transactions/<período>.db` da
  transação a que pertencem (cada partição de período já teria que carregar isso de qualquer
  forma, senão uma transação chega sem tags/caixinhas).
- **Granularidade de `transactions`:** a proposta original usa mês; o hash local (`table_hashes`,
  `CS-32`) usa ano. Decidir se os dois passam a usar a mesma granularidade (mais simples de
  raciocinar, mas potencialmente mais chamadas à API pro caso comum) ou se ficam desalinhados de
  propósito (local mais grosso, ganho de I/O local; remoto mais fino, ganho de banda — exige uma
  camada de tradução entre as duas).
- **Formato do manifesto/hash remoto:** a proposta original usa um `.db` SQLite
  (`table_hashes.db`) para isso. Avaliar se compensa o custo de abrir mais uma instância wa-sqlite
  a partir de bytes de rede pra um payload que é essencialmente um mapa pequeno — um JSON simples
  (como o próprio `index.json`/`manifest.json` já seria) é mais barato e mais transparente pro
  usuário que abrir a pasta no Drive.
- **Achatamento de diretórios:** uma pasta por tabela pequena (`accounts/accounts.db`) dobra
  `findFolderId`+`findFileId` por tabela sem necessidade — considerar arquivos direto na raiz da
  árvore do dispositivo (`accounts.db` sem subpasta), reservando subpastas só onde há de fato
  múltiplos arquivos (`transactions/`).
- **Orçamento de chamadas à API:** o desenho final precisa de uma estimativa de quantas chamadas
  Drive um sync "comum" (poucas partições realmente mudaram) vai gastar, e validar contra conexões
  de alta latência (o teste em 5G que motivou toda essa proposta) — existe risco real de trocar
  "poucos bytes, muitas chamadas" por algo pior que "muitos bytes, poucas chamadas" dependendo da
  rede, dado o achado do `CS-27` (uma única chamada de metadados já variou de 0,4s a 9,2s).
- **Migração/coexistência:** dispositivos ainda no transporte atual (Fase 2, um `gimbo.db` só por
  usuário) precisam continuar funcionando enquanto a transição acontece — decidir se o novo
  transporte substitui `Gimbo/gimbo.db` ou convive com ele por um período, e o que um dispositivo
  "antigo" vê ao abrir a mesma pasta.
- **Integridade de transferência:** a proposta original menciona `index.json` como controle de
  integridade mas não detalha o mecanismo (checksum por arquivo? contagem de bytes?) — precisa de
  especificação antes de virar plano.

## Arquivos centrais prováveis (para o Explore inicial do Plan Mode)

- `app/src/lib/cloudSync/googleDrive.ts` / `provider.ts` (`CloudProvider` — hoje pensado pra um
  arquivo só; provavelmente precisa de operações novas: listar/ler/escrever dentro de uma subpasta
  por dispositivo)
- `app/src/lib/cloudSync/folderProvider.ts` / `folderSyncService.ts` (Fase 1 — já implementa
  "escritor único por arquivo", é a referência de design mais próxima do que se quer estender)
- `app/src/services/storage/worker.ts` (`readDataFileFromDbSelective`, `table_hashes` — a lógica de
  decisão "o que divergiu" já existe localmente; a pergunta é como expô-la/espelhá-la num manifesto
  remoto sem duplicar a fonte de verdade)
- `app/src/lib/cloudSync/merge.ts` (não deveria precisar mudar — ver Ponto 2 acima)
