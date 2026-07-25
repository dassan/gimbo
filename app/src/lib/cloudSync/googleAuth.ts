// F-28 Nível 2, Fase 2 — CS-02: OAuth2 PKCE against Google Drive. No backend.
//
// Scope is `drive.file` (non-sensitive): the app only ever sees files it created itself. Tokens
// are never bundled with financial data — they live in a separate localStorage key from the
// DataFile, and `revokeGoogleAuth()` never touches the user's local vault.
//
// **Empirically confirmed 2026-07-25 (CS-01 validation):** unlike the original PKCE-only design,
// Google's token endpoint rejects a code/refresh-token exchange from a "Web application" OAuth
// client with `invalid_request: client_secret is missing` even when the request includes a valid
// PKCE code_verifier. Google only treats PKCE as sufficient for the "public client" categories
// (iOS/Android/Desktop/UWP) — a "Web application" client is always confidential from Google's
// point of view, secret or not. There's no client type that both (a) accepts an arbitrary HTTPS
// redirect_uri for a hosted SPA and (b) skips the secret — "Desktop app" clients skip it but only
// allow http://localhost loopback redirects, unusable for a deployed web app. So `clientSecret()`
// below is bundled into the public JS build. This is the pattern Google's own docs acknowledge for
// browser-only apps: the string doesn't provide real confidentiality (anyone can read it from the
// bundle), so it isn't a secret in the security sense — redirect_uri whitelisting + PKCE + the
// single-use authorization code are what actually gate access, exactly as for a client with none.

const AUTH_KEY = 'gimbo_google_auth'
const STATE_KEY = 'gimbo_google_oauth_state' // sessionStorage — CSRF guard, single redirect round-trip
const VERIFIER_KEY = 'gimbo_google_oauth_verifier' // sessionStorage — PKCE proof

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
// openid + userinfo.email are non-sensitive too — added only so Settings can show which Google
// account is connected (id_token comes back on the same request, no extra round-trip needed).
const SCOPE =
  'https://www.googleapis.com/auth/drive.file openid https://www.googleapis.com/auth/userinfo.email'

// Refresh a bit before actual expiry so a request never races an in-flight expiration.
const EXPIRY_SAFETY_MARGIN_MS = 60_000

interface GoogleAuthState {
  accessToken: string
  refreshToken: string
  expiresAt: number // epoch ms
  needsReconnect?: boolean // set when a refresh attempt fails (S-15); cleared on next success
  email?: string // decoded from id_token at connect time — display only, never used for auth
}

function clientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
}

function clientSecret(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_SECRET ?? ''
}

/** False when the maintainer hasn't configured a Google Cloud project (CS-01) yet. */
export function isGoogleSyncConfigured(): boolean {
  return clientId().length > 0 && clientSecret().length > 0
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

// Reads the `email` claim out of the id_token JWT (openid scope) — display only, so a decode
// failure is never fatal to the connect flow, just leaves the account chip without an email.
function decodeEmailFromIdToken(idToken: string): string | undefined {
  try {
    const payload = idToken.split('.')[1]
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return (JSON.parse(json) as { email?: string }).email
  } catch {
    return undefined
  }
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

// Google's token endpoint always returns a JSON body describing the failure (e.g.
// { error: 'invalid_grant', error_description: '...' }) — surfacing it beats a bare "400 Bad
// Request" when diagnosing OAuth client misconfiguration (wrong client type, reused code...).
async function describeError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; error_description?: string }
    return [body.error, body.error_description].filter(Boolean).join(' — ') || `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}`
  }
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
      client_secret: clientSecret(),
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
    }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed: ${await describeError(res)}`)

  const json = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    id_token?: string
  }
  // Google only sends refresh_token when consent is (re-)granted — prompt=consent above
  // guarantees that on every connect, but fall back to a prior one just in case.
  const refreshToken = json.refresh_token ?? loadAuthState()?.refreshToken
  if (!refreshToken) throw new Error('Google did not return a refresh token')

  const email = json.id_token ? decodeEmailFromIdToken(json.id_token) : undefined

  saveAuthState({
    accessToken: json.access_token,
    refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
    email: email ?? loadAuthState()?.email,
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
      client_secret: clientSecret(),
      refresh_token: state.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    // S-15: refresh failed (revoked elsewhere, expired refresh token...). Keep the connection
    // "configured" so the UI can offer a one-click reconnect instead of silently losing state.
    const message = await describeError(res)
    saveAuthState({ ...state, needsReconnect: true })
    throw new Error(`Google token refresh failed: ${message}`)
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

/**
 * The connected Google account's email, for display in Settings — null if not connected, or if
 * this connection predates the `openid`/`userinfo.email` scopes (reconnect to pick it up).
 */
export function getGoogleAccountEmail(): string | null {
  return loadAuthState()?.email ?? null
}

/** True once a refresh attempt has failed (S-15) — surfaced as a reconnect banner. */
export function googleNeedsReconnect(): boolean {
  return loadAuthState()?.needsReconnect === true
}
