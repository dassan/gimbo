// F-28 Nível 2, Fase 2 — CS-02: OAuth2 PKCE against Google Drive. No backend, no client
// secret — the PKCE code_verifier/code_challenge pair is what makes a public client safe.
//
// Scope is `drive.file` (non-sensitive): the app only ever sees files it created itself. Tokens
// are never bundled with financial data — they live in a separate localStorage key from the
// DataFile, and `revokeGoogleAuth()` never touches the user's local vault.

const AUTH_KEY = 'gimbo_google_auth'
const STATE_KEY = 'gimbo_google_oauth_state' // sessionStorage — CSRF guard, single redirect round-trip
const VERIFIER_KEY = 'gimbo_google_oauth_verifier' // sessionStorage — PKCE proof

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const SCOPE = 'https://www.googleapis.com/auth/drive.file'

// Refresh a bit before actual expiry so a request never races an in-flight expiration.
const EXPIRY_SAFETY_MARGIN_MS = 60_000

interface GoogleAuthState {
  accessToken: string
  refreshToken: string
  expiresAt: number // epoch ms
  needsReconnect?: boolean // set when a refresh attempt fails (S-15); cleared on next success
}

function clientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
}

/** False when the maintainer hasn't configured a Google Cloud project (CS-01) yet. */
export function isGoogleSyncConfigured(): boolean {
  return clientId().length > 0
}

function redirectUri(): string {
  // No dedicated callback route — the Backup & Sync section in Settings itself detects the
  // ?code=&state= query params on mount and completes the exchange (see handleGoogleCallback).
  return `${window.location.origin}/settings`
}

function loadAuthState(): GoogleAuthState | null {
  const raw = localStorage.getItem(AUTH_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as GoogleAuthState
  } catch {
    return null
  }
}

function saveAuthState(state: GoogleAuthState): void {
  localStorage.setItem(AUTH_KEY, JSON.stringify(state))
}

function clearAuthState(): void {
  localStorage.removeItem(AUTH_KEY)
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomUrlSafeString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

async function sha256(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return new Uint8Array(digest)
}

/** Kicks off the PKCE flow: generates verifier/challenge + CSRF state, then redirects to Google. */
export async function initiateGoogleAuth(): Promise<void> {
  const verifier = randomUrlSafeString(64)
  const challenge = base64UrlEncode(await sha256(verifier))
  const state = randomUrlSafeString(16)

  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(STATE_KEY, state)

  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline', // required to receive a refresh_token
    prompt: 'consent', // forces re-consent so a refresh_token is issued every reconnect, not just the first
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })

  window.location.assign(`${AUTHORIZE_ENDPOINT}?${params.toString()}`)
}

/** Completes the PKCE flow after Google redirects back with `?code=&state=`. */
export async function handleGoogleCallback(code: string, state: string): Promise<void> {
  const expectedState = sessionStorage.getItem(STATE_KEY)
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  sessionStorage.removeItem(STATE_KEY)
  sessionStorage.removeItem(VERIFIER_KEY)

  if (!verifier || !expectedState || state !== expectedState) {
    throw new Error('Google OAuth state mismatch — possible CSRF or stale redirect')
  }

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
    }),
  })
  if (!res.ok) throw new Error('Google token exchange failed')

  const json = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
  // Google only sends refresh_token when consent is (re-)granted — prompt=consent above
  // guarantees that on every connect, but fall back to a prior one just in case.
  const refreshToken = json.refresh_token ?? loadAuthState()?.refreshToken
  if (!refreshToken) throw new Error('Google did not return a refresh token')

  saveAuthState({
    accessToken: json.access_token,
    refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
  })
}

/** Exchanges the stored refresh_token for a new access_token. Marks needsReconnect on failure. */
export async function refreshGoogleToken(): Promise<string> {
  const state = loadAuthState()
  if (!state) throw new Error('Not connected to Google Drive')

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      refresh_token: state.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    // S-15: refresh failed (revoked elsewhere, expired refresh token...). Keep the connection
    // "configured" so the UI can offer a one-click reconnect instead of silently losing state.
    saveAuthState({ ...state, needsReconnect: true })
    throw new Error('Google token refresh failed')
  }

  const json = (await res.json()) as { access_token: string; expires_in: number }
  const updated: GoogleAuthState = {
    ...state,
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    needsReconnect: false,
  }
  saveAuthState(updated)
  return updated.accessToken
}

/** Returns a currently-valid access token, refreshing first if it's expired (or about to be). */
export async function getValidAccessToken(): Promise<string> {
  const state = loadAuthState()
  if (!state) throw new Error('Not connected to Google Drive')
  if (Date.now() < state.expiresAt - EXPIRY_SAFETY_MARGIN_MS) return state.accessToken
  return refreshGoogleToken()
}

/** Revokes the refresh token with Google and clears local auth state. Never touches the vault. */
export async function revokeGoogleAuth(): Promise<void> {
  const state = loadAuthState()
  clearAuthState()
  if (!state) return
  try {
    await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(state.refreshToken)}`, {
      method: 'POST',
    })
  } catch {
    // best-effort — the local disconnect above already succeeded regardless of network
  }
}

export function isGoogleConnected(): boolean {
  return loadAuthState() !== null
}

/** True once a refresh attempt has failed (S-15) — surfaced as a reconnect banner. */
export function googleNeedsReconnect(): boolean {
  return loadAuthState()?.needsReconnect === true
}
