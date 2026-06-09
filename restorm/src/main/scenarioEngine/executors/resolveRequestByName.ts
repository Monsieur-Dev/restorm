/**
 * Resolve a Bruno `bru.runRequest(target)` reference to a concrete request in
 * the open project. Bruno accepts a few shapes for `target` — a bare request
 * name (`Login`), a collection-relative path (`Auth/Login`), or (defensively)
 * an item id — so rather than naively splitting on `/` (which mis-resolves a
 * request whose NAME literally contains a slash), we collect every candidate
 * request with all of its identifying forms and match the most specific one
 * first.
 *
 * Match priority (most specific → least):
 *   1. exact item id
 *   2. exact full path (folder names joined by `/`) — also matches a request
 *      literally named `a/b` at the root, since its path IS `a/b`
 *   3. exact leaf name (the request's own name)
 *   4. the leaf of the REQUESTED path — the Bruno `folder/req` form when the
 *      folder segments don't line up with our tree (e.g. index prefixes, a
 *      flattened import); falls back to matching just `req`
 *
 * Within a tier the first match in tree order wins (best-effort on an ambiguous
 * project — duplicate names are the user's own doing).
 *
 * The path uses the items' CLEAN names (no `NN - ` index prefixes — those exist
 * only on disk in folder-save mode, never in the in-memory tree).
 */
import { isHTTPRequest } from '../../../shared/types/collections'

export interface ResolvedRequest {
  id: string
  method: string
}

interface Candidate {
  id: string
  method: string
  /** The request's own name. */
  leaf: string
  /** Folder names along the path + the request name, joined by `/`. */
  path: string
}

interface TreeItem {
  name?: string
  id?: string
  method?: string
  items?: unknown[]
}

function collectCandidates(roots: readonly unknown[]): Candidate[] {
  const out: Candidate[] = []
  const walk = (items: readonly unknown[], prefix: readonly string[]): void => {
    for (const it of items) {
      const item = it as TreeItem
      const name = typeof item.name === 'string' ? item.name : ''
      if (Array.isArray(item.items)) {
        walk(item.items, name ? [...prefix, name] : prefix)
      } else if (name !== '' && isHTTPRequest(item as never) && typeof item.id === 'string') {
        out.push({ id: item.id, method: item.method ?? 'GET', leaf: name, path: [...prefix, name].join('/') })
      }
    }
  }
  walk(roots, [])
  return out
}

/** Resolve `target` (id / name / `folder/req` path) to `{ id, method }`, or
 * `undefined` when nothing in the tree matches. Pure — takes the collections
 * array so it can be unit-tested without the live `collectionStore`. */
export function resolveRequestByName(roots: readonly unknown[], target: string): ResolvedRequest | undefined {
  const wanted = target.trim()
  if (wanted === '') return undefined
  const cands = collectCandidates(roots)
  const pick = (c: Candidate | undefined): ResolvedRequest | undefined => (c ? { id: c.id, method: c.method } : undefined)

  // 1. exact id
  const byId = cands.find((c) => c.id === wanted)
  if (byId) return pick(byId)
  // 2. exact full path (also a root request literally named `a/b`)
  const byPath = cands.find((c) => c.path === wanted)
  if (byPath) return pick(byPath)
  // 3. exact leaf name
  const byLeaf = cands.find((c) => c.leaf === wanted)
  if (byLeaf) return pick(byLeaf)
  // 4. leaf of the requested path (folder segments don't map to our tree)
  const reqLeaf = wanted.split('/').pop()?.trim()
  if (reqLeaf && reqLeaf !== wanted) {
    const byReqLeaf = cands.find((c) => c.leaf === reqLeaf)
    if (byReqLeaf) return pick(byReqLeaf)
  }
  return undefined
}
