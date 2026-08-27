// CS-38 — fake da Drive API v3 dirigido por URL, para os testes de transporte de sync.
//
// Substitui a cadeia de `fetchMock.mockResolvedValueOnce(...)` que os testes de `googleDrive.ts`
// usavam. Aquela forma acopla cada teste à *ordem exata* das chamadas: inserir um round-trip novo
// no meio do provider quebra testes que não têm nada a ver com a mudança, e o teste não consegue
// afirmar nada sobre o estado resultante — só sobre a sequência. O transporte particionado
// (CS-42..CS-45) faz N chamadas por sync, com N variando conforme o que divergiu, então a cadeia
// sequencial deixaria de ser expressável.
//
// Este fake guarda uma tabela de arquivos em memória e roteia por URL, de modo que os testes
// afirmam **comportamento** ("só existe uma pasta depois", "o manifesto foi o último upload") em
// vez de sequência. Ele é deliberadamente estrito em três pontos onde a API real morde:
//
//   1. `nextPageToken` só é devolvido se o chamador o pedir em `fields` — a pegadinha que causa
//      truncamento silencioso em `files.list`.
//   2. `fields=files(a,b)` projeta de verdade: pedir um campo que não foi listado devolve
//      `undefined`, então esquecer `modifiedTime` no `fields` falha no teste, não em produção.
//   3. Uma cláusula `q` desconhecida lança em vez de casar com tudo — um typo na query vira erro
//      de teste em vez de um filtro silenciosamente inerte.

export interface FakeDriveFile {
  id: string
  name: string
  parents: string[]
  mimeType: string
  bytes: Uint8Array | null
  modifiedTime: string
  trashed: boolean
}

export interface FakeDriveCall {
  method: string
  url: string
  /** Nome do arquivo alvo, quando a requisição é um upload — permite afirmar ordem de publicação. */
  name?: string
}

const FOLDER_MIME = 'application/vnd.google-apps.folder'

interface FailRule {
  pattern: string | RegExp
  status: number
  remaining: number
  body?: unknown
}

export class FakeDrive {
  readonly files = new Map<string, FakeDriveFile>()
  readonly callLog: FakeDriveCall[] = []

  private _seq = 0
  private _clock = 0
  private _validToken: string | null = null
  private _failRules: FailRule[] = []
  private _originalFetch: typeof globalThis.fetch | undefined

  // ─── setup ──────────────────────────────────────────────────────────────────

  /** Replaces `global.fetch`. Call `restore()` (or just let the next `install()` win) afterwards. */
  install(): void {
    this._originalFetch = globalThis.fetch
    globalThis.fetch = ((url: string, init?: RequestInit) =>
      this.handle(url, init)) as unknown as typeof globalThis.fetch
  }

  restore(): void {
    if (this._originalFetch) globalThis.fetch = this._originalFetch
  }

  /** Once set, any request without `Bearer <token>` gets a 401 — drives the retry-on-401 path. */
  setValidToken(token: string | null): void {
    this._validToken = token
  }

  /** Fails the next `times` requests whose URL matches, with `status`. */
  failNext(pattern: string | RegExp, status: number, times = 1): void {
    this._failRules.push({ pattern, status, remaining: times })
  }

  seedFolder(name: string, parentId?: string): string {
    return this.insert({ name, parents: parentId ? [parentId] : [], mimeType: FOLDER_MIME })
  }

  seedFile(name: string, parentId: string, content: string | Uint8Array): string {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
    return this.insert({
      name,
      parents: [parentId],
      mimeType: 'application/octet-stream',
      bytes,
    })
  }

  // ─── inspection ─────────────────────────────────────────────────────────────

  calls(pattern?: string | RegExp): FakeDriveCall[] {
    if (!pattern) return [...this.callLog]
    return this.callLog.filter((c) => this.matches(c.url, pattern))
  }

  byName(name: string, parentId?: string): FakeDriveFile | undefined {
    return [...this.files.values()].find(
      (f) => f.name === name && !f.trashed && (!parentId || f.parents.includes(parentId))
    )
  }

  allNamed(name: string): FakeDriveFile[] {
    return [...this.files.values()].filter((f) => f.name === name && !f.trashed)
  }

  childrenOf(parentId: string): FakeDriveFile[] {
    return [...this.files.values()].filter((f) => f.parents.includes(parentId) && !f.trashed)
  }

  textOf(id: string): string {
    const file = this.files.get(id)
    if (!file?.bytes) throw new Error(`FakeDrive: file ${id} has no content`)
    return new TextDecoder().decode(file.bytes)
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private insert(
    partial: Omit<FakeDriveFile, 'id' | 'modifiedTime' | 'trashed' | 'bytes'> &
      Partial<Pick<FakeDriveFile, 'bytes'>>
  ): string {
    const id = `id-${++this._seq}`
    this.files.set(id, {
      id,
      bytes: null,
      trashed: false,
      modifiedTime: this.tick(),
      ...partial,
    })
    return id
  }

  private tick(): string {
    // Monotonic and deterministic — real Drive timestamps are what the watermark logic compares.
    return new Date(Date.UTC(2026, 0, 1) + ++this._clock * 1000).toISOString()
  }

  private matches(url: string, pattern: string | RegExp): boolean {
    return typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)
  }

  private respond(body: unknown, ok = true, status = ok ? 200 : 400): Response {
    const response: Response = {
      ok,
      status,
      // Real Response bodies are single-use, so the rate-limit check clones before reading.
      // Modelling clone() keeps that path exercisable.
      clone: () => response,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
      arrayBuffer: () =>
        Promise.resolve(
          // ArrayBuffer.isView, not `instanceof Uint8Array`: under vitest the typed array may come
          // from the Node realm while the global `Uint8Array` is jsdom's, and instanceof fails.
          ArrayBuffer.isView(body)
            ? (body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer)
            : new ArrayBuffer(0)
        ),
    } as unknown as Response
    return response
  }

  /** Injeta um 403 com motivo de rate limit — o formato que o Drive de verdade devolve. */
  failNextWithRateLimit(pattern: string | RegExp, times = 1): void {
    this._failRules.push({
      pattern,
      status: 403,
      remaining: times,
      body: { error: { errors: [{ reason: 'userRateLimitExceeded' }] } },
    })
  }

  private async handle(url: string, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase()
    // O registro é capturado aqui e repassado adiante: com uploads concorrentes, "a última chamada
    // registrada" não é necessariamente esta.
    const call: FakeDriveCall = { method, url }
    this.callLog.push(call)

    const rule = this._failRules.find((r) => r.remaining > 0 && this.matches(url, r.pattern))
    if (rule) {
      rule.remaining--
      return this.respond(
        rule.body ?? { error: { message: 'injected failure' } },
        false,
        rule.status
      )
    }

    if (this._validToken !== null) {
      const headers = (init?.headers ?? {}) as Record<string, string>
      if (headers.Authorization !== `Bearer ${this._validToken}`) {
        return this.respond({ error: { message: 'Invalid Credentials' } }, false, 401)
      }
    }

    const parsed = new URL(url)
    const isUpload = parsed.pathname.startsWith('/upload/')
    const idMatch = /\/files\/([^/?]+)/.exec(parsed.pathname)

    if (isUpload && method === 'PATCH' && idMatch) return this.updateMedia(idMatch[1], init, call)
    if (isUpload && method === 'POST') return this.createMultipart(init, call)
    if (method === 'POST' && !isUpload) return this.createMetadataOnly(init)
    if (method === 'GET' && idMatch) return this.getOne(idMatch[1], parsed)
    if (method === 'GET') return this.list(parsed)

    throw new Error(`FakeDrive: unhandled ${method} ${url}`)
  }

  private async updateMedia(
    id: string,
    init: RequestInit | undefined,
    call: FakeDriveCall
  ): Promise<Response> {
    const file = this.files.get(id)
    if (!file) return this.respond({ error: { message: 'File not found' } }, false, 404)
    call.name = file.name
    file.bytes = await toBytes(init?.body)
    file.modifiedTime = this.tick()
    return this.respond({ id })
  }

  private async createMultipart(
    init: RequestInit | undefined,
    call: FakeDriveCall
  ): Promise<Response> {
    const form = init?.body
    if (!(form instanceof FormData)) throw new Error('FakeDrive: multipart body is not FormData')
    const metaRaw = form.get('metadata')
    const metaText =
      typeof metaRaw === 'string' ? metaRaw : new TextDecoder().decode(await toBytes(metaRaw))
    const meta = JSON.parse(metaText) as { name: string; parents?: string[]; mimeType?: string }
    call.name = meta.name
    const id = this.insert({
      name: meta.name,
      parents: meta.parents ?? [],
      mimeType: meta.mimeType ?? 'application/octet-stream',
      bytes: await toBytes(form.get('file')),
    })
    return this.respond({ id })
  }

  private createMetadataOnly(init?: RequestInit): Response {
    // Metadata-only creates (folders) always send a JSON string body; anything else is a caller bug.
    const raw = typeof init?.body === 'string' ? init.body : '{}'
    const meta = JSON.parse(raw) as {
      name: string
      parents?: string[]
      mimeType?: string
    }
    const id = this.insert({
      name: meta.name,
      parents: meta.parents ?? [],
      mimeType: meta.mimeType ?? 'application/octet-stream',
    })
    return this.respond({ id })
  }

  private getOne(id: string, parsed: URL): Response {
    const file = this.files.get(id)
    if (!file) return this.respond({ error: { message: 'File not found' } }, false, 404)
    if (parsed.searchParams.get('alt') === 'media') {
      return this.respond(file.bytes ?? new Uint8Array(0))
    }
    const fields = parsed.searchParams.get('fields')
    return this.respond(projectFile(file, fields ? splitFields(fields) : null))
  }

  private list(parsed: URL): Response {
    const q = parsed.searchParams.get('q') ?? ''
    // Compiled (and therefore validated) before filtering, so a malformed clause is rejected even
    // when the store happens to be empty — the real API 400s on a bad query regardless of matches.
    const predicate = compileQuery(q)
    const matched = [...this.files.values()].filter(predicate)

    if (parsed.searchParams.get('orderBy')?.startsWith('modifiedTime desc')) {
      matched.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))
    }

    const { top, fileFields } = parseFieldsParam(parsed.searchParams.get('fields'))
    const pageSize = Number(parsed.searchParams.get('pageSize') ?? '100')
    const offset = Number(parsed.searchParams.get('pageToken') ?? '0')
    const page = matched.slice(offset, offset + pageSize)
    const next = offset + pageSize

    const body: { files: unknown[]; nextPageToken?: string } = {
      files: page.map((f) => projectFile(f, fileFields)),
    }
    // The real gotcha: Drive omits nextPageToken unless `fields` asks for it, so a caller that
    // forgot it silently sees only the first page.
    if (next < matched.length && (top === null || top.includes('nextPageToken'))) {
      body.nextPageToken = String(next)
    }
    return this.respond(body)
  }
}

// ─── query + fields helpers ───────────────────────────────────────────────────

type FilePredicate = (file: FakeDriveFile) => boolean

function compileQuery(q: string): FilePredicate {
  if (!q.trim()) return (file) => !file.trashed
  const clauses = q
    .split(/\s+and\s+/i)
    .map((clause) => compileClause(clause.trim().replace(/^\(|\)$/g, '')))
  return (file) => clauses.every((match) => match(file))
}

function compileClause(clause: string): FilePredicate {
  let m: RegExpExecArray | null

  if ((m = /^name\s*=\s*'(.*)'$/.exec(clause))) {
    const value = unescapeQ(m[1])
    return (f) => f.name === value
  }
  if ((m = /^name\s+contains\s+'(.*)'$/.exec(clause))) {
    const value = unescapeQ(m[1])
    return (f) => f.name.includes(value)
  }
  if ((m = /^mimeType\s*=\s*'(.*)'$/.exec(clause))) {
    const value = m[1]
    return (f) => f.mimeType === value
  }
  if ((m = /^mimeType\s*!=\s*'(.*)'$/.exec(clause))) {
    const value = m[1]
    return (f) => f.mimeType !== value
  }
  if ((m = /^'(.*)'\s+in\s+parents$/.exec(clause))) {
    const parentId = m[1]
    return (f) => f.parents.includes(parentId)
  }
  if (/^trashed\s*=\s*false$/.test(clause)) return (f) => !f.trashed
  if (/^trashed\s*=\s*true$/.test(clause)) return (f) => f.trashed

  // Deliberate: an unrecognised clause is a bug in the query builder, not a match-everything.
  throw new Error(`FakeDrive: unsupported q clause ${JSON.stringify(clause)}`)
}

function unescapeQ(value: string): string {
  return value.replace(/\\'/g, "'")
}

function splitFields(fields: string): string[] {
  return fields.split(',').map((f) => f.trim())
}

function parseFieldsParam(fields: string | null): {
  top: string[] | null
  fileFields: string[] | null
} {
  if (!fields) return { top: null, fileFields: null }
  const inner = /files\(([^)]*)\)/.exec(fields)
  const top = fields.replace(/files\([^)]*\)/, 'files')
  return {
    top: splitFields(top),
    fileFields: inner ? splitFields(inner[1]) : null,
  }
}

function projectFile(file: FakeDriveFile, fields: string[] | null): Record<string, unknown> {
  const full: Record<string, unknown> = {
    id: file.id,
    name: file.name,
    parents: file.parents,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    size: String(file.bytes?.byteLength ?? 0),
    trashed: file.trashed,
  }
  if (!fields) return full
  const projected: Record<string, unknown> = {}
  for (const key of fields) if (key in full) projected[key] = full[key]
  return projected
}

async function toBytes(body: unknown): Promise<Uint8Array> {
  if (body == null) return new Uint8Array(0)
  if (typeof body === 'string') return new TextEncoder().encode(body)
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  }
  if (isBlobLike(body)) return new Uint8Array(await blobToArrayBuffer(body))
  throw new Error(`FakeDrive: unsupported body type ${Object.prototype.toString.call(body)}`)
}

interface BlobLike {
  size: number
  arrayBuffer?: () => Promise<ArrayBuffer>
  text?: () => Promise<string>
}

function isBlobLike(value: unknown): value is BlobLike {
  return typeof value === 'object' && value !== null && typeof (value as BlobLike).size === 'number'
}

/**
 * jsdom's Blob has historically shipped without `arrayBuffer()`/`text()`, and which of the three
 * paths is available varies with the jsdom version — so try them in order rather than assuming.
 */
async function blobToArrayBuffer(blob: BlobLike): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  if (typeof blob.text === 'function') {
    const encoded = new TextEncoder().encode(await blob.text())
    return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () =>
      reject(reader.error ?? new Error('FakeDrive: FileReader failed with no error'))
    reader.readAsArrayBuffer(blob as unknown as Blob)
  })
}
