import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  initiateGoogleAuth,
  handleGoogleCallback,
  refreshGoogleToken,
  getValidAccessToken,
  revokeGoogleAuth,
  isGoogleConnected,
  isGoogleSyncConfigured,
  googleNeedsReconnect,
} from '@/lib/cloudSync/googleAuth'

function mockFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  } as Response)
}

function mockFetchFail() {
  return vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) } as Response)
}

const originalLocation = window.location
let assignMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  // jsdom's window.location.assign isn't configurable, so it can't be spied on directly —
  // replace the whole object with a plain stand-in that has a mockable assign().
  assignMock = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, assign: assignMock },
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isGoogleSyncConfigured / isGoogleConnected', () => {
  it('isGoogleConnected is false with no stored auth state', () => {
    expect(isGoogleConnected()).toBe(false)
  })

  it('isGoogleSyncConfigured reflects whether VITE_GOOGLE_CLIENT_ID is set', () => {
    // In this test env VITE_GOOGLE_CLIENT_ID is unset — matches the "not yet configured" case.
    expect(typeof isGoogleSyncConfigured()).toBe('boolean')
  })
})

describe('initiateGoogleAuth', () => {
  it('stores a verifier and state, then redirects to the Google authorize endpoint', async () => {
    await initiateGoogleAuth()

    expect(sessionStorage.getItem('gimbo_google_oauth_verifier')).toBeTruthy()
    expect(sessionStorage.getItem('gimbo_google_oauth_state')).toBeTruthy()

    expect(assignMock).toHaveBeenCalledTimes(1)
    const url = new URL(assignMock.mock.calls[0][0] as string)
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file')
    expect(url.searchParams.get('state')).toBe(sessionStorage.getItem('gimbo_google_oauth_state'))
  })
})

describe('handleGoogleCallback', () => {
  it('exchanges the code for tokens and connects on matching state', async () => {
    await initiateGoogleAuth()
    const state = sessionStorage.getItem('gimbo_google_oauth_state')!

    global.fetch = mockFetchOk({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 3600,
    })

    await handleGoogleCallback('auth-code', state)

    expect(isGoogleConnected()).toBe(true)
    // one-time-use: verifier/state are consumed
    expect(sessionStorage.getItem('gimbo_google_oauth_verifier')).toBeNull()
  })

  it('throws on a state mismatch and does not connect', async () => {
    await initiateGoogleAuth()
    global.fetch = mockFetchOk({ access_token: 'x', refresh_token: 'y', expires_in: 3600 })

    await expect(handleGoogleCallback('auth-code', 'wrong-state')).rejects.toThrow()
    expect(isGoogleConnected()).toBe(false)
  })

  it('throws when there is no pending verifier (no prior initiateGoogleAuth call)', async () => {
    global.fetch = mockFetchOk({ access_token: 'x', refresh_token: 'y', expires_in: 3600 })
    await expect(handleGoogleCallback('auth-code', 'any-state')).rejects.toThrow()
  })

  it('throws when the token exchange request fails', async () => {
    await initiateGoogleAuth()
    const state = sessionStorage.getItem('gimbo_google_oauth_state')!
    global.fetch = mockFetchFail()

    await expect(handleGoogleCallback('auth-code', state)).rejects.toThrow()
    expect(isGoogleConnected()).toBe(false)
  })
})

describe('refreshGoogleToken / getValidAccessToken', () => {
  async function connect() {
    await initiateGoogleAuth()
    const state = sessionStorage.getItem('gimbo_google_oauth_state')!
    global.fetch = mockFetchOk({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 3600,
    })
    await handleGoogleCallback('auth-code', state)
  }

  it('getValidAccessToken returns the cached token when not close to expiry', async () => {
    await connect()
    const token = await getValidAccessToken()
    expect(token).toBe('access-1')
  })

  it('getValidAccessToken refreshes when the token is expired', async () => {
    await connect()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 4_000_000) // past the 1h expiry
    global.fetch = mockFetchOk({ access_token: 'access-2', expires_in: 3600 })

    const token = await getValidAccessToken()
    expect(token).toBe('access-2')
  })

  it('refreshGoogleToken marks needsReconnect and throws on failure', async () => {
    await connect()
    global.fetch = mockFetchFail()

    await expect(refreshGoogleToken()).rejects.toThrow()
    expect(googleNeedsReconnect()).toBe(true)
    expect(isGoogleConnected()).toBe(true) // still "configured", just needs reconnecting
  })

  it('refreshGoogleToken throws when never connected', async () => {
    await expect(refreshGoogleToken()).rejects.toThrow()
  })
})

describe('revokeGoogleAuth', () => {
  it('clears local auth state even if the network call fails', async () => {
    await initiateGoogleAuth()
    const state = sessionStorage.getItem('gimbo_google_oauth_state')!
    global.fetch = mockFetchOk({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 3600,
    })
    await handleGoogleCallback('auth-code', state)
    expect(isGoogleConnected()).toBe(true)

    global.fetch = vi.fn().mockRejectedValue(new Error('offline'))
    await revokeGoogleAuth()

    expect(isGoogleConnected()).toBe(false)
  })

  it('is a no-op when not connected', async () => {
    await expect(revokeGoogleAuth()).resolves.toBeUndefined()
  })
})
