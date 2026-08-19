import { test, expect } from '@playwright/test'

// SEC-04 — propriedades criptográficas reais do armazenamento de segredos.
//
// Os testes unitários de `googleAuth` mockam o `secretStore`, porque o jsdom não implementa
// IndexedDB — eles cobrem a lógica de auth, não a mecânica de cifragem. Estas asserções só fazem
// sentido num browser de verdade, com WebCrypto e IndexedDB reais, e são as que provam a afirmação
// central do item: o `refresh_token` não fica mais em texto claro em lugar nenhum.
//
// O módulo é alcançado por `window.__secretStore`, exposto apenas sob `import.meta.env.DEV`
// (mesmo padrão do `__storage`, e igualmente removido do build de produção).

const SENTINEL = 'REFRESH-TOKEN-SENTINELA-9f3a2b'

type Win = Record<string, unknown>

test.describe('SEC-04 — segredos cifrados em repouso', () => {
  test('o segredo faz round-trip, some do localStorage e fica cifrado no IndexedDB', async ({
    page,
  }) => {
    await page.goto('/onboarding')
    await page.waitForFunction(() => !!(window as Win).__secretStore)

    const result = await page.evaluate(async (sentinel) => {
      const store = (window as Win).__secretStore
      await store.putSecret('google_refresh_token', sentinel)

      const raw = (await store.__rawRecord('google_refresh_token')) as {
        iv: Uint8Array
        ciphertext: ArrayBuffer
      }

      // O ciphertext cru é o que um atacante leria ao abrir o IndexedDB. Comparação byte a byte
      // com o texto claro, e não só decodificação para string, para não depender de o resultado
      // ser UTF-8 válido.
      const cipherBytes = new Uint8Array(raw.ciphertext)
      const plainBytes = new TextEncoder().encode(sentinel)
      let containsPlaintext = false
      for (let i = 0; i + plainBytes.length <= cipherBytes.length; i++) {
        let match = true
        for (let j = 0; j < plainBytes.length; j++) {
          if (cipherBytes[i + j] !== plainBytes[j]) {
            match = false
            break
          }
        }
        if (match) {
          containsPlaintext = true
          break
        }
      }

      return {
        roundTrip: await store.getSecret('google_refresh_token'),
        inLocalStorage: JSON.stringify(localStorage).includes(sentinel),
        containsPlaintext,
        ivLength: raw.iv.length,
        cipherLength: cipherBytes.length,
      }
    }, SENTINEL)

    // Cifrar sem conseguir decifrar de volta seria uma "correção" que perde os dados do usuário.
    expect(result.roundTrip).toBe(SENTINEL)
    expect(result.inLocalStorage).toBe(false)
    expect(result.containsPlaintext).toBe(false)
    expect(result.ivLength).toBe(12) // AES-GCM: IV de 96 bits
    expect(result.cipherLength).toBeGreaterThan(0)
  })

  test('a chave de cifragem é não-extraível', async ({ page }) => {
    await page.goto('/onboarding')
    await page.waitForFunction(() => !!(window as Win).__secretStore)

    const key = await page.evaluate(async () => {
      const store = (window as Win).__secretStore
      // Força a criação da chave, se ainda não existir.
      await store.putSecret('probe', 'x')
      const cryptoKey = (await store.__rawRecord('__wrapping_key')) as CryptoKey

      let exportRejected = false
      try {
        await crypto.subtle.exportKey('raw', cryptoKey)
      } catch {
        exportRejected = true
      }
      return { extractable: cryptoKey.extractable, exportRejected, algorithm: cryptoKey.algorithm }
    })

    // As duas asserções são complementares: a flag descreve a intenção, o `exportKey` prova que o
    // browser a aplica. É isto que impede um payload genérico de levar a chave embora.
    expect(key.extractable).toBe(false)
    expect(key.exportRejected).toBe(true)
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 })
  })

  test('duas escritas do mesmo valor produzem ciphertexts diferentes (IV por escrita)', async ({
    page,
  }) => {
    await page.goto('/onboarding')
    await page.waitForFunction(() => !!(window as Win).__secretStore)

    const { first, second } = await page.evaluate(async (sentinel) => {
      const store = (window as Win).__secretStore
      const dump = async () => {
        const raw = (await store.__rawRecord('reuse_probe')) as { ciphertext: ArrayBuffer }
        return [...new Uint8Array(raw.ciphertext)].join(',')
      }
      await store.putSecret('reuse_probe', sentinel)
      const first = await dump()
      await store.putSecret('reuse_probe', sentinel)
      return { first, second: await dump() }
    }, SENTINEL)

    // Reusar IV em AES-GCM é uma falha crítica que vaza o plaintext. Ciphertexts idênticos para o
    // mesmo valor denunciariam isso.
    expect(first).not.toBe(second)
  })

  test('deleteSecret remove o registro de verdade', async ({ page }) => {
    await page.goto('/onboarding')
    await page.waitForFunction(() => !!(window as Win).__secretStore)

    const after = await page.evaluate(async (sentinel) => {
      const store = (window as Win).__secretStore
      await store.putSecret('google_refresh_token', sentinel)
      await store.deleteSecret('google_refresh_token')
      return {
        value: await store.getSecret('google_refresh_token'),
        raw: (await store.__rawRecord('google_refresh_token')) ?? null,
      }
    }, SENTINEL)

    expect(after.value).toBeNull()
    expect(after.raw).toBeNull()
  })
})
