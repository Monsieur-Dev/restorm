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

/**
 * Redact JSON-encoded body: every `producedHeaders` value is parsed
 * for `{{field.path}}` references, and each path is overwritten with
 * `"***"` in the body. Non-JSON bodies are returned unchanged.
 */
export function redactTokensFromBody(
  rawBody: string,
  producedHeaders: readonly { key: string; value: string; enabled?: boolean }[]
): string {
  if (!rawBody) return rawBody
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return rawBody
  }

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
  if (paths.size === 0) return rawBody

  for (const path of paths) {
    redactPath(parsed, path.split('.'))
  }
  return JSON.stringify(parsed)
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
