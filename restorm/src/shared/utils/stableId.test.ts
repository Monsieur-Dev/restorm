import { describe, it, expect } from 'vitest'
import { DERIVED_ID_NAMESPACE, deriveStableId, idPathSegment } from './stableId'
import { REQUEST_TYPES } from '../protocolRegistry'

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('deriveStableId', () => {
  it('produces a well-formed UUID v5 (version nibble 5, RFC-4122 variant)', () => {
    expect(deriveStableId(['collections', 'folder:Pet'])).toMatch(UUID_V5)
    expect(deriveStableId([])).toMatch(UUID_V5)
    expect(deriveStableId(['kv:Authorization'])).toMatch(UUID_V5)
  })

  it('is a pure function of the path — same input, same id', () => {
    const path = ['collections', 'folder:Pet', 'items', 'req:http:Find pet by ID']
    expect(deriveStableId(path)).toBe(deriveStableId([...path]))
  })

  it('separates path segments unambiguously — no path can be spelled two ways', () => {
    // Joined with any single character these would hash the same input.
    // The array is serialized with its quoting intact, so segment
    // boundaries survive whatever the segments themselves contain.
    expect(deriveStableId(['a', 'b'])).not.toBe(deriveStableId(['a/b']))
    expect(deriveStableId(['a', 'b'])).not.toBe(deriveStableId(['ab']))
    expect(deriveStableId(['a', 'b'])).not.toBe(deriveStableId(['a.b']))
    expect(deriveStableId(['a', 'b'])).not.toBe(deriveStableId(['a"b']))
    // An occurrence suffix is its own element, so a segment literally
    // named `#1` cannot impersonate the second occurrence of another.
    expect(deriveStableId(['folder:X', '#1'])).not.toBe(deriveStableId(['folder:X#1']))
  })

  it('is sensitive to segment content, order and depth', () => {
    expect(deriveStableId(['folder:A'])).not.toBe(deriveStableId(['folder:B']))
    expect(deriveStableId(['a', 'b'])).not.toBe(deriveStableId(['b', 'a']))
    expect(deriveStableId(['a'])).not.toBe(deriveStableId(['a', 'a']))
  })

  it('survives a name no encoder can round-trip', () => {
    // A lone surrogate is a legal JS string but not legal UTF-8, and the
    // digest's input encoding rejects it. A project carrying one in a name
    // must still OPEN — the backfill cannot be a reason a file stops
    // loading, which the previous random id never was.
    const loneSurrogate = 'req:http:bad \uD800 name'

    expect(() => deriveStableId([loneSurrogate])).not.toThrow()
    expect(deriveStableId([loneSurrogate])).toMatch(UUID_V5)
    expect(deriveStableId([loneSurrogate])).toBe(deriveStableId([loneSurrogate]))
    expect(deriveStableId([loneSurrogate])).not.toBe(deriveStableId(['req:http:bad name']))
  })

  it('handles ordinary non-ASCII names', () => {
    expect(deriveStableId(['folder:Café', 'items', 'req:http:日本語'])).toMatch(UUID_V5)
    expect(deriveStableId(['folder:Café'])).not.toBe(deriveStableId(['folder:Cafe']))
  })

  it('pins the derivation contract with a frozen vector', () => {
    // Changing this value re-derives DIFFERENT ids for every project whose
    // ids are not yet persisted, so two builds straddling the change stop
    // pairing up their entities in the git diff and the conflict model.
    // Update it only as part of a deliberate, documented migration.
    expect(DERIVED_ID_NAMESPACE).toBe('restorm.document-id.v1')
    expect(deriveStableId(['collections', 'folder:Pet', 'items', 'req:http:Find pet by ID']))
      .toBe('49d2bd39-bed0-5ebc-96c8-13c38878e50f')
  })
})

describe('idPathSegment', () => {
  it('classifies a key-value row by its key', () => {
    expect(idPathSegment({ key: 'Authorization', value: 'Bearer x' })).toBe('kv:Authorization')
  })

  it('classifies an environment by its name, before the folder rule', () => {
    expect(idPathSegment({ name: 'Default', variables: [] })).toBe('env:Default')
  })

  it('classifies EVERY request type the protocol registry declares', () => {
    // Drift guard. A protocol missing here gets no id backfill at all, and —
    // worse — contributes no path segment, so its children fall back to
    // being told apart by array position, which is exactly what the
    // derivation exists to avoid. Deriving the list from the registry means
    // a new protocol cannot be forgotten.
    for (const type of REQUEST_TYPES) {
      expect(idPathSegment({ name: 'Ping', type }), `${type} must be classified`).toBe(`req:${type}:Ping`)
    }
    expect(REQUEST_TYPES.length).toBeGreaterThanOrEqual(15)
  })

  it('classifies a folder and an environment-folder alike', () => {
    expect(idPathSegment({ name: 'Pet', items: [], configuration: {} })).toBe('folder:Pet')
    expect(idPathSegment({ name: 'API', items: [], configuration: {}, folderType: 'environment' })).toBe('folder:API')
  })

  it('classifies a scenario by its name', () => {
    // A scenario is a top-level tree entity like a folder or a request, and
    // both git engines pair it by id — but no other branch recognises it: it
    // has no `variables`, no `configuration`, and its `type` is not a
    // protocol. Left unclassified it got no backfill AND contributed no path
    // segment, so its children were told apart by array position.
    expect(idPathSegment({ type: 'scenario', name: 'Smoke', tags: [], params: [], nodes: [], edges: [] }))
      .toBe('scenario:Smoke')
    // A scenario doubles as a container: carrying `items` must not divert it
    // into the folder branch (it has no `configuration`, but stating it).
    expect(idPathSegment({ type: 'scenario', name: 'Nested', items: [], nodes: [], edges: [] }))
      .toBe('scenario:Nested')
  })

  it('classifies a request-keyed record by the request it points at, plus its own name', () => {
    expect(idPathSegment({ requestId: 'r1' })).toBe('ref:r1')
    // Two saved quick-configs of the same request stay distinguishable by
    // content rather than by their position in the array.
    expect(idPathSegment({ name: 'Recette', requestId: 'r1', storageTarget: 'project', fields: {} }))
      .toBe('ref:r1:Recette')
  })

  it('returns null for anything that is not an id-bearing entity', () => {
    expect(idPathSegment({})).toBeNull()
    expect(idPathSegment({ name: 'Loose' })).toBeNull()
    expect(idPathSegment({ name: 'Node', kind: 'httpRequest', config: {} })).toBeNull()
    // An unknown `type` is not a request — the list is a closed contract.
    expect(idPathSegment({ name: 'Mystery', type: 'telepathy' })).toBeNull()
  })

  it('still yields a deterministic segment when a name is not a string', () => {
    expect(idPathSegment({ name: 42, items: [], configuration: {} })).toBe('folder:42')
    expect(idPathSegment({ name: null, variables: [] })).toBe('env:null')
  })
})
