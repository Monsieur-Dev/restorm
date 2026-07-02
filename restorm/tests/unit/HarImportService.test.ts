/**
 * Unit tests for `HarImportService` — parses the committed HAR fixture
 * (a Chrome-DevTools-shaped export) and asserts the shape of the generated
 * EnvironmentFolder, plus detection + idempotency.
 */

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { detectFormat } from '../../src/main/services/import/ImportManager'
import type { HTTPRequest } from '../../src/shared/models'
import type { Folder } from '../../src/shared/types/collections'

const { storeExecutionResult } = vi.hoisted(() => ({ storeExecutionResult: vi.fn() }))
vi.mock('../../src/main/services/ResponseHistoryService', () => ({
  responseHistoryService: { storeExecutionResult }
}))

const {
  importHar,
  importHarFromJson,
  pairHarEntriesWithRequestIds,
  seedResponseHistoryFromHar
} = await import('../../src/main/services/import/HarImportService')
type HarFile = import('../../src/main/services/import/HarImportService').HarFile

const fixturePath = join(__dirname, 'fixtures/har/petstore.har')
const fixture = readFileSync(fixturePath, 'utf-8')

function isHTTPRequest(item: Folder | HTTPRequest): item is HTTPRequest {
  return (item as HTTPRequest).type === 'http'
}

function expectPresent<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) {
    throw new Error(`expected ${label} to be present`)
  }
  return value
}

function findRequest(items: readonly (Folder | HTTPRequest)[], namePrefix: string): HTTPRequest {
  const request = items.find((r): r is HTTPRequest => isHTTPRequest(r) && r.name.startsWith(namePrefix))
  return expectPresent(request, `request starting with "${namePrefix}"`)
}

describe('detectFormat — HAR', () => {
  it('detects a HAR export from log.version', () => {
    expect(detectFormat(fixture)).toBe('har')
  })

  it('does NOT mis-detect an unrelated JSON document', () => {
    expect(detectFormat(JSON.stringify({ hello: 'world' }))).not.toBe('har')
  })

  it('does NOT mis-detect a Postman collection (disjoint root shape)', () => {
    const postman = JSON.stringify({ info: { name: 'x', schema: 'https://schema.postman.com/v2.1.0' }, item: [] })
    expect(detectFormat(postman)).not.toBe('har')
  })

  it('falls back to the .har extension when `version` is missing', () => {
    const noVersion = JSON.stringify({ log: { entries: [] } })
    expect(detectFormat(noVersion, 'capture.har')).toBe('har')
    expect(detectFormat(noVersion, 'capture.json')).not.toBe('har')
  })
})

describe('importHarFromJson (single-page fixture)', () => {
  it('returns an EnvironmentFolder with har-tagged import origin, named after the page', () => {
    const root = importHarFromJson(fixture)
    expect(root.folderType).toBe('environment')
    expect(root.importSource).toBe('har')
    expect(root.name).toBe('https://api.petstore.example/')
  })

  it('imports every entry flat (single page — no redundant sub-folder)', () => {
    const root = importHarFromJson(fixture)
    expect(root.items).toHaveLength(4)
    expect(root.items.every(isHTTPRequest)).toBe(true)
  })

  it('maps method, URL and query params for a GET entry', () => {
    const root = importHarFromJson(fixture)
    const get = findRequest(root.items, 'GET')
    expect(get.method).toBe('GET')
    expect(get.url).toBe('https://api.petstore.example/api/pets?status=available')
    expect(get.params.map((p) => p.key)).toEqual(['status'])
    expect(get.params[0]?.value.toString()).toBe('available')
  })

  it('drops HTTP/2 pseudo-headers and content-length, merges cookies[] into a single Cookie header', () => {
    const root = importHarFromJson(fixture)
    const get = findRequest(root.items, 'GET')
    const headerNames = get.headers.map((h) => h.key.toLowerCase())
    expect(headerNames).not.toContain(':authority')
    expect(headerNames).not.toContain('content-length')
    const cookieHeaders = get.headers.filter((h) => h.key.toLowerCase() === 'cookie')
    expect(cookieHeaders).toHaveLength(1)
    expect(cookieHeaders[0]?.value.toString()).toBe('session_id=abc123')
  })

  it('imports a JSON body as raw text', () => {
    const root = importHarFromJson(fixture)
    const post = findRequest(root.items, 'POST /api/pets')
    expect(post.body?.type).toBe('text')
    expect(post.body?.content).toBe('{"name":"Fido","status":"available"}')
  })

  it('imports an x-www-form-urlencoded body as typed fields', () => {
    const root = importHarFromJson(fixture)
    const login = findRequest(root.items, 'POST /api/login')
    expect(login.body?.type).toBe('x-www-form-urlencoded')
    expect(login.body?.fields?.map((f) => f.key)).toEqual(['username', 'password'])
    expect(login.body?.fields?.[0]?.value.toString()).toBe('alice')
  })

  it('imports a multipart/form-data body (including a file field) as form-data fields', () => {
    const root = importHarFromJson(fixture)
    const upload = findRequest(root.items, 'POST /api/pets/2/photo')
    expect(upload.body?.type).toBe('form-data')
    const caption = upload.body?.fields?.find((f) => f.key === 'caption')
    expect(caption?.value.toString()).toBe('Fido at the park')
    // A file param carries no `value` in HAR — the file name is the best
    // available stand-in so the field isn't silently dropped.
    const photo = upload.body?.fields?.find((f) => f.key === 'photo')
    expect(photo?.value.toString()).toBe('fido.jpg')
  })

  it('is idempotent — re-parsing the same content yields the same ids in the same order', () => {
    const first = importHarFromJson(fixture)
    const second = importHarFromJson(fixture)
    expect(second.id).toBe(first.id)
    expect((second.items as HTTPRequest[]).map((r) => r.id)).toEqual((first.items as HTTPRequest[]).map((r) => r.id))
    expect((second.items as HTTPRequest[]).map((r) => r.name)).toEqual((first.items as HTTPRequest[]).map((r) => r.name))
  })
})

describe('importHar — multi-page grouping', () => {
  const multiPage: HarFile = {
    log: {
      version: '1.2',
      pages: [
        { id: 'page_1', title: 'Home' },
        { id: 'page_2', title: 'Checkout' }
      ],
      entries: [
        { pageref: 'page_1', request: { method: 'GET', url: 'https://shop.example/api/home' } },
        { pageref: 'page_2', request: { method: 'GET', url: 'https://shop.example/api/cart' } },
        { pageref: 'page_2', request: { method: 'POST', url: 'https://shop.example/api/checkout' } }
      ]
    }
  }

  it('creates one folder per page, named after the page title', () => {
    const root = importHar(multiPage)
    const folders = root.items as Folder[]
    expect(folders.map((f) => f.name).sort()).toEqual(['Checkout', 'Home'])
    const home = expectPresent(folders.find((f) => f.name === 'Home'), 'Home folder')
    expect(home.items).toHaveLength(1)
    const checkout = expectPresent(folders.find((f) => f.name === 'Checkout'), 'Checkout folder')
    expect(checkout.items).toHaveLength(2)
  })
})

describe('importHar — no page information', () => {
  const noPages: HarFile = {
    log: {
      version: '1.2',
      entries: [{ request: { method: 'GET', url: 'https://example.com/api/ping' } }]
    }
  }

  it('falls back to a single "Imported from HAR" root, flat items', () => {
    const root = importHar(noPages)
    expect(root.name).toBe('Imported from HAR')
    expect(root.items).toHaveLength(1)
    expect(isHTTPRequest(expectPresent(root.items[0], 'items[0]'))).toBe(true)
  })
})

describe('pairHarEntriesWithRequestIds', () => {
  it('produces the exact ids importHar stamped on the same document', () => {
    const har = JSON.parse(fixture) as HarFile
    const root = importHarFromJson(fixture)
    const pairs = pairHarEntriesWithRequestIds(har)
    expect(pairs).toHaveLength(4)
    expect(pairs.map((p) => p.requestId)).toEqual((root.items as HTTPRequest[]).map((r) => r.id))
  })
})

describe('seedResponseHistoryFromHar', () => {
  it('stores one history entry per entry that carries a response, keyed by the matching request id', async () => {
    storeExecutionResult.mockClear()
    const har = JSON.parse(fixture) as HarFile
    const pairs = pairHarEntriesWithRequestIds(har)

    await seedResponseHistoryFromHar(har)

    // Every fixture entry carries a response, so every request gets seeded.
    expect(storeExecutionResult).toHaveBeenCalledTimes(pairs.length)
    const getPair = expectPresent(pairs[0], 'pairs[0]')
    expect(storeExecutionResult).toHaveBeenCalledWith(
      getPair.requestId,
      'http',
      expect.objectContaining({
        requestId: getPair.requestId,
        statusCode: 200,
        body: expect.stringContaining('available')
      })
    )
  })

  it('skips entries with no response', async () => {
    storeExecutionResult.mockClear()
    const har: HarFile = {
      log: {
        version: '1.2',
        entries: [{ request: { method: 'GET', url: 'https://example.com/api/ping' } }]
      }
    }
    await seedResponseHistoryFromHar(har)
    expect(storeExecutionResult).not.toHaveBeenCalled()
  })
})
