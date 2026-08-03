import { describe, it, expect } from 'vitest'
import { runIdempotentImport } from '../../src/main/services/import/idempotent/runIdempotentImport'
import type {
  ImportAdapter,
  NormalizedOperation,
  NormalizedSpec
} from '../../src/main/services/import/idempotent/types'
import { isImportDiffEmpty } from '../../src/main/services/import/idempotent/types'
import type { EnvironmentFolder } from '../../src/shared/types/folderTypes'
import type { HTTPRequest, ImportOrigin, Request } from '../../src/shared/types/requests'

function envFolder(): EnvironmentFolder {
  return {
    id: 'env-1',
    name: 'Test API',
    documentation: '',
    tags: [],
    configuration: {} as unknown as EnvironmentFolder['configuration'],
    items: [],
    folderType: 'environment',
    environments: []
  }
}

function op(
  partial: Partial<NormalizedOperation> & { naturalKey: string }
): NormalizedOperation {
  return {
    naturalKey: partial.naturalKey,
    name: partial.name ?? partial.naturalKey,
    deprecated: partial.deprecated ?? false,
    shape: partial.shape ?? { protocol: 'http', method: 'GET', url: '/x', parameters: [] },
    ...(partial.operationId !== undefined ? { operationId: partial.operationId } : {})
  }
}

function spec(operations: NormalizedOperation[]): NormalizedSpec {
  return {
    operations,
    models: [],
    enums: [],
    environments: []
  }
}

const adapter: ImportAdapter = {
  format: 'swagger',
  extractNormalizedSpec() {
    throw new Error('not used in pipeline tests')
  }
}

function http(name: string, origin: ImportOrigin, partial: Partial<HTTPRequest> = {}): HTTPRequest {
  return {
    type: 'http',
    id: `req-${name}`,
    name,
    method: partial.method ?? 'GET',
    url: partial.url ?? '/x',
    documentation: '',
    tags: [],
    importOrigin: origin,
    ...partial
  } as unknown as HTTPRequest
}

function createRequest(operation: NormalizedOperation, origin: ImportOrigin): Request {
  return http(operation.name, origin, {
    method: operation.shape.protocol === 'http' ? operation.shape.method : 'GET',
    url: operation.shape.protocol === 'http' ? operation.shape.url : '/x'
  })
}

describe('runIdempotentImport — initial import', () => {
  it('materialises every operation onto an empty folder', () => {
    const folder = envFolder()
    const sp = spec([op({ naturalKey: 'GET /pets' }), op({ naturalKey: 'POST /pets' })])
    const diff = runIdempotentImport({ target: folder, spec: sp, adapter, createRequest })
    expect(diff.added.map((o) => o.naturalKey)).toEqual(['GET /pets', 'POST /pets'])
    expect(folder.items).toHaveLength(2)
  })
})

describe('runIdempotentImport — idempotency invariant', () => {
  it('a second run with the identical spec produces an empty diff', () => {
    // Pinned invariant from the ticket: re-importing the same spec
    // is a no-op. The pipeline matches existing requests by
    // operationId / naturalKey on every run, so the second pass
    // should add zero, deprecate zero, mark removed zero, merge
    // zero. Without this guarantee the refresh wizard would push
    // bogus "N changes available" toasts on every tick.
    const folder = envFolder()
    const sp = spec([op({ operationId: 'getPet', naturalKey: 'GET /pets/{id}' })])
    runIdempotentImport({ target: folder, spec: sp, adapter, createRequest })
    const second = runIdempotentImport({ target: folder, spec: sp, adapter, createRequest })
    expect(isImportDiffEmpty(second)).toBe(true)
    expect(folder.items).toHaveLength(1)
  })
})

describe('runIdempotentImport — deprecation propagation', () => {
  it('flips deprecated on first detection, then stays empty on subsequent runs', () => {
    const folder = envFolder()
    runIdempotentImport({
      target: folder,
      spec: spec([op({ operationId: 'foo', naturalKey: 'GET /foo' })]),
      adapter,
      createRequest
    })
    const deprecatedSpec = spec([op({ operationId: 'foo', naturalKey: 'GET /foo', deprecated: true })])
    const first = runIdempotentImport({ target: folder, spec: deprecatedSpec, adapter, createRequest })
    expect(first.deprecated.map((o) => o.operationId)).toEqual(['foo'])

    const existing = folder.items[0] as HTTPRequest
    expect(existing.deprecated).toBe(true)

    const second = runIdempotentImport({ target: folder, spec: deprecatedSpec, adapter, createRequest })
    expect(isImportDiffEmpty(second)).toBe(true)
  })
})

describe('runIdempotentImport — vanished operations', () => {
  it('marks removed=true on the local request when the op vanishes from the spec', () => {
    const folder = envFolder()
    runIdempotentImport({
      target: folder,
      spec: spec([
        op({ operationId: 'kept', naturalKey: 'GET /kept' }),
        op({ operationId: 'gone', naturalKey: 'GET /gone' })
      ]),
      adapter,
      createRequest
    })
    const trimmed = spec([op({ operationId: 'kept', naturalKey: 'GET /kept' })])
    const diff = runIdempotentImport({ target: folder, spec: trimmed, adapter, createRequest })
    expect(diff.removed.map((o) => o.naturalKey)).toEqual(['GET /gone'])

    const goneReq = folder.items.find((i) => (i as HTTPRequest).name === 'GET /gone') as HTTPRequest
    expect(goneReq.removed).toBe(true)
    // The kept request stays untouched.
    const keptReq = folder.items.find((i) => (i as HTTPRequest).name === 'GET /kept') as HTTPRequest
    expect(keptReq.removed).toBeFalsy()
  })

  it('un-marks removed when the op reappears in a later spec', () => {
    const folder = envFolder()
    runIdempotentImport({
      target: folder,
      spec: spec([op({ operationId: 'flaky', naturalKey: 'GET /flaky' })]),
      adapter,
      createRequest
    })
    runIdempotentImport({ target: folder, spec: spec([]), adapter, createRequest })
    const flaky = folder.items[0] as HTTPRequest
    expect(flaky.removed).toBe(true)

    const reborn = runIdempotentImport({
      target: folder,
      spec: spec([op({ operationId: 'flaky', naturalKey: 'GET /flaky' })]),
      adapter,
      createRequest
    })
    expect(flaky.removed).toBe(false)
    expect(reborn.merged.map((o) => o.operationId)).toEqual(['flaky'])
  })
})

describe('runIdempotentImport — user-created requests are inviolable', () => {
  it('never marks user-created requests as removed', () => {
    const folder = envFolder()
    // A user-created request has no `importOrigin`. Even when the
    // adapter's spec doesn't mention anything that matches its
    // shape, the pipeline must leave it strictly alone.
    folder.items.push(http('My Manual Request', undefined as unknown as ImportOrigin, { method: 'POST', url: '/manual' }))
    // Drop the importOrigin so the request looks user-created.
    delete (folder.items[0] as HTTPRequest).importOrigin

    runIdempotentImport({ target: folder, spec: spec([]), adapter, createRequest })

    const manual = folder.items[0] as HTTPRequest
    expect(manual.removed).toBeFalsy()
    expect(manual.deprecated).toBeFalsy()
  })

  it('does not match user-created requests by name or URL', () => {
    const folder = envFolder()
    folder.items.push(http('GET /pets', undefined as unknown as ImportOrigin, { method: 'GET', url: '/pets' }))
    delete (folder.items[0] as HTTPRequest).importOrigin

    const diff = runIdempotentImport({
      target: folder,
      spec: spec([op({ naturalKey: 'GET /pets' })]),
      adapter,
      createRequest
    })
    // Pipeline materialises a fresh request rather than touching
    // the user-created one with the same shape.
    expect(diff.added.map((o) => o.naturalKey)).toEqual(['GET /pets'])
    expect(folder.items).toHaveLength(2)
  })
})

describe('runIdempotentImport — operationId vs naturalKey matching', () => {
  it('matches by operationId first, falls back to naturalKey', () => {
    const folder = envFolder()
    runIdempotentImport({
      target: folder,
      spec: spec([op({ operationId: 'getPet', naturalKey: 'GET /pets/{id}' })]),
      adapter,
      createRequest
    })
    // Author renames the path but keeps operationId stable.
    const renamedSpec = spec([op({ operationId: 'getPet', naturalKey: 'GET /pets/{petId}' })])
    const diff = runIdempotentImport({ target: folder, spec: renamedSpec, adapter, createRequest })
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
  })

  it('matches by naturalKey when operationId disappears', () => {
    const folder = envFolder()
    runIdempotentImport({
      target: folder,
      spec: spec([op({ operationId: 'getPet', naturalKey: 'GET /pets/{id}' })]),
      adapter,
      createRequest
    })
    // Author drops the operationId but the path is unchanged.
    const noIdSpec = spec([op({ naturalKey: 'GET /pets/{id}' })])
    const diff = runIdempotentImport({ target: folder, spec: noIdSpec, adapter, createRequest })
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
  })
})
