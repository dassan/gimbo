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

// ─── SEC-04: onde cada coisa mora ─────────────────────────────────────────────
//
// O estado de auth era um único blob JSON no `localStorage`, com `accessToken` e `refreshToken`
// em texto claro e sem expiração. O comentário acima dizia que os tokens "vivem numa chave
// separada do DataFile" — verdade, e boa separação, mas não era a propriedade que importava: o
// token dá acesso aos arquivos do Drive, e o arquivo do Drive *é* o cofre financeiro. Quem
// exfiltrasse aquele blob tinha acesso offline, persistente e independente do dispositivo da
// vítima, sem nenhum sinal para ela.
//
// Agora são três lugares, por sensibilidade:
//
//   `localStorage` (gimbo_google_auth_meta) — metadado NÃO secreto: se há conexão, e-mail para
//       exibição, quando o refresh token foi guardado, e a flag de reconexão. Continua síncrono
//       porque `isGoogleConnected()`/`getGoogleAccountEmail()`/`googleNeedsReconnect()` são lidos
//       em render e dentro do `mutate()` do store — e nenhum deles precisa do token em si.
//   IndexedDB cifrado (secretStore) — o `refresh_token`, o único segredo de longa duração.
//   Memória — o `access_token`, que dura ~1h e é re-derivável. Não vai mais para o disco: some
//       no reload e é reobtido sob demanda, então o que fica em repouso é estritamente menos.
//
// Limite honesto desta camada: ver o cabeçalho de `secretStore.ts`. A cifragem derrota coleta
// genérica de credenciais, não um atacante que escreva código específico para o Gimbo. O que
// limita o dano de um roubo bem-sucedido é `REFRESH_TOKEN_MAX_AGE_MS` abaixo.

import { deleteSecret, getSecret, putSecret } from './secretStore'

const LEGACY_AUTH_KEY = 'gimbo_google_auth'
const META_KEY = 'gimbo_google_auth_meta'
const REFRESH_TOKEN_SECRET = 'google_refresh_token'

/**
 * Idade máxima do `refresh_token` guardado antes de exigir reconexão.
 *
 * O achado do `SEC-04` não era só "em texto claro", era também "sem expiração": o refresh token do
 * Google não expira por tempo (só por revogação ou 6 meses de inatividade), então um token roubado
 * valia para sempre. Um teto absoluto transforma isso em janela limitada, e vale contra qualquer
 * atacante — inclusive os que a cifragem não detém.
 *
 * 30 dias é um equilíbrio: curto o bastante para limitar dano, longo o bastante para não treinar o
 * usuário a clicar em telas de consentimento por reflexo (o que seria seu próprio risco). Ao
 * expirar, a flag `needsReconnect` acende o banner que o AppLayout já exibe — o usuário reconecta
 * em um clique, e nenhum dado local é afetado.
 */
const REFRESH_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
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

/** Metadado não-secreto, em localStorage. Nenhum token aqui — ver o bloco SEC-04 acima. */
interface GoogleAuthMeta {
  connected: true
  email?: string // do id_token no connect; exibição apenas, nunca usado para autenticar
  refreshStoredAt: number // epoch ms — base do teto de REFRESH_TOKEN_MAX_AGE_MS
  needsReconnect?: boolean // refresh falhou ou expirou (S-15); limpo no próximo sucesso
}

/**
 * `access_token` vive só aqui, em memória. Dura ~1h e é re-derivável a partir do refresh token,
 * então persistí-lo só aumentaria a superfície em repouso sem ganho algum. Um reload custa uma
 * chamada de refresh na primeira vez que o sync precisar — e o sync não está no caminho do boot.
 */
let _accessToken: { value: string; expiresAt: number } | null = null

function loadMeta(): GoogleAuthMeta | null {
  const raw = localStorage.getItem(META_KEY)
  if (raw) {
    try {
      return JSON.parse(raw) as GoogleAuthMeta
    } catch {
      return null
    }
  }
  return migrateLegacyAuthState()
}

/**
 * SEC-04 — converte o blob antigo (tokens em texto claro) para o formato novo.
 *
 * **Descarta os tokens de propósito, em vez de migrá-los.** Um refresh token que ficou em
 * `localStorage` em texto claro deve ser tratado como potencialmente exposto; a resposta correta é
 * rotacionar, não reaproveitar. O usuário é mantido "conectado" com `needsReconnect`, o que acende
 * o banner de reconexão que o AppLayout já exibe — um clique, sem perda de dado local.
 *
 * Roda dentro do `loadMeta()` para poder ser síncrono: só mexe em `localStorage`, então os
 * acessores síncronos continuam síncronos e nenhum call site precisou mudar.
 */
function migrateLegacyAuthState(): GoogleAuthMeta | null {
  const legacy = localStorage.getItem(LEGACY_AUTH_KEY)
  if (!legacy) return null

  let email: string | undefined
  try {
    email = (JSON.parse(legacy) as { email?: string }).email
  } catch {
    // Blob ilegível — segue mesmo assim: o objetivo principal é apagar os tokens antigos.
  }

  localStorage.removeItem(LEGACY_AUTH_KEY)
  const meta: GoogleAuthMeta = {
    connected: true,
    email,
    refreshStoredAt: 0, // sem refresh token guardado; força o caminho de reconexão
    needsReconnect: true,
  }
  localStorage.setItem(META_KEY, JSON.stringify(meta))
  return meta
}

function saveMeta(meta: GoogleAuthMeta): void {
  localStorage.setItem(META_KEY, JSON.stringify(meta))
}

function clearMeta(): void {
  localStorage.removeItem(META_KEY)
  localStorage.removeItem(LEGACY_AUTH_KEY)
  _accessToken = null
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
  const refreshToken = json.refresh_token ?? (await getSecret(REFRESH_TOKEN_SECRET))
  if (!refreshToken) throw new Error('Google did not return a refresh token')

  const email = json.id_token ? decodeEmailFromIdToken(json.id_token) : undefined

  // SEC-04: o único segredo de longa duração vai cifrado para o IndexedDB; o access token fica
  // em memória; e só metadado sem valor para um atacante toca o localStorage.
  await putSecret(REFRESH_TOKEN_SECRET, refreshToken)
  _accessToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
  saveMeta({
    connected: true,
    email: email ?? loadMeta()?.email,
    refreshStoredAt: Date.now(),
    needsReconnect: false,
  })
}

/** Exchanges the stored refresh_token for a new access_token. Marks needsReconnect on failure. */
export async function refreshGoogleToken(): Promise<string> {
  const meta = loadMeta()
  if (!meta) throw new Error('Not connected to Google Drive')

  const refreshToken = await getSecret(REFRESH_TOKEN_SECRET)
  if (!refreshToken) {
    // Sem segredo guardado: conexão migrada do formato antigo (tokens descartados de propósito),
    // ou dados do browser parcialmente limpos. Nos dois casos o caminho é reconectar.
    saveMeta({ ...meta, needsReconnect: true })
    throw new Error('Google refresh token unavailable — reconnect required')
  }

  // SEC-04: teto absoluto de idade. Sem isto um refresh token roubado valeria indefinidamente,
  // já que o Google não os expira por tempo.
  if (Date.now() - meta.refreshStoredAt > REFRESH_TOKEN_MAX_AGE_MS) {
    await deleteSecret(REFRESH_TOKEN_SECRET)
    saveMeta({ ...meta, refreshStoredAt: 0, needsReconnect: true })
    throw new Error('Google refresh token expired by local policy — reconnect required')
  }

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    // S-15: refresh failed (revoked elsewhere, expired refresh token...). Keep the connection
    // "configured" so the UI can offer a one-click reconnect instead of silently losing state.
    const message = await describeError(res)
    saveMeta({ ...meta, needsReconnect: true })
    throw new Error(`Google token refresh failed: ${message}`)
  }

  const json = (await res.json()) as { access_token: string; expires_in: number }
  _accessToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
  saveMeta({ ...meta, needsReconnect: false })
  return json.access_token
}

/** Returns a currently-valid access token, refreshing first if it's expired (or about to be). */
export async function getValidAccessToken(): Promise<string> {
  if (!loadMeta()) throw new Error('Not connected to Google Drive')
  if (_accessToken && Date.now() < _accessToken.expiresAt - EXPIRY_SAFETY_MARGIN_MS) {
    return _accessToken.value
  }
  // Não persistido em disco (SEC-04), então um reload sempre cai aqui — é uma chamada de rede
  // sob demanda, fora do caminho do boot.
  return refreshGoogleToken()
}

/** Revokes the refresh token with Google and clears local auth state. Never touches the vault. */
export async function revokeGoogleAuth(): Promise<void> {
  const refreshToken = await getSecret(REFRESH_TOKEN_SECRET)
  // Limpa o local primeiro: um desconectar precisa concluir mesmo sem rede.
  await deleteSecret(REFRESH_TOKEN_SECRET)
  clearMeta()
  if (!refreshToken) return
  try {
    await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(refreshToken)}`, {
      method: 'POST',
    })
  } catch {
    // best-effort — the local disconnect above already succeeded regardless of network
  }
}

export function isGoogleConnected(): boolean {
  return loadMeta() !== null
}

/**
 * The connected Google account's email, for display in Settings — null if not connected, or if
 * this connection predates the `openid`/`userinfo.email` scopes (reconnect to pick it up).
 */
export function getGoogleAccountEmail(): string | null {
  return loadMeta()?.email ?? null
}

/** True once a refresh attempt has failed (S-15) — surfaced as a reconnect banner. */
export function googleNeedsReconnect(): boolean {
  return loadMeta()?.needsReconnect === true
}
