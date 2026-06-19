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

// Any `{{ ... }}` mustache. We grab the whole inner expression and then
// pull the field path out of it, so helper-wrapped refs (`{{json a.b}}`),
// bracket/quoted segments (`{{a.[0].b}}`, `{{token.['x-y']}}`) and plain
// dot-paths are all recognised — the old expression only matched bare
// dot-paths and silently let the other forms slip past redaction.
const HANDLEBARS_BLOCK = /\{\{\{?([^}]*?)\}?\}\}/g

/**
 * Extract the field path from a single mustache's inner expression.
 * Returns `undefined` when no concrete dotted path can be recovered (a
 * bare helper call, a subexpression, etc.) so the caller can fall back to
 * a fail-safe whole-body redaction rather than leaving a token in clear.
 */
function pathFromExpression(expr: string): string | undefined {
  let inner = expr.trim()
  if (!inner) return undefined
  // Strip a leading block/helper marker (`#if`, `/each`, `>partial`, `!`).
  if (/^[#/>!^&]/.test(inner)) return undefined
  // Drop a leading helper name + take its FIRST argument, e.g.
  // `json access_token` → `access_token`. A quoted/literal arg isn't a path.
  const tokens = inner.split(/\s+/)
  if (tokens.length > 1) inner = tokens[1]
  if (!inner || /^["'(]/.test(inner)) return undefined
  // Normalise bracket segments to dot segments: `a.[0].b` / `a['x']` → `a.0.b`/`a.x`.
  const normalised = inner
    .replace(/\[\s*'([^']*)'\s*\]/g, '.$1')
    .replace(/\[\s*"([^"]*)"\s*\]/g, '.$1')
    .replace(/\[\s*([^\]]+?)\s*\]/g, '.$1')
    .replace(/^\./, '')
    .replace(/\.\.+/g, '.')
  // Only accept identifier/index/JSON-key segments (letters, digits, _, $, -).
  // Anything else (an operator, a path expression we don't understand) is not
  // a safe field path → caller fails safe.
  if (!/^[A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*$/.test(normalised)) return undefined
  return normalised
}

/** Parse every handlebars variable reference out of a template. */
export function collectHandlebarsReferences(template: string): string[] {
  return collectReferences(template).paths
}

/**
 * Pull field paths out of a template along with a flag telling the caller
 * whether some mustache referenced a value we could NOT resolve to a
 * concrete path — in which case redaction must fail safe.
 */
function collectReferences(template: string): { paths: string[]; hasUnresolved: boolean } {
  const out: string[] = []
  let hasUnresolved = false
  let match: RegExpExecArray | null
  HANDLEBARS_BLOCK.lastIndex = 0
  while ((match = HANDLEBARS_BLOCK.exec(template)) !== null) {
    const expr = match[1] ?? ''
    if (!expr.trim()) continue
    const path = pathFromExpression(expr)
    if (path) out.push(path)
    else hasUnresolved = true
  }
  return { paths: out, hasUnresolved }
}

const REDACTED = '***'

function referencedPaths(
  producedHeaders: readonly { key: string; value: string; enabled?: boolean }[]
): { paths: Set<string>; hasUnresolved: boolean } {
  const paths = new Set<string>()
  let hasUnresolved = false
  for (const kv of producedHeaders) {
    if (kv.enabled === false) continue
    const { paths: refs, hasUnresolved: unresolved } = collectReferences(kv.value)
    if (unresolved) hasUnresolved = true
    for (const ref of refs) {
      // Skip the synthetic `body` reference the cache service uses
      // for non-JSON bodies — there's nothing to redact in a flat
      // string context.
      if (ref === 'body') continue
      paths.add(ref)
    }
  }
  return { paths, hasUnresolved }
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

  const { paths, hasUnresolved } = referencedPaths(producedHeaders)

  // Fail safe: an auth template referenced a value we couldn't resolve to a
  // concrete field path (a helper/subexpression we don't model). Rather than
  // risk leaving a token in clear, redact the whole JSON body.
  if (hasUnresolved) return JSON.stringify(REDACTED)

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
  for (const path of referencedPaths(producedHeaders).paths) {
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

  // Array: a path can land on (or pass through) a list. Apply the remaining
  // segments to every element so tokens nested in arrays still get redacted —
  // unless the segment is an explicit numeric index into the array.
  if (Array.isArray(target)) {
    const [maybeIndex] = segments
    if (maybeIndex !== undefined && /^\d+$/.test(maybeIndex)) {
      const idx = Number(maybeIndex)
      const rest = segments.slice(1)
      if (idx < target.length) {
        if (rest.length === 0) {
          if (typeof target[idx] === 'string') target[idx] = '***'
        } else {
          redactPath(target[idx], rest)
        }
      }
      return
    }
    for (const item of target) redactPath(item, segments)
    return
  }

  const [head, ...rest] = segments
  if (!head) return
  const obj = target as Record<string, unknown>
  if (!(head in obj)) return
  if (rest.length === 0) {
    const cur = obj[head]
    if (Array.isArray(cur)) {
      // Leaf is an array of (presumably) token strings — redact each.
      obj[head] = (cur as unknown[]).map((el) => (typeof el === 'string' ? '***' : el))
    } else {
      obj[head] = '***'
    }
    return
  }
  redactPath(obj[head], rest)
}
