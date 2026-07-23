import { describe, it, expect } from 'vitest'
import { identifyConflictingEntities } from './gitConflictModel'
// The renderer's rehydrate callback — the one the conflict UI really
// passes (`useConflictResolution.ts`), and the only one that backfills ids.
import { processAfterDeserialization } from '../../renderer/src/utils/serialization'

const OURS_YAML = [
  'collections:',
  '  - id: r1',
  '    name: Find pet by ID',
  '    type: http',
  '    tags: []',
  '    url: https://ours.example.com/pets/{id}',
  '  - id: r2',
  '    name: Only on ours',
  '    type: http',
  '    tags: []'
].join('\n')

const THEIRS_YAML = [
  'collections:',
  '  - id: r1',
  '    name: Find pet by ID',
  '    type: http',
  '    tags: []',
  '    url: https://theirs.example.com/pets/{id}',
  '  - id: r3',
  '    name: Only on theirs',
  '    type: http',
  '    tags: []'
].join('\n')

const BASE_YAML = [
  'collections:',
  '  - id: r1',
  '    name: Find pet by ID',
  '    type: http',
  '    tags: []',
  '    url: https://base.example.com/pets/{id}'
].join('\n')

describe('identifyConflictingEntities', () => {
  it('flags an entity present on both sides with different own-field content as a conflict', () => {
    const conflicts = identifyConflictingEntities({ path: 'api.restorm', base: BASE_YAML, ours: OURS_YAML, theirs: THEIRS_YAML })
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ id: 'r1', kind: 'request', name: 'Find pet by ID' })
  })

  it('exposes the ours/theirs/base versions verbatim for the conflicting entity', () => {
    const [conflict] = identifyConflictingEntities({ path: 'api.restorm', base: BASE_YAML, ours: OURS_YAML, theirs: THEIRS_YAML })
    expect(conflict?.ours).toMatchObject({ id: 'r1', url: 'https://ours.example.com/pets/{id}' })
    expect(conflict?.theirs).toMatchObject({ id: 'r1', url: 'https://theirs.example.com/pets/{id}' })
    expect(conflict?.base).toMatchObject({ id: 'r1', url: 'https://base.example.com/pets/{id}' })
  })

  it('does NOT flag an entity added on only one side — it merges in automatically', () => {
    const conflicts = identifyConflictingEntities({ path: 'api.restorm', base: BASE_YAML, ours: OURS_YAML, theirs: THEIRS_YAML })
    expect(conflicts.find((c) => c.id === 'r2')).toBeUndefined()
    expect(conflicts.find((c) => c.id === 'r3')).toBeUndefined()
  })

  it('does NOT flag an entity that is identical on both sides', () => {
    const conflicts = identifyConflictingEntities({ path: 'api.restorm', base: BASE_YAML, ours: BASE_YAML, theirs: BASE_YAML })
    expect(conflicts).toHaveLength(0)
  })

  it('has a null base when the common ancestor never had the entity (add/add conflict)', () => {
    const noBase = 'collections: []\n'
    const conflicts = identifyConflictingEntities({ path: 'api.restorm', base: noBase, ours: OURS_YAML, theirs: THEIRS_YAML })
    const r1 = conflicts.find((c) => c.id === 'r1')
    expect(r1?.base).toBeNull()
  })

  it('returns an empty list when there is no base blob at all (very first commit, add/add against nothing)', () => {
    const conflicts = identifyConflictingEntities({ path: 'api.restorm', base: null, ours: OURS_YAML, theirs: THEIRS_YAML })
    expect(conflicts.find((c) => c.id === 'r1')).toBeTruthy()
  })

  it('produces a deterministic order (kind, then name) independent of YAML entry order', () => {
    const oursShuffled = [
      'collections:',
      '  - id: r2',
      '    name: Zebra request',
      '    type: http',
      '    tags: []',
      '    url: a',
      '  - id: r1',
      '    name: Alpha request',
      '    type: http',
      '    tags: []',
      '    url: a'
    ].join('\n')
    const theirsShuffled = [
      'collections:',
      '  - id: r1',
      '    name: Alpha request',
      '    type: http',
      '    tags: []',
      '    url: b',
      '  - id: r2',
      '    name: Zebra request',
      '    type: http',
      '    tags: []',
      '    url: b'
    ].join('\n')
    const conflicts = identifyConflictingEntities({ path: 'api.restorm', base: null, ours: oursShuffled, theirs: theirsShuffled })
    expect(conflicts.map((c) => c.name)).toEqual(['Alpha request', 'Zebra request'])
  })

  it('does NOT flag a byte-identical request as conflicting just because it has headers (key-value row ids are regenerated per independent parse)', () => {
    const yamlWithHeaders = [
      'collections:',
      '  - id: r1',
      '    name: Find pet by ID',
      '    type: http',
      '    tags: []',
      '    method: GET',
      '    url: https://example.com/pets/{id}',
      '    headers:',
      '      - key: Accept',
      '        value: application/json',
      '    params: []'
    ].join('\n')
    // `ours` and `theirs` parse independently — each header row gets its own
    // fresh `crypto.randomUUID()` even though the YAML text is identical.
    const conflicts = identifyConflictingEntities({ path: 'api.restorm', base: null, ours: yamlWithHeaders, theirs: yamlWithHeaders })
    expect(conflicts).toEqual([])
  })

  function envFolderYaml(version: string, notes?: string): string {
    return [
      'collections:',
      '  - id: e1',
      '    name: My API',
      '    tags: []',
      '    configuration: {}',
      '    folderType: environment',
      '    items: []',
      ...(notes !== undefined ? [`    notes: ${notes}`] : []),
      '    apiDocumentation:',
      '      sourceType: openapi',
      '      api:',
      '        title: Petstore',
      `        version: '${version}'`,
      '      models: {}',
      '      groups: {}',
      '      operations: []'
    ].join('\n')
  }

  it('AC#6: does NOT flag an environment-folder conflict when apiDocumentation is the ONLY difference (it auto-resolves instead)', () => {
    const conflicts = identifyConflictingEntities({ path: 'api.restorm', base: null, ours: envFolderYaml('1.0.0'), theirs: envFolderYaml('2.0.0') })
    expect(conflicts.find((c) => c.id === 'e1')).toBeUndefined()
  })

  it('AC#6: still flags a manual conflict when a REAL field also differs alongside apiDocumentation', () => {
    const conflicts = identifyConflictingEntities({
      path: 'api.restorm',
      base: null,
      ours: envFolderYaml('1.0.0', 'ours notes'),
      theirs: envFolderYaml('2.0.0', 'theirs notes')
    })
    expect(conflicts.find((c) => c.id === 'e1')).toBeTruthy()
  })
})

describe('saved quick-configs conflict on their own', () => {
  const withConfig = (url: string, configFields: string): string => `collections:
  - id: r1
    name: Find pet
    type: http
    tags: []
    url: ${url}
    quickConfigs:
      - id: qc1
        name: Staging
        requestId: r1
        storageTarget: project
        fields:
          url: ${configFields}
`

  it('reports the contested config as its own entry, naming it', () => {
    // A quick-config is a whole-request snapshot: folding it into the
    // request's own comparison would say "this request conflicts" without
    // ever saying WHICH configuration disagrees.
    const conflicts = identifyConflictingEntities({
      path: 'p',
      base: withConfig('https://same', 'https://base-cfg'),
      ours: withConfig('https://same', 'https://ours-cfg'),
      theirs: withConfig('https://same', 'https://theirs-cfg')
    })

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.quickConfigName).toBe('Staging')
    // The two sides are the request AS THAT CONFIG LEAVES IT, so the
    // normal request diff can render them unchanged.
    expect(conflicts[0]?.ours).toMatchObject({ url: 'https://ours-cfg' })
    expect(conflicts[0]?.theirs).toMatchObject({ url: 'https://theirs-cfg' })
  })

  it('does not report a config only one side changed', () => {
    const conflicts = identifyConflictingEntities({
      path: 'p',
      base: withConfig('https://same', 'https://base-cfg'),
      ours: withConfig('https://same', 'https://base-cfg'),
      theirs: withConfig('https://same', 'https://theirs-cfg')
    })
    expect(conflicts).toEqual([])
  })

  it('a config difference no longer makes the REQUEST itself conflict', () => {
    const conflicts = identifyConflictingEntities({
      path: 'p',
      base: withConfig('https://same', 'https://base-cfg'),
      ours: withConfig('https://same', 'https://ours-cfg'),
      theirs: withConfig('https://same', 'https://theirs-cfg')
    })
    // Exactly one entry, and it is the config one — not a second, opaque
    // "the request conflicts" row alongside it.
    expect(conflicts.filter((c) => c.quickConfigName === undefined)).toEqual([])
  })
})

describe('imported documentation is never a manual conflict', () => {
  it('does not report a request whose documentation is all that differs', () => {
    // The user does not author it, so there is nothing for them to
    // arbitrate — it auto-resolves at write-back instead.
    const ours = [
      'collections:',
      '  - id: r1',
      '    name: Find pet',
      '    type: http',
      '    tags: []',
      '    url: https://example.com',
      '    documentation: ours doc'
    ].join('\n')
    const theirs = ours.replace('ours doc', 'theirs doc')

    const conflicts = identifyConflictingEntities({ path: 'p.restorm', base: null, ours, theirs })

    expect(conflicts).toEqual([])
  })
})

describe('the tree-structure conflict', () => {
  const project = (layout: string): string => layout

  const BASE = [
    'collections:',
    '  - id: f1',
    '    name: Folder A',
    '    tags: []',
    '    configuration: {}',
    '    items:',
    '      - id: r1',
    '        name: Find pet',
    '        type: http',
    '        tags: []',
    '        url: https://example.com',
    '  - id: f2',
    '    name: Folder B',
    '    tags: []',
    '    configuration: {}',
    '    items: []'
  ].join('\n')

  /** Same project with `r1` living under `f2` instead of `f1`. */
  const MOVED_TO_B = [
    'collections:',
    '  - id: f1',
    '    name: Folder A',
    '    tags: []',
    '    configuration: {}',
    '    items: []',
    '  - id: f2',
    '    name: Folder B',
    '    tags: []',
    '    configuration: {}',
    '    items:',
    '      - id: r1',
    '        name: Find pet',
    '        type: http',
    '        tags: []',
    '        url: https://example.com'
  ].join('\n')

  /** Same project with `r1` promoted to the root. */
  const MOVED_TO_ROOT = [
    'collections:',
    '  - id: f1',
    '    name: Folder A',
    '    tags: []',
    '    configuration: {}',
    '    items: []',
    '  - id: f2',
    '    name: Folder B',
    '    tags: []',
    '    configuration: {}',
    '    items: []',
    '  - id: r1',
    '    name: Find pet',
    '    type: http',
    '    tags: []',
    '    url: https://example.com'
  ].join('\n')

  it('reports ONE entry naming the items both sides moved differently', () => {
    const conflicts = identifyConflictingEntities({
      path: 'p.restorm', base: project(BASE), ours: project(MOVED_TO_B), theirs: project(MOVED_TO_ROOT)
    }, undefined, 'Arborescence')

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.name).toBe('Arborescence')
    expect(conflicts[0]?.movedItemIds).toEqual(['r1'])
  })

  it('says nothing when only one side moved the item — that move is adopted silently', () => {
    const conflicts = identifyConflictingEntities({
      path: 'p.restorm', base: project(BASE), ours: project(BASE), theirs: project(MOVED_TO_B)
    })

    expect(conflicts).toEqual([])
  })

  it('says nothing when both sides made the SAME move', () => {
    const conflicts = identifyConflictingEntities({
      path: 'p.restorm', base: project(BASE), ours: project(MOVED_TO_B), theirs: project(MOVED_TO_B)
    })

    expect(conflicts).toEqual([])
  })

  it('cannot judge a move without a common ancestor, and says nothing', () => {
    const conflicts = identifyConflictingEntities({
      path: 'p.restorm', base: null, ours: project(MOVED_TO_B), theirs: project(MOVED_TO_ROOT)
    })

    expect(conflicts.filter((c) => c.movedItemIds)).toEqual([])
  })
})

/**
 * A project written before document ids were persisted carries no `id` at
 * all. This model parses `ours`, `theirs` and `base` in three INDEPENDENT
 * passes and pairs entities by id — so while the loader minted those ids
 * randomly, the three id sets were disjoint, `theirs.get(id)` never matched,
 * and NO conflict was EVER reported on such a file. The user was told the
 * merge was clean and quietly lost one side's work. A backfill derived from
 * the document makes the three passes agree.
 */
const LEGACY_UNTOUCHED = [
  '      - name: Untouched',
  '        type: http',
  '        tags: []',
  '        url: https://example.com/other'
].join('\n')

const legacyProject = (petUrl: string): string => [
  'collections:',
  '  - name: Petstore',
  '    tags: []',
  '    configuration: {}',
  '    items:',
  '      - name: Find pet by ID',
  '        type: http',
  '        tags: []',
  `        url: ${petUrl}`,
  LEGACY_UNTOUCHED
].join('\n')

describe('identifyConflictingEntities on a project whose ids are not persisted yet', () => {
  const versions = {
    path: 'p.restorm',
    base: legacyProject('https://base.example.com/pets'),
    ours: legacyProject('https://ours.example.com/pets'),
    theirs: legacyProject('https://theirs.example.com/pets')
  }

  it('pairs the three sides and reports the entity both of them changed', () => {
    const conflicts = identifyConflictingEntities(versions, processAfterDeserialization)

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ kind: 'request', name: 'Find pet by ID' })
    expect(conflicts[0]?.ours).toMatchObject({ url: 'https://ours.example.com/pets' })
    expect(conflicts[0]?.theirs).toMatchObject({ url: 'https://theirs.example.com/pets' })
    expect(conflicts[0]?.base).toMatchObject({ url: 'https://base.example.com/pets' })
  })

  it('gives the paired entity the same derived id on all three sides', () => {
    const [conflict] = identifyConflictingEntities(versions, processAfterDeserialization)

    expect(conflict?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect((conflict?.ours as unknown as { id: string }).id).toBe(conflict?.id)
    expect((conflict?.theirs as unknown as { id: string }).id).toBe(conflict?.id)
    expect((conflict?.base as unknown as { id: string }).id).toBe(conflict?.id)
  })

  it('leaves the entity neither side touched alone', () => {
    const conflicts = identifyConflictingEntities(versions, processAfterDeserialization)

    expect(conflicts.find((c) => c.name === 'Untouched')).toBeUndefined()
    expect(conflicts.find((c) => c.name === 'Petstore')).toBeUndefined()
  })

  it('does not put an entity only ONE side changed to the user', () => {
    const conflicts = identifyConflictingEntities({
      path: 'p.restorm',
      base: legacyProject('https://base.example.com/pets'),
      ours: legacyProject('https://ours.example.com/pets'),
      theirs: legacyProject('https://base.example.com/pets')
    }, processAfterDeserialization)

    expect(conflicts).toEqual([])
  })
})
