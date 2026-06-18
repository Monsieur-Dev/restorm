/**
 * Token redaction for authentication responses.
 *
 * When an AuthenticationRequest is run, its JSON response typically
 * carries bearer tokens (`access_token`, `refresh_token`, `id_token`,
 * …). We shouldn't let those land in the project file verbatim — the
 * response history is persisted on disk.
 *
 * This helper walks the list of `producedHeaders` (each of which
 * references one or more JSON fields via handlebars `{{...}}`) and
 * replaces every referenced field in the body with `"***"`. Anything
 * the auth request doesn't explicitly consume is left alone.
 */

const HANDLEBARS_VAR = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)\s*\}\}/g

/** Parse every handlebars variable reference out of a template. */
export function collectHandlebarsReferences(template: string): string[] {
  const out: string[] = []
  let match: RegExpExecArray | null
  while ((match = HANDLEBARS_VAR.exec(template)) !== null) {
    const captured = match[1]
    if (captured) out.push(captured)
  }
  return out
}

const REDACTED = '***'

function referencedPaths(
  producedHeaders: readonly { key: string; value: string; enabled?: boolean }[]
): Set<string> {
  const paths = new Set<string>()
  for (const kv of producedHeaders) {
    if (kv.enabled === false) continue
    for (const ref of collectHandlebarsReferences(kv.value)) {
      // Skip the synthetic `body` reference the cache service uses
      // for non-JSON bodies — there's nothing to redact in a flat
      // string context.
      if (ref === 'body') continue
      paths.add(ref)
    }
  }
  return paths
}

/** Read the string value at `a.b.c` in a parsed JSON object, or undefined. */
function valueAtPath(target: unknown, segments: readonly string[]): string | undefined {
  let cur: unknown = target
  for (const seg of segments) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return typeof cur === 'string' ? cur : undefined
}

/**
 * Redact token-bearing fields from a response body before it lands in
 * the on-disk history archive.
 *
 * - JSON body: every `producedHeaders` `{{field.path}}` is overwritten
 *   with `***`.
 * - Non-JSON body (form-encoded `access_token=…`, a bare token, …):
 *   JSON.parse fails, so there are no paths to walk — but a token can
 *   still be sitting in clear. We substring-redact any known token
 *   VALUES (collected from JSON sibling responses isn't possible here,
 *   so we fall back to the `extraSecretValues` the caller supplies).
 */
export function redactTokensFromBody(
  rawBody: string,
  producedHeaders: readonly { key: string; value: string; enabled?: boolean }[],
  extraSecretValues: readonly string[] = []
): string {
  if (!rawBody) return rawBody

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    // Non-JSON body: substring-redact any known secret values.
    return redactSecretSubstrings(rawBody, extraSecretValues)
  }

  const paths = referencedPaths(producedHeaders)
  if (paths.size === 0) return redactSecretSubstrings(rawBody, extraSecretValues)

  for (const path of paths) {
    redactPath(parsed, path.split('.'))
  }
  let out = JSON.stringify(parsed)
  if (extraSecretValues.length > 0) out = redactSecretSubstrings(out, extraSecretValues)
  return out
}

/**
 * Collect the resolved token VALUES at the producedHeaders paths in a
 * JSON body. These are the strings that must not survive in clear in
 * the persisted response headers (an auth response often echoes the
 * token in a `Set-Cookie` / custom header too).
 */
export function collectTokenValues(
  rawBody: string,
  producedHeaders: readonly { key: string; value: string; enabled?: boolean }[]
): string[] {
  if (!rawBody) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return []
  }
  const out: string[] = []
  for (const path of referencedPaths(producedHeaders)) {
    const v = valueAtPath(parsed, path.split('.'))
    if (v && v.length >= 4) out.push(v)
  }
  return out
}

/** Replace every occurrence of each secret value with `***`. */
export function redactSecretSubstrings(text: string, secretValues: readonly string[]): string {
  let out = text
  for (const secret of secretValues) {
    if (!secret || secret.length < 4) continue
    out = out.split(secret).join(REDACTED)
  }
  return out
}

/**
 * Redact known token values out of a persisted header set. Returns a
 * fresh array; never mutates the input.
 */
export function redactTokensFromHeaders<T extends { key: string; value: string }>(
  headers: readonly T[],
  secretValues: readonly string[]
): T[] {
  if (secretValues.length === 0) return headers.slice()
  return headers.map((h) => ({ ...h, value: redactSecretSubstrings(h.value, secretValues) }))
}

function redactPath(target: unknown, segments: readonly string[]): void {
  if (segments.length === 0) return
  if (target === null || typeof target !== 'object') return
  const [head, ...rest] = segments
  if (!head) return
  const obj = target as Record<string, unknown>
  if (!(head in obj)) return
  if (rest.length === 0) {
    obj[head] = '***'
    return
  }
  redactPath(obj[head], rest)
}
