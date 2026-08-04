import { describe, it, expect } from 'vitest'
import { previewImportDiff } from '../../src/main/services/import/idempotent/previewImportDiff'
import { swaggerImportAdapter } from '../../src/main/services/import/idempotent/SwaggerAdapter'
import type { NormalizedSpec } from '../../src/main/services/import/idempotent/types'
import type { EnvironmentFolder } from '../../src/shared/types/folderTypes'

function folder(items: unknown[] = []): EnvironmentFolder {
  return {
    id: 'f',
    name: 'Folder',
    documentation: '',
    tags: [],
    configuration: {},
    items: items as never,
    folderType: 'environment',
    environments: []
  }
}

function httpReq(naturalKey: string, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `req-${naturalKey}`,
    name: naturalKey,
    type: 'http',
    method: 'GET',
    url: '/x',
    importOrigin: { format: 'swagger', naturalKey },
    ...extras
  }
}

function spec(operations: { naturalKey: string; deprecated?: boolean }[]): NormalizedSpec {
  return {
    operations: operations.map(({ naturalKey, deprecated }) => ({
      naturalKey,
      name: naturalKey,
      deprecated: deprecated ?? false,
      shape: { protocol: 'http', method: 'GET', url: '/x', parameters: [] }
    })),
    models: [],
    enums: [],
    environments: []
  }
}

describe('previewImportDiff', () => {
  it('does not mutate the target folder', () => {
    // Pin the side-effect-free invariant — without it, the
    // confirmation dialog would already have applied changes by the
    // time the user clicked Cancel.
    const target = folder([httpReq('GET /a')])
    const itemsBefore = target.items.slice()
    previewImportDiff(target, spec([{ naturalKey: 'GET /b' }]), swaggerImportAdapter)
    expect(target.items).toEqual(itemsBefore)
    expect((target.items[0] as { removed?: boolean }).removed).toBeUndefined()
  })

  it('reports the same counters runIdempotentImport would produce', () => {
    const target = folder([httpReq('GET /old'), httpReq('GET /staying')])
    const out = previewImportDiff(
      target,
      spec([{ naturalKey: 'GET /staying' }, { naturalKey: 'GET /new' }]),
      swaggerImportAdapter
    )
    expect(out.added.map((o) => o.naturalKey)).toEqual(['GET /new'])
    expect(out.removed.map((o) => o.naturalKey)).toEqual(['GET /old'])
    expect(out.merged).toEqual([])
  })

  it('flags an operation that became deprecated', () => {
    const target = folder([httpReq('GET /x')])
    const out = previewImportDiff(target, spec([{ naturalKey: 'GET /x', deprecated: true }]), swaggerImportAdapter)
    expect(out.deprecated.map((o) => o.naturalKey)).toEqual(['GET /x'])
  })

  it('detects parameter shape changes via fingerprint', () => {
    const existing = httpReq('GET /x', {
      // `params` is the Request model's query-param field (NOT
      // queryParameters, which never existed on the model — the
      // fingerprint used to read that wrong name and always come back
      // empty, so a shape change was never detected).
      params: [{ key: 'limit' }]
    })
    const target = folder([existing])
    const sp: NormalizedSpec = {
      operations: [{
        naturalKey: 'GET /x',
        name: 'x',
        deprecated: false,
        shape: { protocol: 'http', method: 'GET', url: '/x', parameters: [{ name: 'limit', location: 'query' }, { name: 'offset', location: 'query' }] }
      }],
      models: [], enums: [], environments: []
    }
    const out = previewImportDiff(target, sp, swaggerImportAdapter)
    expect(out.merged.map((o) => o.naturalKey)).toEqual(['GET /x'])
  })
})
