import { describe, it, expect, vi, beforeAll } from 'vitest'

vi.mock('electron-core-ui', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { applyApiUpdate } from '../../src/main/services/apiUpdate/applyApiUpdate'
import type { NormalizedSpec } from '../../src/main/services/import/idempotent/types'
import type { EnvironmentFolder } from '../../src/shared/types/folderTypes'

function makeFolder(overrides: Partial<EnvironmentFolder> = {}): EnvironmentFolder {
  return {
    id: 'f1',
    name: 'Folder',
    documentation: '',
    tags: [],
    configuration: {},
    items: [],
    folderType: 'environment',
    fileFormatVersion: 1,
    environments: [],
    ...overrides
  }
}

function httpRequest(naturalKey: string, name = naturalKey): Record<string, unknown> {
  return {
    id: `req-${naturalKey}`,
    name,
    type: 'http',
    method: 'GET',
    url: '/x',
    headers: [],
    params: [],
    pathParams: [],
    importOrigin: { format: 'swagger', naturalKey }
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

describe('applyApiUpdate', () => {
  beforeAll(() => {
    // Quiet vitest's "global expect not found in beforeAll" if it fires.
  })

  it('produces an empty diff when target and freshFolder describe the same operations', () => {
    // The pinned invariant of the whole feature: apply + apply on the
    // same spec is a no-op. If the diff isn't empty on the second
    // application, the user would see a "phantom changes" toast on
    // every refresh.
    const target = makeFolder({
      items: [httpRequest('GET /a') as never, httpRequest('GET /b') as never]
    })
    const freshFolder = makeFolder({
      items: [httpRequest('GET /a') as never, httpRequest('GET /b') as never]
    })
    const result = applyApiUpdate({
      target,
      freshFolder,
      spec: spec([{ naturalKey: 'GET /a' }, { naturalKey: 'GET /b' }]),
      importSource: 'swagger'
    })
    expect(result.diff.added).toHaveLength(0)
    expect(result.diff.removed).toHaveLength(0)
    expect(result.diff.deprecated).toHaveLength(0)
  })

  it('flips removed=true on operations that vanish from the new spec', () => {
    const target = makeFolder({
      items: [httpRequest('GET /a') as never, httpRequest('GET /gone') as never]
    })
    const freshFolder = makeFolder({
      items: [httpRequest('GET /a') as never]
    })
    const result = applyApiUpdate({
      target,
      freshFolder,
      spec: spec([{ naturalKey: 'GET /a' }]),
      importSource: 'swagger'
    })
    expect(result.diff.removed.map((op) => op.naturalKey)).toEqual(['GET /gone'])
    const gone = target.items.find((r) => (r as { name: string }).name === 'GET /gone') as { removed?: boolean }
    expect(gone.removed).toBe(true)
  })

  it('appends a fresh request for an operation that did not exist before', () => {
    const target = makeFolder({ items: [httpRequest('GET /a') as never] })
    const freshFolder = makeFolder({
      items: [httpRequest('GET /a') as never, httpRequest('GET /new') as never]
    })
    const result = applyApiUpdate({
      target,
      freshFolder,
      spec: spec([{ naturalKey: 'GET /a' }, { naturalKey: 'GET /new' }]),
      importSource: 'swagger'
    })
    expect(result.diff.added.map((op) => op.naturalKey)).toEqual(['GET /new'])
    expect(target.items.length).toBe(2)
  })

  it('propagates deprecated=true onto an existing matching request', () => {
    const target = makeFolder({ items: [httpRequest('GET /a') as never] })
    const freshFolder = makeFolder({ items: [httpRequest('GET /a') as never] })
    const result = applyApiUpdate({
      target,
      freshFolder,
      spec: spec([{ naturalKey: 'GET /a', deprecated: true }]),
      importSource: 'swagger'
    })
    expect(result.diff.deprecated.map((op) => op.naturalKey)).toEqual(['GET /a'])
    const req = target.items[0] as { deprecated?: boolean }
    expect(req.deprecated).toBe(true)
  })

  it('carries over enumDefinitions and apiDocumentation from the fresh import', () => {
    // Pin the cross-update-scope behaviour: refresh-from-source must
    // reach the env folder's enum dropdowns and the docs tab — the
    // pipeline only handles requests, but the user-visible diff
    // includes "an enum gained a value" which would otherwise stay
    // frozen at the original import.
    const target = makeFolder({
      items: [],
      enumDefinitions: [{ id: 'old', name: 'Status', values: ['a'], matchingRules: [] }]
    })
    const freshFolder = makeFolder({
      items: [],
      enumDefinitions: [{ id: 'new', name: 'Status', values: ['a', 'b', 'c'], matchingRules: [] }],
      apiDocumentation: { sourceUrl: 'https://x', api: { title: 'New', version: '2.0.0' } } as never
    })
    applyApiUpdate({
      target,
      freshFolder,
      spec: spec([]),
      importSource: 'swagger'
    })
    const got = target as unknown as { enumDefinitions?: { values: string[] }[]; apiDocumentation?: { api?: { version?: string } } }
    expect(got.enumDefinitions?.[0]?.values).toEqual(['a', 'b', 'c'])
    expect(got.apiDocumentation?.api?.version).toBe('2.0.0')
  })
})
