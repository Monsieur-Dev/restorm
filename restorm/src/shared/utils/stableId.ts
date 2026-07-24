/**
 * Content-derived document ids — the load-time id BACKFILL's source of
 * randomness, removed.
 *
 * A project file does not carry an id for every entity: files written
 * before document ids were persisted (and every import) arrive with none,
 * and the loader mints one so the rest of the app has something to key on.
 * Minting it with `crypto.randomUUID()` made that backfill a per-process
 * coin toss, and both git engines pair entities BY ID:
 *
 * - `diffProjectEntities` compares the live tree against a separate parse
 *   of the HEAD blob — with random ids the two sides share none, so every
 *   entity reads as `deleted` + `added`;
 * - `identifyConflictingEntities` parses `ours` / `theirs` / `base` three
 *   times independently — with random ids the three id sets are disjoint,
 *   no entity ever pairs up, and NO conflict is ever reported. Silent work
 *   loss, not cosmetics.
 *
 * So the backfill is a pure function of the document: the same bytes yield
 * the same ids, in any process, on any machine, on any build. Only the
 * backfill — `generateId()` (`serialization.ts`) stays random, because a
 * brand-new object created in the app, and an import grafted onto an
 * existing tree, must NOT collide with what is already there.
 *
 * The derived value is a UUID v5 over a semantic path (see
 * {@link deriveStableId}), so it is indistinguishable from a persisted id
 * downstream: no format flag, no migration, no `fileFormatVersion` bump.
 */

import CryptoJS from 'crypto-js'
import { REQUEST_TYPES } from '../protocolRegistry'
import type { RuntimeId } from '../types/collections'

/**
 * The derivation namespace. Treat it — together with the path grammar in
 * {@link idPathSegment} — as a STABLE CONTRACT, the same status as
 * `CANONICAL_KEY_PRIORITY` in `serialization.ts`: changing either re-derives
 * DIFFERENT ids for every file whose ids are not yet persisted, so two
 * builds straddling the change would no longer pair up their entities.
 * Ids already written to a file are never re-derived, so a changed
 * namespace cannot corrupt an already-saved project — it only reopens the
 * pairing window for the files that never got saved. See
 * `docs/git-integration.md` (Stable document ids).
 */
export const DERIVED_ID_NAMESPACE = 'restorm.document-id.v1'

/**
 * Serialize the namespace + path into the digest's input.
 *
 * `JSON.stringify` of the ARRAY, deliberately, for two independent reasons:
 *
 * - **Unambiguous by construction.** Quoting and escaping every segment
 *   means no path can be spelled two ways and no name can impersonate a
 *   different path — including a segment literally named `#1`, which must
 *   not read as the second occurrence of another. A plain join relies on
 *   its separator staying outside every segment's alphabet; this relies on
 *   nothing.
 * - **It cannot throw on a name JS allows but UTF-8 does not.**
 *   `CryptoJS.SHA1(string)` encodes through `encodeURIComponent`, which
 *   raises `URIError` on an unpaired surrogate — so a project carrying one
 *   in a name would fail to LOAD, a regression against the random id this
 *   replaced, which could not throw. Well-formed `JSON.stringify` (ES2019)
 *   escapes lone surrogates to `\uXXXX`, keeping the digest input always
 *   encodable; ordinary non-ASCII (`é`, `日本`) passes through literally
 *   and encodes normally.
 */
function digestInput(pathSegments: readonly string[]): string {
  return JSON.stringify([DERIVED_ID_NAMESPACE, ...pathSegments])
}

/**
 * Derive a UUID-v5-shaped id from a semantic path.
 *
 * `SHA-1(digestInput(path))`, truncated to 16 bytes and
 * stamped with RFC-4122's version (5) and variant bits — the same
 * construction as a name-based UUID v5, computed with `crypto-js` because
 * the caller is a synchronous tree walk and Web Crypto's `subtle.digest`
 * is async (`crypto-js` is already a production dependency, used in
 * `scenarioCrypto.ts`, and runs identically in both processes).
 *
 * The output is a normal uuid: nothing downstream can tell a derived id
 * from a persisted one, which is exactly the point.
 */
export function deriveStableId(pathSegments: readonly string[]): RuntimeId {
  const digest = CryptoJS.SHA1(digestInput(pathSegments)).toString()
  // A short digest would parse into `NaN` bytes and silently derive one
  // constant id for every entity — fail loudly instead.
  if (digest.length < 32) throw new Error(`Expected a SHA-1 hex digest, got ${digest.length} chars`)
  const bytes: number[] = []
  for (let i = 0; i < 16; i++) bytes.push(parseInt(digest.slice(i * 2, i * 2 + 2), 16))
  // Version 5 (name-based, SHA-1) in the high nibble of byte 6…
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50
  // …and the RFC-4122 variant in the two high bits of byte 8.
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * The identity segment an entity contributes to its derivation path, or
 * `null` when the object is not an id-bearing entity at all.
 *
 * This function is BOTH the classifier ("should this object have an id?")
 * and the path grammar, deliberately: a separate predicate would drift from
 * the segment builder, and a drift means an entity classified on one build
 * and not on the other — the exact failure this module exists to remove.
 * Recognised shapes, in this order (the order matters: a request also has
 * a `name`, an environment-folder also has `items`):
 *
 * - **KeyValue** — `key` + `value` → `kv:<key>`
 * - **Environment** — `name` + `variables[]` → `env:<name>`
 * - **Request** — `name` + a known `type` discriminant → `req:<type>:<name>`
 * - **Folder / environment-folder** — `name` + `items[]` + `configuration`
 *   → `folder:<name>`
 * - **Anything keyed to a request** (a response, a saved quick-config) —
 *   `requestId` → `ref:<requestId>` plus its `name` when it has one, so
 *   several quick-configs of the same request stay distinguishable by
 *   content rather than by position.
 *
 * The segments are NAMES, never array indices: inserting an entity at the
 * head of a container must not shift the ids of its siblings, otherwise
 * `ours` and `theirs` re-derive different ids for untouched entities and
 * the three-way pairing breaks again — which is the whole point.
 */
export function idPathSegment(record: Record<string, unknown>): string | null {
  if ('key' in record && 'value' in record && typeof record['key'] === 'string') {
    return `kv:${record['key']}`
  }

  if ('name' in record && 'variables' in record && Array.isArray(record['variables'])) {
    return `env:${asText(record['name'])}`
  }

  // Request types come from the protocol registry, the single source of
  // truth for `type` discriminants — never a hand-copied list. A protocol
  // missing here gets no id backfill AND contributes no path segment, so
  // its key-values collapse onto the parent's path and end up told apart
  // by array position, which is the one thing this derivation must never
  // depend on.
  if ('name' in record && 'type' in record) {
    if ((REQUEST_TYPES as readonly string[]).includes(record['type'] as string)) {
      return `req:${record['type'] as string}:${asText(record['name'])}`
    }
  }

  if ('name' in record && 'items' in record && 'configuration' in record && Array.isArray(record['items'])) {
    return `folder:${asText(record['name'])}`
  }

  if ('requestId' in record && typeof record['requestId'] === 'string') {
    const name = 'name' in record ? `:${asText(record['name'])}` : ''
    return `ref:${record['requestId']}${name}`
  }

  return null
}

/** A path segment's textual part. A malformed document can carry a
 * non-string where a name is expected; the walk must still produce SOME
 * deterministic segment rather than `[object Object]` drift. */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null)
}
