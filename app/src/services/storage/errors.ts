// SEC-05/SEC-06 — marcadores de erro que atravessam a fronteira do Web Worker.
//
// O protocolo do worker serializa erros com `String(err)` (ver o `catch` do message handler em
// `worker.ts`), então o único canal disponível é a mensagem. Estes prefixos existem para que o
// lado da UI distingua "arquivo de uma versão mais nova do app" de "arquivo corrompido" sem
// depender de `instanceof`, que não sobrevive ao `postMessage`.
//
// Ficam num módulo próprio, e não em `StorageService.ts`, porque o `worker.ts` também precisa
// deles — importar o StorageService de dentro do worker criaria um ciclo (o StorageService é
// quem instancia o worker).

/** O `.db` declara um `PRAGMA user_version` maior do que este build sabe migrar. */
export const ERR_SCHEMA_TOO_NEW = 'GIMBO_SCHEMA_TOO_NEW'

/** O `.db` não abre, não migra, ou abre mas não contém um DataFile legível. */
export const ERR_DB_UNREADABLE = 'GIMBO_DB_UNREADABLE'

/** True quando a mensagem de erro vinda do worker carrega o marcador dado. */
export function hasErrorMarker(err: unknown, marker: string): boolean {
  return String(err instanceof Error ? err.message : err).includes(marker)
}
