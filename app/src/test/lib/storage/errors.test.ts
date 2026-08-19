import { describe, it, expect } from 'vitest'
import { ERR_DB_UNREADABLE, ERR_SCHEMA_TOO_NEW, hasErrorMarker } from '@/services/storage/errors'

// SEC-05/SEC-06 — o protocolo do worker serializa erros com `String(err)`, então `instanceof` não
// sobrevive ao `postMessage`. Estes testes fixam o contrato do qual a UI depende para distinguir
// "arquivo de versão mais nova" (atualize o app) de "arquivo corrompido" (procure outro backup).

describe('hasErrorMarker', () => {
  it('reconhece o marcador dentro de um Error real', () => {
    const err = new Error(`${ERR_SCHEMA_TOO_NEW}: banco na versão 99, este build migra até 12`)
    expect(hasErrorMarker(err, ERR_SCHEMA_TOO_NEW)).toBe(true)
  })

  it('reconhece o marcador numa string já serializada pelo worker', () => {
    // É esta a forma que de fato chega na UI: o worker devolve `String(err)`, que vira
    // "Error: GIMBO_SCHEMA_TOO_NEW: ..." e é relançada como Error pelo StorageService.
    const serialized = `Error: ${ERR_SCHEMA_TOO_NEW}: banco na versão 99`
    expect(hasErrorMarker(new Error(serialized), ERR_SCHEMA_TOO_NEW)).toBe(true)
    expect(hasErrorMarker(serialized, ERR_SCHEMA_TOO_NEW)).toBe(true)
  })

  it('não confunde os dois marcadores entre si', () => {
    const unreadable = new Error(`${ERR_DB_UNREADABLE}: o arquivo não contém dados do Gimbo`)
    expect(hasErrorMarker(unreadable, ERR_DB_UNREADABLE)).toBe(true)
    expect(hasErrorMarker(unreadable, ERR_SCHEMA_TOO_NEW)).toBe(false)
  })

  it('é falso para erros sem marcador algum', () => {
    expect(hasErrorMarker(new Error('falha de rede'), ERR_SCHEMA_TOO_NEW)).toBe(false)
    expect(hasErrorMarker(null, ERR_DB_UNREADABLE)).toBe(false)
    expect(hasErrorMarker(undefined, ERR_DB_UNREADABLE)).toBe(false)
  })

  it('os marcadores são distintos e não são prefixo um do outro', () => {
    expect(ERR_SCHEMA_TOO_NEW).not.toBe(ERR_DB_UNREADABLE)
    expect(ERR_SCHEMA_TOO_NEW.includes(ERR_DB_UNREADABLE)).toBe(false)
    expect(ERR_DB_UNREADABLE.includes(ERR_SCHEMA_TOO_NEW)).toBe(false)
  })
})
