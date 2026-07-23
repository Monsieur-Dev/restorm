import { describe, it, expect } from 'vitest'
import { stripIds, prepareForSerialization } from './serialization'

describe('stripIds', () => {
  it('removes the id from a key-value-shaped object (has both key and value)', () => {
    expect(stripIds({ id: 'kv1', key: 'Accept', value: 'application/json' })).toEqual({
      key: 'Accept', value: 'application/json'
    })
  })

  it('keeps the id on a document-shaped object (no key/value pair)', () => {
    expect(stripIds({ id: 'r1', name: 'Find pet by ID', type: 'http' })).toEqual({
      id: 'r1', name: 'Find pet by ID', type: 'http'
    })
  })

  it('recurses into nested arrays and objects', () => {
    const input = {
      id: 'r1',
      name: 'Find pet by ID',
      headers: [{ id: 'h1', key: 'Accept', value: 'application/json' }]
    }
    expect(stripIds(input)).toEqual({
      id: 'r1',
      name: 'Find pet by ID',
      headers: [{ key: 'Accept', value: 'application/json' }]
    })
  })

  it('passes through null/primitives unchanged', () => {
    // `stripIds` guards `obj === null || obj === undefined` as a single
    // branch (see serialization.ts) — `null` alone exercises it.
    expect(stripIds(null)).toBeNull()
    expect(stripIds('plain string')).toBe('plain string')
    expect(stripIds(42)).toBe(42)
  })
})

describe('prepareForSerialization', () => {
  it('strips key-value ids without touching document ids', () => {
    const input = [{ id: 'r1', name: 'Find pet by ID', headers: [{ id: 'h1', key: 'Accept', value: 'application/json' }] }]
    const result = prepareForSerialization(input)
    // `normalizeDocumentValuesForPersistence` also wraps a plain-string
    // header value into its persisted `{ type, value }` ValueType shape —
    // that's its own concern (covered by `valuePersistence.test.ts`); this
    // test only asserts the id-stripping half of `prepareForSerialization`.
    expect((result[0] as { id: string }).id).toBe('r1')
    expect((result[0] as { headers: { id?: string }[] }).headers[0]?.id).toBeUndefined()
  })
})

describe('timestamps survive serialization', () => {
  it('keeps a Date intact instead of flattening it to an empty object', () => {
    // A Date exposes no own enumerable keys, so walking it like a plain
    // object yields `{}` — the value is destroyed, and it lands in the
    // saved project file as `createdAt: {}`. Reached whenever the document
    // arrives already deserialized, as the git merge write-back does.
    const created = new Date('2026-07-22T04:32:01.569Z')
    const stripped = stripIds({ name: 'Recette', createdAt: created })

    expect(stripped.createdAt).toBeInstanceOf(Date)
    expect(stripped.createdAt.toISOString()).toBe('2026-07-22T04:32:01.569Z')
  })

  it('keeps a nested Date intact through the full save preparation', () => {
    const prepared = prepareForSerialization({
      collections: [{ id: 'r1', name: 'Fiche', quickConfigs: [{ name: 'Recette', createdAt: new Date('2026-07-22T04:32:01.569Z') }] }]
    })
    const config = prepared.collections[0]?.quickConfigs[0]

    expect(config?.createdAt).toBeInstanceOf(Date)
    expect(JSON.stringify(config?.createdAt)).toBe('"2026-07-22T04:32:01.569Z"')
  })
})
