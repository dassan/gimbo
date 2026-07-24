import { beforeEach, describe, expect, it } from 'vitest'

// ─── In-memory OPFS fake ────────────────────────────────────────────────────
// Unit-test-only stand-in for navigator.storage.getDirectory(); mirrors just
// enough of the File System Access API surface for deviceId.ts to run against.

class FakeFileHandle {
  private store: Map<string, string>
  private name: string
  constructor(store: Map<string, string>, name: string) {
    this.store = store
    this.name = name
  }
  getFile(): Promise<{ text: () => Promise<string> }> {
    const content = this.store.get(this.name) ?? ''
    return Promise.resolve({ text: () => Promise.resolve(content) })
  }
  createWritable(): Promise<{
    write: (s: string) => Promise<void>
    close: () => Promise<void>
  }> {
    let buffer = ''
    return Promise.resolve({
      write: (s: string) => {
        buffer += s
        return Promise.resolve()
      },
      close: () => {
        this.store.set(this.name, buffer)
        return Promise.resolve()
      },
    })
  }
}

class FakeDirectoryHandle {
  private files = new Map<string, string>()
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    if (!this.files.has(name) && !options?.create) {
      return Promise.reject(new DOMException('NotFoundError', 'NotFoundError'))
    }
    return Promise.resolve(new FakeFileHandle(this.files, name))
  }
}

function installFakeOpfs(): FakeDirectoryHandle {
  const root = new FakeDirectoryHandle()
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { getDirectory: () => Promise.resolve(root) },
  })
  return root
}

describe('deviceId', () => {
  beforeEach(() => {
    installFakeOpfs()
    // Reset the in-module cache between tests by re-importing fresh each time (vitest isolates
    // modules per test file, but not per `it()` — see vi.resetModules() usage below).
  })

  it('generates and persists a device id on first call', async () => {
    const { getDeviceId } = await import('@/lib/cloudSync/deviceId')
    const id = await getDeviceId()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('returns the same value on subsequent calls (in-memory cache)', async () => {
    const { getDeviceId } = await import('@/lib/cloudSync/deviceId')
    const first = await getDeviceId()
    const second = await getDeviceId()
    expect(second).toBe(first)
  })

  it('is stable across a simulated reload (re-reads the persisted OPFS file)', async () => {
    const { vi } = await import('vitest')
    vi.resetModules()
    installFakeOpfs()
    const mod1 = await import('@/lib/cloudSync/deviceId')
    const id1 = await mod1.getDeviceId()

    vi.resetModules()
    // Re-install so the "new session" reads from the same underlying fake OPFS store —
    // simulate a reload by keeping the directory handle but dropping the module cache.
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: navigator.storage,
    })
    const mod2 = await import('@/lib/cloudSync/deviceId')
    const id2 = await mod2.getDeviceId()

    expect(id2).toBe(id1)
  })

  it('getShortDeviceId returns the first 6 characters of the full id', async () => {
    const { getDeviceId, getShortDeviceId } = await import('@/lib/cloudSync/deviceId')
    const full = await getDeviceId()
    const short = await getShortDeviceId()
    expect(short).toBe(full.slice(0, 6))
    expect(short).toHaveLength(6)
  })
})
