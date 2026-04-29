import { logger } from 'electron-core-ui'
import type { EnvironmentFolder, FolderItem } from '../../../shared/types/folderTypes'
import { isAnyFolder, isRequest } from '../../../shared/types/folderTypes'
import { authPrefetchOneShot, resolveProducedHeaders } from '../AuthenticationPrefetch'

/**
 * Run the env folder's attached auth route to produce the headers
 * the spec fetch needs. Mirrors the import-modal flow: walks the
 * folder for the request whose `id` matches `apiUpdate.authenticationRequestId`,
 * fires it via `authPrefetchOneShot`, resolves its `producedHeaders`
 * Handlebars against the response body, and returns the resulting
 * key/value map.
 *
 * Returns an empty object when:
 *
 * - no auth request is configured (caller should fall back to
 *   `apiUpdate.sourceHeaders` only),
 * - the configured id no longer matches any request in the folder
 *   (treat as if no auth is configured — the user can re-attach
 *   from the env folder home),
 * - the prefetch failed (errors logged, surfaces upstream as a
 *   401 / 403 on the spec fetch which the user already has UX for).
 */
interface AuthRequestLike {
  id?: string
  type?: string
  method?: string
  url?: string
  headers?: { key: string; value: unknown; enabled?: boolean }[]
  producedHeaders?: { key: string; value: unknown; enabled?: boolean }[]
  body?: AuthBodyLike
}

interface AuthBodyTextLike { type: 'text'; content?: string }
interface AuthBodyFormLike {
  type: 'x-www-form-urlencoded'
  fields?: { key: string; value: unknown; enabled?: boolean }[]
}
type AuthBodyLike = AuthBodyTextLike | AuthBodyFormLike | { type?: string }

function findRequestById(items: FolderItem[], id: string): AuthRequestLike | null {
  for (const item of items) {
    if (isAnyFolder(item)) {
      const inner = findRequestById(item.items, id)
      if (inner) return inner
      continue
    }
    if (isRequest(item)) {
      const r = item as AuthRequestLike
      if (r.id === id) return r
    }
  }
  return null
}

/**
 * Pull a string out of whatever shape the IPC marshal turned the
 * KV `value` into: a plain string, an `ExpressionValue` /
 * `StringValue` / `PasswordValue` class instance (still has a
 * meaningful `toString`), or the persisted `{ type, value }` shape
 * the renderer-→-main collection sync sends through
 * `JSON.parse(JSON.stringify(...))`.
 */
function extractString(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v && typeof v === 'object') {
    const obj = v as { toString?: () => string; value?: unknown }
    if (typeof obj.toString === 'function' && obj.toString !== Object.prototype.toString) {
      const out = obj.toString()
      if (out !== '[object Object]') return out
    }
    if (typeof obj.value === 'string') return obj.value
    if (typeof obj.value === 'number' || typeof obj.value === 'boolean') return String(obj.value)
  }
  return ''
}

function expandVars(template: string, vars: Record<string, string>): string {
  // Handle BOTH `${VAR}` (env-var-style) and `{{VAR}}` (Handlebars-style)
  // placeholders. The auth route's body fields are typically expressed
  // as Handlebars (`{{client_id}}`) since the user wires them up in
  // the local-auth wizard the same way they would in any HTTP request.
  // The sourceUrl/sourceHeaders path only knows `${VAR}`; supporting
  // both here keeps the resolution rule uniform across the auth
  // surfaces.
  return template
    .replace(/\$\{([^}]+)\}/g, (match, name: string) => vars[name] ?? match)
    .replace(/\{\{([^}]+)\}\}/g, (match, name: string) => vars[name.trim()] ?? match)
}

function resolveBody(body: AuthBodyLike | undefined, vars: Record<string, string>): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  if (body.type === 'text') {
    const content = (body as AuthBodyTextLike).content
    if (typeof content !== 'string') return undefined
    return expandVars(content, vars)
  }
  if (body.type === 'x-www-form-urlencoded') {
    const fields = (body as AuthBodyFormLike).fields ?? []
    const params = new URLSearchParams()
    for (const f of fields) {
      if (f.enabled === false) continue
      if (!f.key) continue
      params.append(f.key, expandVars(extractString(f.value), vars))
    }
    return params.toString()
  }
  return undefined
}

export async function resolveAuthHeadersForFolder(
  folder: EnvironmentFolder,
  authenticationRequestId: string | undefined,
  variables: Record<string, string>
): Promise<Record<string, string>> {
  if (!authenticationRequestId) {
    logger.warn('[apiUpdate.resolveAuth] no authenticationRequestId on apiUpdate config — skipping auth')
    return {}
  }
  const auth = findRequestById(folder.items, authenticationRequestId)
  if (auth?.type !== 'auth') {
    logger.warn('[apiUpdate.resolveAuth] auth request not found in folder', {
      authenticationRequestId,
      foundType: auth?.type ?? null,
      itemsAtRoot: folder.items.length,
      rootItemKinds: folder.items.map((i) => ({
        id: (i as { id?: string }).id ?? null,
        type: (i as { type?: string }).type ?? null,
        hasItems: 'items' in (i as object),
        nameOrUrl: (i as { name?: string; url?: string }).name ?? (i as { url?: string }).url ?? null
      })),
      variableKeys: Object.keys(variables)
    })
    return {}
  }
  if (!auth.method || !auth.url) {
    logger.warn('[apiUpdate.resolveAuth] auth request missing method/url', { method: auth.method, url: auth.url })
    return {}
  }

  const url = expandVars(auth.url, variables)
  const headers = (auth.headers ?? []).map((h) => ({
    key: h.key,
    value: expandVars(extractString(h.value), variables),
    ...(h.enabled !== undefined ? { enabled: h.enabled } : {})
  }))
  const body = resolveBody(auth.body, variables)

  // Form-urlencoded bodies need the matching Content-Type so the
  // service parses the payload. Mirrors the HTTPExecutionService
  // auth-prefetch path's behaviour.
  if (auth.body?.type === 'x-www-form-urlencoded' && !headers.some((h) => h.key.toLowerCase() === 'content-type')) {
    headers.push({ key: 'Content-Type', value: 'application/x-www-form-urlencoded', enabled: true })
  }

  logger.info('[apiUpdate.resolveAuth] dispatching prefetch', {
    method: auth.method,
    url,
    bodyType: auth.body?.type,
    bodyPreview: body?.slice(0, 200),
    variableKeys: Object.keys(variables),
    producedHeaderKeys: (auth.producedHeaders ?? []).map((h) => h.key)
  })

  const result = await authPrefetchOneShot({
    method: auth.method,
    url,
    headers,
    ...(body !== undefined ? { body } : {})
  })
  if (!result.success || result.statusCode === undefined || result.statusCode >= 400) {
    logger.warn('[apiUpdate.resolveAuth] prefetch failed', {
      url,
      statusCode: result.statusCode,
      error: result.error,
      bodyPreview: result.body?.slice(0, 200)
    })
    return {}
  }
  // resolveProducedHeaders expects each `value` to be a string;
  // after the IPC sync our producedHeaders carry the persisted
  // `{ type, value }` shape, which would crash inside the
  // Handlebars `template.includes('{{')` check. Flatten via
  // extractString first so the helper sees plain strings.
  const flatProducedHeaders = (auth.producedHeaders ?? []).map((h) => ({
    key: h.key,
    value: extractString(h.value),
    ...(h.enabled !== undefined ? { enabled: h.enabled } : {})
  }))
  const resolved = resolveProducedHeaders(flatProducedHeaders, result.body ?? '')
  logger.info('[apiUpdate.resolveAuth] resolved headers', { keys: Object.keys(resolved) })
  return resolved
}
