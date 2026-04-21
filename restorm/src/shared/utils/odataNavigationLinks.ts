/**
 * Walks a parsed OData response body and extracts every OData-
 * annotation URL worth surfacing to the user: `@odata.context`,
 * `@odata.id`, `@odata.editLink`, `@odata.readLink`, `@odata.*Link`
 * (covers navigation-link / bind annotations), and any nested
 * occurrence in `value[]` / expanded property arrays.
 *
 * v2/v3 responses go through the shared normalizer before they reach
 * here, so the keys are always in v4 shape.
 */

export interface ExtractedNavigationLink {
  /** The annotation key as it appeared, e.g. `@odata.nextLink` or
   * `Category@odata.navigationLink`. */
  key: string
  /** The URL value. */
  url: string
  /** Dotted path to the parent in the response tree: '' for root,
   * `value[0]` for the first result, `value[0].Category` for a
   * nested navigation property. Useful to disambiguate duplicates. */
  path: string
}

const ODATA_KEY_PATTERN = /^(?:@odata\.|.+?@odata\.)(?:context|id|editLink|readLink|.*Link)$/

export function extractNavigationLinks(body: unknown): ExtractedNavigationLink[] {
  const out: ExtractedNavigationLink[] = []
  walk(body, '', out)
  // De-duplicate by (key+url) pair — the same nextLink can appear on a
  // paged response + @odata.context; we don't want noise.
  const seen = new Set<string>()
  return out.filter((link) => {
    const sig = `${link.key}|${link.url}`
    if (seen.has(sig)) return false
    seen.add(sig)
    return true
  })
}

function walk(value: unknown, path: string, out: ExtractedNavigationLink[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => { walk(item, `${path}[${index}]`, out) })
    return
  }
  if (value === null || typeof value !== 'object') return

  for (const [key, val] of Object.entries(value)) {
    if (typeof val === 'string' && ODATA_KEY_PATTERN.test(key)) {
      out.push({ key, url: val, path })
      continue
    }
    // Only recurse into nested records / arrays — primitives can't
    // carry nav links and iterating over strings wastes time.
    if (val !== null && typeof val === 'object') {
      const nextPath = path === '' ? key : `${path}.${key}`
      walk(val, nextPath, out)
    }
  }
}
