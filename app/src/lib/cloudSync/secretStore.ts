// SEC-04 — armazenamento de segredos cifrado em repouso.
//
// O que isto resolve, e o que NÃO resolve — leia antes de confiar demais nesta camada:
//
// **Resolve:** o `refresh_token` do Google deixa de estar em texto claro no `localStorage`. Um
// payload genérico de coleta de credenciais — `JSON.stringify(localStorage)` enviado para um
// servidor, que é a forma dominante em comprometimento de dependência e em XSS oportunista — não
// leva mais nada de útil. A chave de cifragem é gerada com `extractable: false`, então nem ela
// pode ser serializada e levada embora: `crypto.subtle.exportKey()` lança sobre ela.
//
// **Não resolve:** um atacante que execute JS nesta origem e escreva código específico para o
// Gimbo ainda consegue pegar o handle da chave no IndexedDB, ler o ciphertext, chamar
// `crypto.subtle.decrypt()` e exfiltrar o texto claro. Chave não-extraível impede que a *chave*
// vaze, não que o *segredo decifrado* vaze. Isto é defesa em profundidade que encarece o ataque
// direcionado, não uma barreira contra ele — a barreira é a CSP (`SEC-03`), e o limite de dano é
// a expiração absoluta do refresh token (ver `googleAuth.ts`).
//
// Por que IndexedDB e não `localStorage`: só o IndexedDB preserva um objeto `CryptoKey` via
// structured clone. Em `localStorage` a chave teria que ser exportada para string — o que exigiria
// `extractable: true` e destruiria a única garantia real desta camada.

import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'gimbo-secrets'
const STORE_NAME = 'secrets'
const WRAPPING_KEY_ID = '__wrapping_key'

/** AES-GCM recomenda IV de 96 bits; gerado por escrita, nunca reutilizado. */
const IV_BYTES = 12

interface SealedSecret {
  // `Uint8Array<ArrayBuffer>` e não `Uint8Array`: desde o TS 5.7 o tipo é genérico no buffer, e o
  // `BufferSource` do WebCrypto recusa `ArrayBufferLike` (que admitiria SharedArrayBuffer).
  iv: Uint8Array<ArrayBuffer>
  ciphertext: ArrayBuffer
}

async function getDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE_NAME)
    },
  })
}

/**
 * Chave de cifragem do dispositivo, criada na primeira necessidade e reusada depois.
 *
 * `extractable: false` é o ponto inteiro deste módulo: o objeto vive no IndexedDB e pode ser usado
 * para cifrar/decifrar, mas o material bruto nunca é acessível a JS algum — nem ao nosso.
 */
async function getWrappingKey(db: IDBPDatabase): Promise<CryptoKey> {
  const existing = (await db.get(STORE_NAME, WRAPPING_KEY_ID)) as CryptoKey | undefined
  if (existing) return existing

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  await db.put(STORE_NAME, key, WRAPPING_KEY_ID)
  return key
}

/** Cifra e grava um segredo. Sobrescreve o valor anterior da mesma chave. */
export async function putSecret(name: string, value: string): Promise<void> {
  const db = await getDb()
  const key = await getWrappingKey(db)
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  // Cópia para um ArrayBuffer próprio: `TextEncoder.encode()` devolve `Uint8Array<ArrayBufferLike>`,
  // que o tipo `BufferSource` do WebCrypto não aceita (poderia ser SharedArrayBuffer).
  const data = new Uint8Array(new TextEncoder().encode(value)).buffer
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  await db.put(STORE_NAME, { iv, ciphertext } satisfies SealedSecret, name)
}

/**
 * Lê e decifra um segredo. Devolve null quando não existe — e também quando existe mas não
 * decifra, o que acontece se a chave do dispositivo for perdida (limpeza parcial de dados do
 * browser). Nesse caso o segredo é lixo irrecuperável, então tratá-lo como ausente é o
 * comportamento certo: o chamador segue para o caminho de "reconectar".
 */
export async function getSecret(name: string): Promise<string | null> {
  try {
    const db = await getDb()
    const sealed = (await db.get(STORE_NAME, name)) as SealedSecret | undefined
    if (!sealed) return null

    const key = await getWrappingKey(db)
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.iv },
      key,
      sealed.ciphertext
    )
    return new TextDecoder().decode(plaintext)
  } catch {
    return null
  }
}

/** Remove um segredo. Idempotente — apagar o que não existe não é erro. */
export async function deleteSecret(name: string): Promise<void> {
  try {
    const db = await getDb()
    await db.delete(STORE_NAME, name)
  } catch {
    // Store indisponível (modo privado, quota): não há segredo persistido para vazar de qualquer
    // forma, e falhar aqui abortaria um logout que precisa sempre concluir.
  }
}

// Exposição só em desenvolvimento, para o Playwright poder verificar as propriedades que um teste
// unitário não alcança: que o ciphertext no IndexedDB não contém o texto claro, e que a chave de
// cifragem é de fato não-extraível. Mesmo padrão do `__storage` em `services/storage/index.ts`, e
// como aquele, some do build de produção (verificado: `grep __storage dist/assets/*.js` → 0).
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__secretStore = {
    putSecret,
    getSecret,
    deleteSecret,
    /** Registro cru, sem decifrar — é o que um atacante veria ao abrir o IndexedDB. */
    async __rawRecord(name: string): Promise<unknown> {
      return (await getDb()).get(STORE_NAME, name)
    },
  }
}
