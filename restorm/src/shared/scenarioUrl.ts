/**
 * Pure URL / query-string core for the scenario `url` node — the ONE
 * implementation the RUNTIME (`urlExecutor`) and the INSPECTOR PREVIEW
 * (`scenarioStaticPreview`) both call, so the two can never drift (same pattern
 * as `scenarioJson` / `scenarioCrypto`).
 *
 * `applyUrl` THROWS on invalid input — a malformed `%`-escape (`decode`), a
 * non-object operand (`buildQuery`), or an unparseable URL (`parseUrl`). The
 * runtime routes that to the `error` port; the preview catches it into "no
 * result".
 */

/** The operations a `url` node can run. */
export type UrlOp = 'encode' | 'decode' | 'parseQuery' | 'buildQuery' | 'parseUrl'

export const URL_OPS: readonly UrlOp[] = ['encode', 'decode', 'parseQuery', 'buildQuery', 'parseUrl']

export const isUrlOp = (v: unknown): v is UrlOp =>
  typeof v === 'string' && (URL_OPS as readonly string[]).includes(v)

function toInputString(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  if (v === null || v === undefined) return ''
  return JSON.stringify(v)
}

/**
 * Run `op` over `value`.
 *
 * - **encode / decode**: percent-encode / -decode a single component
 *   (`encodeURIComponent` / `decodeURIComponent`). A malformed escape on decode
 *   THROWS.
 * - **parseQuery**: a query string (`"a=1&b=2"`, leading `?` optional) → an
 *   object. Repeated keys collapse to the last value.
 * - **buildQuery**: an object → a query string (`"a=1&b=2"`, values stringified,
 *   percent-encoded). A non-object value THROWS.
 * - **parseUrl**: a URL string → `{ protocol, hostname, port, pathname, search,
 *   hash, origin, query }` (`query` is the parsed search params). An unparseable
 *   URL THROWS.
 */
export function applyUrl(value: unknown, op: UrlOp): unknown {
  switch (op) {
    case 'encode':
      return encodeURIComponent(toInputString(value))
    case 'decode':
      return decodeURIComponent(toInputString(value))
    case 'parseQuery': {
      const raw = toInputString(value).replace(/^\?/, '')
      const out: Record<string, string> = {}
      for (const [k, v] of new URLSearchParams(raw)) out[k] = v
      return out
    }
    case 'buildQuery': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('buildQuery expects an object of key/value pairs')
      }
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        params.append(k, toInputString(v))
      }
      return params.toString()
    }
    case 'parseUrl': {
      const u = new URL(toInputString(value))
      const query: Record<string, string> = {}
      for (const [k, v] of u.searchParams) query[k] = v
      return {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        pathname: u.pathname,
        search: u.search,
        hash: u.hash,
        origin: u.origin,
        query
      }
    }
  }
}
