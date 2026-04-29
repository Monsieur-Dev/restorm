import { describe, it, expect } from 'vitest'
import { migrateApiUpdate, migrateApiUpdateForCollections } from '../../src/shared/utils/migrateApiUpdate'

describe('migrateApiUpdate', () => {
  it('leaves a folder with no apiDocumentation untouched', () => {
    const folder = { items: [] }
    const result = migrateApiUpdate(folder)
    expect(result).toEqual({ items: [] })
  })

  it('leaves a folder that already has apiUpdate untouched', () => {
    // Pin the idempotency invariant: rerunning the migration must not
    // clobber a user's autoCheckEnabled / interval choice. Without
    // this, anyone who toggled the setting once would have it reset
    // on the next file open.
    const folder = {
      apiUpdate: { sourceUrl: 'https://x', autoCheckEnabled: true, interval: 'hourly' as const },
      apiDocumentation: { sourceUrl: 'https://different' }
    }
    const result = migrateApiUpdate(folder)
    expect(result.apiUpdate.sourceUrl).toBe('https://x')
    expect(result.apiUpdate.autoCheckEnabled).toBe(true)
  })

  it('backfills apiUpdate from apiDocumentation.sourceUrl with safe defaults', () => {
    const folder = {
      apiDocumentation: { sourceUrl: 'https://example/spec.json', api: { version: '1.0.0' } }
    }
    const result = migrateApiUpdate(folder)
    expect(result.apiUpdate).toEqual({
      sourceUrl: 'https://example/spec.json',
      autoCheckEnabled: false,
      interval: 'daily',
      lastImportedSpecVersion: '1.0.0'
    })
  })

  it('preserves sourceHeaders on backfill', () => {
    const folder = {
      apiDocumentation: { sourceUrl: 'https://x', sourceHeaders: { Authorization: 'Bearer ${TOKEN}' } }
    }
    const result = migrateApiUpdate(folder)
    expect(result.apiUpdate?.sourceHeaders).toEqual({ Authorization: 'Bearer ${TOKEN}' })
  })

  it('recurses into nested folders', () => {
    const folder = {
      items: [
        { apiDocumentation: { sourceUrl: 'https://child' }, items: [] }
      ]
    }
    migrateApiUpdate(folder)
    const child = folder.items[0] as { apiUpdate?: { sourceUrl: string } }
    expect(child.apiUpdate?.sourceUrl).toBe('https://child')
  })

  it('migrateApiUpdateForCollections processes every root', () => {
    const collections = [
      { apiDocumentation: { sourceUrl: 'https://a' } },
      { apiDocumentation: { sourceUrl: 'https://b' } }
    ]
    migrateApiUpdateForCollections(collections)
    expect((collections[0] as { apiUpdate?: { sourceUrl: string } }).apiUpdate?.sourceUrl).toBe('https://a')
    expect((collections[1] as { apiUpdate?: { sourceUrl: string } }).apiUpdate?.sourceUrl).toBe('https://b')
  })
})
