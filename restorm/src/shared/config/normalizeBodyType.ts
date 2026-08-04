/**
 * Body-type canonicalisation migration for loaded Restorm documents.
 *
 * The canonical `body.type` vocabulary is kebab-case
 * (`'text' | 'file' | 'form-data' | 'x-www-form-urlencoded'`). Older
 * persisted files used camelCase spellings (`'formData'`,
 * `'xWwwFormUrlEncoded'`) for the two multi-word members. This module
 * rewrites those legacy spellings to the canonical kebab form on load,
 * in-place on the parsed plain object, so the rest of the app only ever
 * sees one vocabulary and the next user-initiated save re-persists the
 * canonical form.
 *
 * It runs on the parsed tree **before** the reactive proxy wrap and
 * **before** the whole-file content-checksum baseline — same contract as
 * `stripLegacyFileFormatVersion` — so the normalisation is part of the
 * "loaded" snapshot and never looks like a user edit.
 */

/** Legacy camelCase spelling → canonical kebab-case spelling. */
const LEGACY_BODY_TYPE_ALIASES: Readonly<Record<string, string>> = {
  formData: 'form-data',
  xWwwFormUrlEncoded: 'x-www-form-urlencoded'
}

/**
 * Walk a parsed plain object tree in-place and rewrite any legacy
 * `body.type` spelling to its canonical kebab form.
 *
 * Intentionally tolerant: it descends every array/object without
 * assuming a particular container shape (collections, folders, items,
 * scenario nodes, …), so a `body` carried anywhere in the document is
 * caught. Non-object inputs short-circuit cleanly.
 */
export function normalizeBodyTypes(root: unknown): void {
  if (root === null || typeof root !== 'object') return

  if (Array.isArray(root)) {
    for (const entry of root) normalizeBodyTypes(entry)
    return
  }

  const node = root as Record<string, unknown>

  const body = node['body']
  if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    const bodyNode = body as Record<string, unknown>
    const type = bodyNode['type']
    if (typeof type === 'string' && type in LEGACY_BODY_TYPE_ALIASES) {
      bodyNode['type'] = LEGACY_BODY_TYPE_ALIASES[type]
    }
  }

  for (const value of Object.values(node)) {
    if (value !== null && typeof value === 'object') normalizeBodyTypes(value)
  }
}
