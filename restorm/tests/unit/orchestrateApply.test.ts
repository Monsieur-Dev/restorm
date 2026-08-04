import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('electron-core-ui', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const findById = vi.fn<(id: string) => unknown>()
vi.mock('../../src/main/services/CollectionStore', () => ({
  collectionStore: { findById: (id: string): unknown => findById(id) },
  PUBSUB_TOPICS: { FOLDER_UPDATED: 'folder-updated' },
  pubsub: { publish: vi.fn() }
}))

const importFrom = vi.fn<(...args: unknown[]) => Promise<unknown>>()
vi.mock('../../src/main/services/import/ImportManager', () => ({
  importFrom: (...args: unknown[]): Promise<unknown> => importFrom(...args)
}))

const applyApiUpdate = vi.fn<(...args: unknown[]) => unknown>()
vi.mock('../../src/main/services/apiUpdate/applyApiUpdate', () => ({
  applyApiUpdate: (...args: unknown[]): unknown => applyApiUpdate(...args)
}))

vi.mock('../../src/main/services/apiUpdate/resolveAuthHeaders', () => ({
  resolveAuthHeadersForFolder: vi.fn(() => Promise.resolve({}))
}))

vi.mock('../../src/main/utils/urlSecurity', () => ({
  assertSafeFetchUrl: vi.fn()
}))

import { isImportSource, runApiUpdateApply } from '../../src/main/services/apiUpdate/orchestrateApply'
import { parseImportError, type ImportErrorCode, type ImportErrorParams } from '../../src/shared/config/importErrors'
import type { EnvironmentFolder } from '../../src/shared/types/folderTypes'

/**
 * Assert that an apply rejected with a NAMED failure.
 *
 * Every rejection this function raises crosses the IPC boundary as a
 * bare `Error.message` and is decoded by the renderer before anything
 * reaches the user, so the contract worth pinning is the decoded
 * `{ code, params }` — not the encoded string, which no user ever sees.
 */
async function expectImportError(
  run: () => Promise<unknown>,
  code: ImportErrorCode,
  params: ImportErrorParams = {}
): Promise<void> {
  let message: string | null = null
  try {
    await run()
  } catch (err) {
    message = err instanceof Error ? err.message : String(err)
  }
  expect(message, 'expected the apply to reject').not.toBeNull()
  if (message === null) return
  expect(parseImportError(message)).toEqual({ code, params })
}

const OPENAPI_3_SPEC = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '1.0.0' },
  paths: {
    '/pets': {
      get: { operationId: 'listPets', summary: 'List pets', responses: { 200: { description: 'ok' } } },
      post: { operationId: 'createPet', summary: 'Create a pet', responses: { 201: { description: 'created' } } }
    }
  }
})

const ODATA_METADATA = readFileSync(join(__dirname, 'odata-petstore-v4-metadata.xml'), 'utf8')

function folder(importSource: string): EnvironmentFolder {
  return {
    id: 'folder-1',
    name: 'Petstore',
    documentation: '',
    tags: [],
    configuration: {},
    items: [],
    folderType: 'environment',
    environments: [],
    importSource,
    apiUpdate: { sourceUrl: 'https://api.example.com/spec' }
  } as unknown as EnvironmentFolder
}

/** Serve `body` to both fetch call sites in the apply path: the
 * `importFrom` materialiser (mocked away) and the raw-text fetch the
 * hash + adapter parse consume. */
function stubFetch(body: string): void {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: () => Promise.resolve(body)
  })))
}

describe('isImportSource', () => {
  it('accepts every source backed by an idempotent adapter', () => {
    // openapi and odata are the two that were missing while their
    // adapters were already registered — a refresh on those folders
    // resolved no import source and threw before reaching the pipeline.
    for (const source of [
      'swagger', 'openapi', 'graphql', 'postman', 'insomnia', 'bruno',
      'asyncapi', 'grpc', 'wsdl', 'odata', 'smithy', 'openrpc'
    ]) {
      expect(isImportSource(source), source).toBe(true)
    }
  })

  it('accepts the one-shot sources that carry no adapter', () => {
    // They have no re-fetchable spec, so the apply still fails — but
    // on the precise "no idempotent adapter" error rather than the
    // misleading "no importSource".
    for (const source of ['curl', 'powershell', 'url']) {
      expect(isImportSource(source), source).toBe(true)
    }
  })

  it('still rejects anything that is not a known import source', () => {
    for (const value of ['nope', 'openapi4', 'OPENAPI', 'har', 'typespec', '', undefined]) {
      expect(isImportSource(value), String(value)).toBe(false)
    }
  })
})

describe('runApiUpdateApply source resolution', () => {
  beforeEach(() => {
    findById.mockReset()
    importFrom.mockReset()
    applyApiUpdate.mockReset()
    applyApiUpdate.mockReturnValue({ addedRequests: [], markedRequests: [] })
    importFrom.mockResolvedValue({ success: true, items: [folder('openapi')] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refreshes an OpenAPI 3.x folder instead of rejecting it', async () => {
    findById.mockReturnValue(folder('openapi'))
    stubFetch(OPENAPI_3_SPEC)

    await expect(runApiUpdateApply('folder-1')).resolves.toBeDefined()

    expect(applyApiUpdate).toHaveBeenCalledTimes(1)
    const input = applyApiUpdate.mock.calls[0]?.[0] as { importSource: string; spec: { operations: unknown[] } }
    expect(input.importSource).toBe('openapi')
    expect(input.spec.operations).toHaveLength(2)
  })

  it('refreshes an OData folder, parsing the CSDL metadata the adapter expects', async () => {
    findById.mockReturnValue(folder('odata'))
    stubFetch(ODATA_METADATA)

    await expect(runApiUpdateApply('folder-1')).resolves.toBeDefined()

    const input = applyApiUpdate.mock.calls[0]?.[0] as {
      importSource: string
      spec: { operations: { naturalKey: string }[] }
    }
    expect(input.importSource).toBe('odata')
    // EDMX is XML: routed through yaml.parse it collapses to a bare
    // string and the adapter reads zero entity sets. Assert the real
    // keys so the CSDL parse is what's being exercised, not just a
    // non-empty list.
    const keys = input.spec.operations.map((op) => op.naturalKey)
    expect(keys).toContain('entitySet Pets')
    expect(keys).toContain('function GetAvailablePets')
    expect(keys).toContain('action AdoptPet')
  })

  it('rejects a folder whose importSource is not a known format', async () => {
    findById.mockReturnValue(folder('definitely-not-a-format'))
    stubFetch(OPENAPI_3_SPEC)

    await expectImportError(() => runApiUpdateApply('folder-1'), 'noImportSource')
    expect(applyApiUpdate).not.toHaveBeenCalled()
  })

  it('re-raises the import pipeline\'s own failure code instead of a generic wrapper', async () => {
    // A non-2xx on the apply's re-fetch is a failure `importFrom`
    // already names. Collapsing it into `sourceImportFailed` would cost
    // the user the specific sentence and push "HTTP 500" into the
    // untranslated detail slot for no reason.
    findById.mockReturnValue(folder('openapi'))
    stubFetch(OPENAPI_3_SPEC)
    importFrom.mockResolvedValue({
      success: false,
      items: [],
      error: 'HTTP 500: Internal Server Error',
      errorCode: 'httpStatus',
      errorParams: { status: '500', detail: 'Internal Server Error' }
    })

    await expectImportError(() => runApiUpdateApply('folder-1'), 'httpStatus', {
      status: '500',
      detail: 'Internal Server Error'
    })
    expect(applyApiUpdate).not.toHaveBeenCalled()
  })

  it('wraps an unnamed import failure, keeping its text as diagnostic detail', async () => {
    // Everything `importFrom` could not name — a provider's own parse
    // throw, a filesystem error — reaches the user as a translated frame
    // with the original text beside it, never inside the sentence.
    findById.mockReturnValue(folder('openapi'))
    stubFetch(OPENAPI_3_SPEC)
    importFrom.mockResolvedValue({
      success: false,
      items: [],
      error: 'Unexpected token < in JSON at position 0'
    })

    await expectImportError(() => runApiUpdateApply('folder-1'), 'sourceImportFailed', {
      detail: 'Unexpected token < in JSON at position 0'
    })
    expect(applyApiUpdate).not.toHaveBeenCalled()
  })

  it('refuses to apply a spec that normalises to zero operations', async () => {
    // Applying it would flag every request the folder owns as removed.
    findById.mockReturnValue(folder('openapi'))
    stubFetch(JSON.stringify({ openapi: '3.0.0', info: { title: 'Empty', version: '1' }, paths: {} }))

    await expectImportError(() => runApiUpdateApply('folder-1'), 'emptySpec', {
      url: 'https://api.example.com/spec',
      format: 'openapi'
    })
    expect(applyApiUpdate).not.toHaveBeenCalled()
  })
})
