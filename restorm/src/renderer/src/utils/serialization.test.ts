import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { generateIds, processAfterDeserialization } from './serialization'
import { idPathSegment } from '../../../shared/utils/stableId'
import { REQUEST_TYPES } from '../../../shared/protocolRegistry'
import { parseProjectYaml } from '../../../shared/git/gitCommitDiff'

interface ReqItem { id?: string; type: string; name: string }
interface FolderItem { name: string; configuration: Record<string, unknown>; items: ReqItem[] }
interface Tree { collections: FolderItem[] }

function idsOf(tree: Tree): ReqItem[] {
  const out = generateIds(tree)
  const folder = out.collections[0]
  if (!folder) throw new Error('expected a folder')
  return folder.items
}

describe('generateIds — request-type id assignment', () => {
  it('assigns ids to every request kind incl. odata and auth', () => {
    const items = idsOf({
      collections: [
        { name: 'F', configuration: {}, items: [
          { name: 'h', type: 'http' },
          { name: 'g', type: 'graphql' },
          { name: 'r', type: 'grpc' },
          { name: 's', type: 'soap' },
          { name: 'w', type: 'websocket' },
          { name: 'o', type: 'odata' },
          { name: 'a', type: 'auth' }
        ] }
      ]
    })
    for (const item of items) {
      expect(typeof item.id, `${item.type} should have an id`).toBe('string')
      expect((item.id ?? '').length).toBeGreaterThan(0)
    }
    // The regression: odata + auth previously fell through and got no id.
    expect(items.find((i) => i.type === 'odata')?.id).toBeTruthy()
    expect(items.find((i) => i.type === 'auth')?.id).toBeTruthy()
  })

  it('regenerates a duplicate id on copy-paste of an odata/auth request', () => {
    const items = idsOf({
      collections: [
        { name: 'F', configuration: {}, items: [
          { name: 'o1', type: 'odata', id: 'dup-id' },
          { name: 'o2', type: 'odata', id: 'dup-id' },
          { name: 'a1', type: 'auth', id: 'dup-auth' },
          { name: 'a2', type: 'auth', id: 'dup-auth' }
        ] }
      ]
    })
    const ids = items.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

/**
 * The id backfill is a pure function of the document. Both git engines pair
 * entities BY id across INDEPENDENT parses — the live tree against the HEAD
 * blob (`diffProjectEntities`), and `ours`/`theirs`/`base` against each
 * other (`identifyConflictingEntities`). A backfill that minted random ids
 * made those pairings fail wholesale on any file whose ids are not yet
 * persisted: the diff reported every entity as deleted+added, and no
 * conflict was ever detected at all.
 */
/**
 * Every entity id in a loaded document, paired with the identity segment
 * the derivation is built from. Only records `idPathSegment` recognises are
 * collected: a project also carries `id` fields that mean something else
 * entirely (a scenario node's input/output PORT ids — `in`, `result`,
 * `value` — which repeat freely across scenarios and are none of the
 * backfill's business).
 */
function entityIds(node: unknown, out: [string, string][] = []): [string, string][] {
  if (Array.isArray(node)) { for (const child of node) entityIds(child, out); return out }
  if (node === null || typeof node !== 'object') return out
  const record = node as Record<string, unknown>
  const segment = idPathSegment(record)
  if (segment !== null && typeof record['id'] === 'string') out.push([segment, record['id']])
  for (const child of Object.values(record)) entityIds(child, out)
  return out
}

describe('generateIds — the backfill is derived from the document, never random', () => {
  const idsIn = (loaded: unknown): string[] => entityIds(loaded).map(([, id]) => id)

  const legacyTree = {
    collections: [
      { name: 'Root', configuration: {}, folderType: 'environment',
        environments: [{ name: 'Default', variables: [{ key: 'port', value: '8080' }] }],
        items: [
          { name: 'Pet', configuration: {}, items: [
            { name: 'Find pet by ID', type: 'http' },
            { name: 'Add a pet', type: 'http' }
          ] }
        ] }
    ]
  }

  it('gives two independent loads of the same document identical ids', () => {
    const first = idsIn(processAfterDeserialization(structuredClone(legacyTree)))
    const second = idsIn(processAfterDeserialization(structuredClone(legacyTree)))

    expect(first.length).toBeGreaterThan(0)
    expect(second).toEqual(first)
    // …and they are real uuids, indistinguishable from a persisted one.
    for (const id of first) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('assigns a distinct id to every entity of a document', () => {
    const ids = idsIn(processAfterDeserialization(structuredClone(legacyTree)))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never touches an id the file already carries', () => {
    const loaded = processAfterDeserialization({
      collections: [
        { id: 'persisted-folder', name: 'Pet', configuration: {}, items: [
          { id: 'persisted-request', name: 'Find pet by ID', type: 'http',
            authenticationRequestId: 'persisted-auth',
            headers: [{ id: 'persisted-header', key: 'Accept', value: 'application/json' }] },
          { id: 'persisted-auth', name: 'Login', type: 'auth' }
        ] }
      ]
    })
    const folder = loaded.collections[0] as Record<string, unknown>
    const items = folder['items'] as Record<string, unknown>[]

    expect(folder['id']).toBe('persisted-folder')
    expect(items[0]?.['id']).toBe('persisted-request')
    expect(items[1]?.['id']).toBe('persisted-auth')
    expect((items[0]?.['headers'] as Record<string, unknown>[])[0]?.['id']).toBe('persisted-header')
    // The cross-reference still resolves to a document that exists.
    expect(items[0]?.['authenticationRequestId']).toBe(items[1]?.['id'])
  })

  it('keeps a duplicate id on its FIRST occurrence and derives a stable replacement for the rest', () => {
    const load = (): Record<string, unknown>[] => {
      const loaded = processAfterDeserialization({
        collections: [
          { name: 'F', configuration: {}, items: [
            { id: 'dup', name: 'o1', type: 'odata' },
            { id: 'dup', name: 'o2', type: 'odata' },
            { id: 'dup', name: 'o3', type: 'odata' }
          ] }
        ]
      })
      return (loaded.collections[0] as { items: Record<string, unknown>[] }).items
    }
    const first = load()
    const second = load()

    expect(first[0]?.['id']).toBe('dup')
    expect(first[1]?.['id']).not.toBe('dup')
    expect(first[2]?.['id']).not.toBe('dup')
    expect(new Set(first.map((i) => i['id'])).size).toBe(3)
    // …and the replacements are the same on the next load.
    expect(second.map((i) => i['id'])).toEqual(first.map((i) => i['id']))
  })

  it('derives the same ids whatever order the keys arrive in', () => {
    // Two builds hold the same data with different property insertion
    // orders (parsed-file order vs class-field order). The derivation path
    // is built from key NAMES, so it cannot depend on their order.
    const reverseKeys = <T>(data: T): T => {
      if (data === null || typeof data !== 'object') return data
      if (Array.isArray(data)) return data.map((v: unknown) => reverseKeys(v)) as T
      const record = data as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(record).reverse()) out[key] = reverseKeys(record[key])
      return out as T
    }

    // Compared as segment→id pairs: reversing the keys also reverses the
    // order the collector VISITS them in, which says nothing about the ids.
    const pairs = (tree: unknown): string[] =>
      entityIds(processAfterDeserialization(tree)).map(([segment, id]) => `${segment}=${id}`).sort()

    expect(pairs(reverseKeys(structuredClone(legacyTree)))).toEqual(pairs(structuredClone(legacyTree)))
  })

  it.each(REQUEST_TYPES)('does not shift a %s request\'s key-value ids when a sibling is inserted above it', (type) => {
    // Same invariant as below, checked per protocol: a request type the
    // classifier does not recognise contributes NO path segment, so its
    // key-values collapse onto the parent's path and end up separated by
    // the occurrence counter — i.e. by array position. That silently
    // reintroduces exactly what this test forbids.
    const project = (extraFirst: boolean): unknown => ({
      collections: [
        { name: 'F', configuration: {}, items: [
          ...(extraFirst ? [{ name: 'Inserted', type, headers: [{ key: 'x-token', value: 'a' }] }] : []),
          { name: 'Watched', type, headers: [{ key: 'x-token', value: 'a' }, { key: 'x-trace', value: 'b' }] }
        ] }
      ]
    })
    const watchedIds = (tree: unknown): string[] => {
      const loaded = processAfterDeserialization(tree) as { collections: { items: Record<string, unknown>[] }[] }
      const items = loaded.collections[0]?.items ?? []
      const watched = items.find((i) => i['name'] === 'Watched')
      return (watched?.['headers'] as Record<string, unknown>[]).map((h) => h['id'] as string)
    }

    expect(watchedIds(project(true))).toEqual(watchedIds(project(false)))
  })

  it('loads a project whose name carries a lone surrogate', () => {
    // The backfill must never be the reason a file stops opening. A lone
    // surrogate is a legal JS string that the digest's input encoding
    // rejects; the random id it replaced could not throw.
    const load = (): unknown => processAfterDeserialization({
      collections: [
        { name: 'bad \uD800 folder', configuration: {}, items: [
          { name: 'bad \uDFFF request', type: 'http', headers: [{ key: 'k \uD800', value: 'v' }] }
        ] }
      ]
    })

    expect(load).not.toThrow()
    const ids = entityIds(load()).map(([, id]) => id)
    expect(ids).toHaveLength(3)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('does not shift a sibling id when an entity is inserted at the head of a container', () => {
    // The derivation path carries NO array index — this is what lets `ours`
    // and `theirs` still pair up after one side added something above.
    const withInsertion = structuredClone(legacyTree)
    const petFolder = (withInsertion.collections[0]?.items[0]) as { items: unknown[] }
    petFolder.items.unshift({ name: 'Delete a pet', type: 'http' })

    const before = idsIn(processAfterDeserialization(structuredClone(legacyTree)))
    const after = idsIn(processAfterDeserialization(withInsertion))

    expect(after.length).toBe(before.length + 1)
    for (const id of before) expect(after).toContain(id)
  })

  it('keeps two same-named siblings apart, stably', () => {
    const load = (): string[] => idsIn(processAfterDeserialization({
      collections: [
        { name: 'F', configuration: {}, items: [
          { name: 'Twin', configuration: {}, items: [{ name: 'Inner', type: 'http' }] },
          { name: 'Twin', configuration: {}, items: [{ name: 'Inner', type: 'http' }] }
        ] }
      ]
    }))
    const ids = load()
    expect(new Set(ids).size).toBe(ids.length)
    expect(load()).toEqual(ids)
  })
})

/**
 * `EnumDefinition` (`values[]` + `matchingRules[]`, see `idPathSegment` in
 * `shared/utils/stableId.ts`) follows the same backfill/dedup contract as
 * every other recognised shape — these tests mirror the request-type ones
 * above, scoped to the shape this ticket adds.
 */
describe('generateIds — EnumDefinition', () => {
  const treeWith = (enumDefinitions: unknown[]): unknown => ({
    collections: [
      { name: 'Root', configuration: {}, folderType: 'environment', items: [], enumDefinitions }
    ]
  })
  const enumDefsOf = (loaded: unknown): Record<string, unknown>[] =>
    (loaded as { collections: { enumDefinitions: Record<string, unknown>[] }[] }).collections[0]?.enumDefinitions ?? []

  it('backfills a missing id deterministically, and never touches an id the file already carries', () => {
    const tree = treeWith([
      { name: 'Status', values: ['open', 'closed'], matchingRules: [] },
      { id: 'persisted-enum', name: 'Kind', values: ['a'], matchingRules: [] }
    ])
    const first = enumDefsOf(processAfterDeserialization(structuredClone(tree)))
    const second = enumDefsOf(processAfterDeserialization(structuredClone(tree)))

    expect(typeof first[0]?.['id']).toBe('string')
    expect((first[0]?.['id'] as string).length).toBeGreaterThan(0)
    // Deterministic: the same document backfills the same id on every independent load.
    expect(second[0]?.['id']).toBe(first[0]?.['id'])
    // An id already in the file is never modified.
    expect(first[1]?.['id']).toBe('persisted-enum')
    expect(second[1]?.['id']).toBe('persisted-enum')
  })

  it('when two EnumDefinitions share a persisted id, an EnumValue.enumDefinitionId pointing at it keeps resolving to whichever one kept the id — never the void', () => {
    // Same corollary as the odata/auth "duplicate id" test above, extended to
    // a REFERENCE that targets the duplicated entity: generateIds never
    // remaps a cross-reference (no way to tell, post-hoc, which of the two
    // original entities a reference meant), so `enumDefinitionId` stays
    // exactly as persisted and simply follows whichever EnumDefinition wins
    // the id — the first one encountered in document order.
    const tree = {
      collections: [
        { name: 'Root', configuration: {}, folderType: 'environment', items: [
          { name: 'Pet', configuration: {}, items: [
            { name: 'Find', type: 'http', headers: [
              { key: 'status', value: { type: 'enum', value: 'open', enumDefinitionId: 'dup-enum' } }
            ] }
          ] }
        ],
        enumDefinitions: [
          { id: 'dup-enum', name: 'StatusA', values: ['open'], matchingRules: [] },
          { id: 'dup-enum', name: 'StatusB', values: ['open'], matchingRules: [] }
        ] }
      ]
    }

    const loaded = processAfterDeserialization(structuredClone(tree)) as {
      collections: {
        enumDefinitions: { id: string, name: string }[]
        items: { items: { headers: { value: { enumDefinitionId: string } }[] }[] }[]
      }[]
    }
    const [winner, loser] = loaded.collections[0]?.enumDefinitions ?? []
    const resolvedId = loaded.collections[0]?.items[0]?.items[0]?.headers[0]?.value.enumDefinitionId

    // The two definitions no longer share an id...
    expect(winner?.id).not.toBe(loser?.id)
    // ...the first one in document order keeps the persisted id...
    expect(winner?.id).toBe('dup-enum')
    expect(winner?.name).toBe('StatusA')
    // ...and the untouched reference still resolves to it — never to the
    // loser, and never to an id nothing carries anymore.
    expect(resolvedId).toBe('dup-enum')
    expect(resolvedId).toBe(winner?.id)
  })
})

describe('generateIds — determinism on the committed reference samples', () => {
  const SAMPLES_DIR = join(__dirname, '../../../../tests/e2e/samples')
  const SAMPLES = readdirSync(SAMPLES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.restorm'))
    .map((entry) => entry.name)
    .sort()

  const loadIds = (raw: string): string[] => {
    const parsed = parseYaml(raw) as { collections?: unknown } | null
    const collections = Array.isArray(parsed?.collections) ? parsed.collections : []
    return entityIds(processAfterDeserialization(collections)).map(([, id]) => id)
  }

  it('finds the reference samples', () => {
    expect(SAMPLES.length).toBeGreaterThan(0)
  })

  it.each(SAMPLES)('two independent loads assign identical ids: %s', (fileName) => {
    const raw = readFileSync(join(SAMPLES_DIR, fileName), 'utf-8')
    const first = loadIds(raw)

    expect(first.length).toBeGreaterThan(0)
    expect(loadIds(raw)).toEqual(first)
    // No two entities of one document may share an id.
    expect(new Set(first).size).toBe(first.length)
  })
})

describe('parseProjectYaml wired to processAfterDeserialization', () => {
  it('backfills a missing id when the renderer passes processAfterDeserialization as the rehydrate callback', () => {
    // `parseProjectYaml` (shared/git/gitCommitDiff.ts) itself does no
    // rehydration by default (main-process / MCP callers only need
    // JSON-safe data) — this is the renderer-side wiring check that
    // `usePushModal.ts` / `useGitPullConflict.ts` rely on: passing
    // `processAfterDeserialization` explicitly restores id-backfill.
    const yaml = [
      'collections:',
      '  - name: Find pet by ID',
      '    type: http',
      '    tags: []'
    ].join('\n')
    const items = parseProjectYaml(yaml, processAfterDeserialization)
    expect(items).toHaveLength(1)
    expect(typeof items[0]?.id).toBe('string')
    expect((items[0]?.id ?? '').length).toBeGreaterThan(0)
  })
})

describe('quick-config timestamps are dropped on load', () => {
  it('removes createdAt/updatedAt from a saved quick-config, including corrupted ones', () => {
    // The two fields were written since quick-configs existed but read by
    // nothing, and files in the wild carry `{}` where a Date was destroyed
    // by the serializer. Dropping them on load lets the next save heal the
    // file, with no separate migration.
    const loaded = processAfterDeserialization({
      collections: [{
        id: 'r1',
        name: 'Fiche',
        quickConfigs: [{
          id: 'qc1', name: 'Recette', requestId: 'r1', storageTarget: 'project',
          fields: { url: 'https://example.com' }, createdAt: {}, updatedAt: '2026-07-22T05:07:12.471Z'
        }]
      }]
    })
    const config = (loaded.collections[0] as { quickConfigs: Record<string, unknown>[] }).quickConfigs[0]

    expect(config).toBeDefined()
    expect('createdAt' in (config ?? {})).toBe(false)
    expect('updatedAt' in (config ?? {})).toBe(false)
    expect(config?.['fields']).toEqual({ url: 'https://example.com' })
  })

  it('leaves createdAt alone outside a quick-config', () => {
    // Only a quick-config's own timestamps are this function's business.
    const loaded = processAfterDeserialization({ report: { createdAt: '2026-07-22T05:00:00.000Z' } })
    expect(loaded.report.createdAt).toBe('2026-07-22T05:00:00.000Z')
  })
})

describe("a scenario node's config bag", () => {
  it('never receives a generated id, even when it carries a requestId', () => {
    // An httpRequest node's config holds `requestId`, which the
    // "looks like a response" heuristic matches. Minting an id there made
    // every open produce a different value, which the next save persisted
    // — so a node nobody edited showed up as conflicting between two
    // people working on the same project.
    const loaded = processAfterDeserialization({
      nodes: [{ id: 'n1', kind: 'httpRequest', config: { label: 'Consulter', requestId: 'r1' } }]
    })
    const config = loaded.nodes[0]?.config as Record<string, unknown>

    expect('id' in config).toBe(false)
    expect(config).toEqual({ label: 'Consulter', requestId: 'r1' })
  })

  it('drops an id a previous version already persisted into the bag', () => {
    const loaded = processAfterDeserialization({
      nodes: [{ id: 'n1', kind: 'log', config: { id: 'da9340fc-stale', label: 'Trace' } }]
    })

    expect(loaded.nodes[0]?.config).toEqual({ label: 'Trace' })
  })
})
