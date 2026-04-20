/**
 * OData system query option serialization.
 *
 * Pure helpers that translate an `ODataQueryOptions` object into the
 * canonical OData URL query string. Kept free of Node / renderer
 * dependencies so the engine (main process) and the URL preview in
 * `<ODataRequestTabView>` (renderer) can both call them.
 *
 * v2/v3 differences are folded into the `version` argument (Phase 1
 * ships v4 only; v2/v3 diverge on `$count` → `$inlinecount`).
 *
 * Values are expected to be env-substituted *before* calling these
 * helpers — the engine runs `resolveTemplate` on each one first.
 */

import type { ODataQueryOptions, ODataVersion } from '../types/collections'
import type { KeyValue } from '../types/baseTypes'

/** Canonical ordering we emit system options in. Purely cosmetic — OData
 * servers don't require a specific order — but stable output makes URLs
 * deterministic and copy-pasteable across runs. */
const V4_KEY_ORDER = ['$filter', '$select', '$top', '$skip', '$count'] as const

/**
 * Serialize the OData system query options of an `ODataRequest` into
 * an ordered array of `[key, value]` pairs.
 *
 * Empty / undefined fields are omitted entirely — the resulting URL
 * only carries options the user actually set. Whitespace-only
 * strings are treated as empty.
 */
export function serializeODataQueryOptions(
  options: ODataQueryOptions,
  version: ODataVersion = 'v4'
): [string, string][] {
  const out: [string, string][] = []

  if (options.filter !== undefined && options.filter.trim() !== '') {
    out.push(['$filter', options.filter])
  }
  if (options.select !== undefined && options.select.length > 0) {
    const list = options.select.map((s) => s.trim()).filter((s) => s !== '').join(',')
    if (list !== '') out.push(['$select', list])
  }
  if (options.top !== undefined && options.top !== '') {
    out.push(['$top', options.top])
  }
  if (options.skip !== undefined && options.skip !== '') {
    out.push(['$skip', options.skip])
  }
  if (options.count === true) {
    // v4 uses `$count=true`. v2 / v3 use `$inlinecount=allpages`; the
    // v2/v3 engine PR will flip this branch when it lands.
    if (version === 'v4') {
      out.push(['$count', 'true'])
    } else {
      out.push(['$inlinecount', 'allpages'])
    }
  }

  // Sort by canonical order for v4 (known keys first, unknown keys
  // appended alphabetically). Today every emitted key is in the
  // canonical list, but this keeps the contract stable as options are
  // added incrementally across phases.
  if (version === 'v4') {
    out.sort((a, b) => {
      const ia = V4_KEY_ORDER.indexOf(a[0] as (typeof V4_KEY_ORDER)[number])
      const ib = V4_KEY_ORDER.indexOf(b[0] as (typeof V4_KEY_ORDER)[number])
      if (ia === -1 && ib === -1) return a[0].localeCompare(b[0])
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    })
  }

  return out
}

/**
 * Compose the final request URL from a base URL, OData system option
 * pairs (keys start with `$`, kept unencoded), and caller-supplied
 * extra params (both key and value encoded).
 *
 * Callers:
 *   - pass `systemPairs` from `serializeODataQueryOptions`,
 *   - pass `extraPairs` derived from the request's non-OData `params`
 *     KeyValue list (already env-substituted).
 */
export function buildODataUrl(
  baseUrl: string,
  systemPairs: readonly (readonly [string, string])[],
  extraPairs: readonly (readonly [string, string])[]
): string {
  const parts: string[] = []
  for (const [key, value] of systemPairs) {
    // System option keys start with `$`; leave the key literal so the
    // URL is human-readable (servers accept `%24` too but it's ugly).
    parts.push(`${key}=${encodeURIComponent(value)}`)
  }
  for (const [key, value] of extraPairs) {
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  }
  if (parts.length === 0) return baseUrl
  const separator = baseUrl.includes('?') ? '&' : '?'
  return `${baseUrl}${separator}${parts.join('&')}`
}

/**
 * Convenience: flatten a request's non-OData `params: KeyValue[]` into
 * the `[key, value]` shape `buildODataUrl` expects. Disabled entries
 * (`kv.enabled === false`) and empty keys are dropped.
 */
export function keyValuesToPairs(params: readonly KeyValue[]): [string, string][] {
  const pairs: [string, string][] = []
  for (const kv of params) {
    if (kv.enabled === false) continue
    const key = kv.key.trim()
    if (!key) continue
    pairs.push([key, String(kv.value)])
  }
  return pairs
}
