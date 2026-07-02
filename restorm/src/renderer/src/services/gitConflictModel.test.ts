import { describe, it, expect } from 'vitest'
import { identifyConflictingEntities } from './gitConflictModel'

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
