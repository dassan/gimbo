import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// HY-21 — o comportamento real (duas abas de verdade disputando um arquivo real do OPFS) é coberto
// por `e2e/vaultOwnership.spec.ts`, que é onde ele pode ser verificado. Aqui ficam as propriedades
// que um teste rápido consegue fixar e que já quebraram uma vez: idempotência sob o double-invoke
// do `<StrictMode>` e a degradação quando o navegador não tem as APIs.

type LockCallback = (lock: unknown) => unknown

class FakeLockManager {
  held = false
  private queue: (() => void)[] = []

  request(
    _name: string,
    options: { ifAvailable?: boolean },
    callback: LockCallback
  ): Promise<void> {
    if (this.held && options.ifAvailable) {
      callback(null)
      return Promise.resolve()
    }
    if (this.held) {
      return new Promise<void>((resolve) => {
        this.queue.push(() => {
          this.held = true
          void Promise.resolve(callback({})).then(() => this.releaseHeld())
          resolve()
        })
      })
    }
    this.held = true
    return Promise.resolve(callback({})).then(() => this.releaseHeld())
  }

  private releaseHeld() {
    this.held = false
    this.queue.shift()?.()
  }
}

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  closed = false
  readonly name: string
  constructor(name: string) {
    this.name = name
    FakeBroadcastChannel.instances.push(this)
  }
  postMessage(data: unknown) {
    for (const other of FakeBroadcastChannel.instances) {
      if (other !== this && !other.closed) other.onmessage?.({ data })
    }
  }
  close() {
    this.closed = true
  }
}

let locks: FakeLockManager

beforeEach(() => {
  vi.resetModules()
  locks = new FakeLockManager()
  vi.stubGlobal('navigator', { locks })
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  FakeBroadcastChannel.instances = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function load() {
  return import('@/lib/vaultOwnership')
}

describe('claimVault', () => {
  it('assume a posse quando o cofre está livre', async () => {
    const { claimVault } = await load()
    expect(await claimVault(() => {})).toBe('owner')
  })

  it('é idempotente — duas chamadas devolvem a mesma posse, não duas disputas', async () => {
    // Amarrada ao ciclo de vida de um efeito, a aquisição quebrava sob `<StrictMode>`: a limpeza
    // chegava antes de a promessa resolver, o lock vazava e a segunda montagem se via bloqueada
    // por si mesma. Guardar a promessa no módulo é o que impede isso.
    const { claimVault } = await load()
    const [first, second] = await Promise.all([claimVault(() => {}), claimVault(() => {})])
    expect(first).toBe('owner')
    expect(second).toBe('owner')
  })

  it('reporta ocupado quando outro contexto já detém o lock', async () => {
    locks.held = true
    const { claimVault } = await load()
    expect(await claimVault(() => {})).toBe('busy')
  })

  it('segue como dono quando o navegador não tem Web Locks — nunca bloqueia por falta de API', async () => {
    vi.stubGlobal('navigator', {})
    const { claimVault } = await load()
    expect(await claimVault(() => {})).toBe('owner')
  })
})

describe('takeover', () => {
  it('avisa o dono, que desmonta antes de liberar a posse', async () => {
    const { claimVault, requestTakeover } = await load()
    const order: string[] = []
    await claimVault(async () => {
      order.push('teardown-start')
      await Promise.resolve()
      order.push('teardown-end')
    })

    await requestTakeover()
    await new Promise((resolve) => setTimeout(resolve, 0))

    // A ordem é a garantia inteira desta feature: se o lock fosse liberado antes do desmonte, a
    // outra aba abriria um cofre que ainda está preso pelo `SyncAccessHandle` desta.
    expect(order).toEqual(['teardown-start', 'teardown-end'])
  })

  it('libera a posse mesmo se o desmonte falhar', async () => {
    const { claimVault, requestTakeover } = await load()
    await claimVault(() => {
      throw new Error('falha ao fechar o banco')
    })

    await requestTakeover()
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Segurar o lock depois de ter cedido a posse deixaria as duas abas inutilizáveis — pior que
    // uma delas em estado ruim.
    expect(locks.held).toBe(false)
  })
})
