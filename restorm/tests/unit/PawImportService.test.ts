/**
 * Unit tests for `PawImportService` — parses the committed Paw JSON export
 * fixture and asserts the shape of the generated EnvironmentFolder, the
 * dynamic-value → Handlebars mapping, and `canImport` detection.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { importPaw, importPawFromJson } from '../../src/main/services/import/PawImportService'
import { resolveTemplate } from '../../src/main/services/request/resolveTemplate'
import { HTTPRequest } from '../../src/shared/models'
import type { Folder, FolderItem } from '../../src/shared/types/collections'

const fixturePath = join(__dirname, 'fixtures/paw/paw-petstore.json')
const fixture = readFileSync(fixturePath, 'utf-8')

function findFolder(items: FolderItem[], name: string): Folder {
  const folder = (items as Folder[]).find((f): f is Folder => 'items' in f && f.name === name)
  if (!folder) throw new Error(`expected folder "${name}" to be present`)
  return folder
}

function findRequest(items: FolderItem[], name: string): HTTPRequest {
  const request = (items as HTTPRequest[]).find((r) => r.type === 'http' && r.name === name)
  if (!request) throw new Error(`expected request "${name}" to be present`)
  return request
}

describe('importPawFromJson', () => {
  it('returns an EnvironmentFolder with paw-tagged import origin', () => {
    const root = importPawFromJson(fixture)
    expect(root.folderType).toBe('environment')
    expect(root.importSource).toBe('paw')
  })

  it('preserves the folder/group hierarchy', () => {
    const root = importPawFromJson(fixture)
    const pets = findFolder(root.items, 'Pets')
    expect(pets.items).toHaveLength(2)
  })

  it('maps a request to method, URL, headers, query params and description', () => {
    const root = importPawFromJson(fixture)
    const pets = findFolder(root.items, 'Pets')
    const request = findRequest(pets.items, 'Get pet by id')
    expect(request.method).toBe('GET')
    expect(request.url).toBe('http://localhost:8080/v2/pet/1')
    expect(request.documentation).toBe('Fetch a pet by id.')

    const accept = request.headers.find((h) => h.key === 'Accept')
    expect(accept?.value.toString()).toBe('application/json')
  })

  it('maps a JSON body to a text HTTPRequestBody', () => {
    const root = importPawFromJson(fixture)
    const pets = findFolder(root.items, 'Pets')
    const request = findRequest(pets.items, 'Create pet')
    expect(request.method).toBe('POST')
    expect(request.body?.type).toBe('text')
    expect(request.body?.content).toContain('"name": "Fido"')
  })

  it('maps recognized dynamic values to their Handlebars equivalent', () => {
    const root = importPawFromJson(fixture)
    const pets = findFolder(root.items, 'Pets')
    const request = findRequest(pets.items, 'Get pet by id')

    // Assert both the mapped template AND that it actually resolves to a real
    // value at runtime (the shared Handlebars context is where Postman-style
    // `{{$...}}` dynamic vars are registered) — a template that maps to a
    // helper name resorm doesn't register would still pass a string-only
    // assertion while silently resolving to "" for the user.
    const requestId = request.headers.find((h) => h.key === 'X-Request-Id')
    expect(requestId?.value.toString()).toBe('{{$randomAlphaNumeric}}')
    expect(resolveTemplate(requestId?.value.toString() ?? '', {})).toMatch(/^[A-Za-z0-9]+$/)

    const timestamp = request.headers.find((h) => h.key === 'X-Timestamp')
    expect(timestamp?.value.toString()).toBe('{{$timestamp}}')
    expect(resolveTemplate(timestamp?.value.toString() ?? '', {})).toMatch(/^\d{10}$/)

    const traceId = request.params.find((p) => p.key === 'traceId')
    expect(traceId?.value.toString()).toBe('{{$guid}}')
    expect(resolveTemplate(traceId?.value.toString() ?? '', {})).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  it('replaces an unrecognized dynamic value with a placeholder and a note', () => {
    const root = importPawFromJson(fixture)
    const pets = findFolder(root.items, 'Pets')
    const request = findRequest(pets.items, 'Get pet by id')

    const sessionCookie = request.params.find((p) => p.key === 'sessionCookie')
    expect(sessionCookie?.value.toString()).toBe('[[paw:unsupported-dynamic-value]]')
    expect(sessionCookie?.description).toContain('CookieJarDynamicValue')
  })

  it('extracts environments with resolved dynamic-value variables', () => {
    const root = importPawFromJson(fixture)
    expect(root.environments).toHaveLength(1)
    const env = root.environments[0]
    expect(env?.name).toBe('Production')

    const baseUrl = env?.variables.find((v) => v.key === 'baseUrl')
    expect(baseUrl?.value.toString()).toBe('http://localhost:8080/v2')

    const apiKey = env?.variables.find((v) => v.key === 'apiKey')
    expect(apiKey?.value.toString()).toBe('{{$randomAlphaNumeric}}')
    expect(resolveTemplate(apiKey?.value.toString() ?? '', {})).toMatch(/^[A-Za-z0-9]+$/)
  })

  it('is idempotent: parsing the same fixture twice yields structurally equal output', () => {
    const first = importPawFromJson(fixture)
    const second = importPawFromJson(fixture)
    expect(second).toEqual(first)
  })

  it('throws on an export with no requests', () => {
    expect(() => importPaw({ requests: undefined } as never)).toThrow()
  })
})

describe('PawImportService canImport (via the provider registry)', () => {
  it('detects a fixture Paw export via requests/requestGroups dicts', async () => {
    const { importProviders } = await import('../../src/main/services/import/providers')
    const provider = importProviders.find((p) => p.format === 'paw')
    expect(provider).toBeDefined()
    expect(provider?.canImport(fixture)).toBe(true)
  })

  it('detects a Paw export via the pawVersion field alone', async () => {
    const { importProviders } = await import('../../src/main/services/import/providers')
    const provider = importProviders.find((p) => p.format === 'paw')
    expect(provider?.canImport(JSON.stringify({ pawVersion: 3, requests: {} }))).toBe(true)
  })

  it('rejects a Postman collection (item[] tree, no requests dict)', async () => {
    const { importProviders } = await import('../../src/main/services/import/providers')
    const provider = importProviders.find((p) => p.format === 'paw')
    expect(provider?.canImport(JSON.stringify({ info: { name: 'x' }, item: [] }))).toBe(false)
  })

  it('rejects an Insomnia export (resources[] list, no requests dict)', async () => {
    const { importProviders } = await import('../../src/main/services/import/providers')
    const provider = importProviders.find((p) => p.format === 'paw')
    expect(provider?.canImport(JSON.stringify({ _type: 'export', resources: [] }))).toBe(false)
  })

  it('rejects arbitrary JSON', async () => {
    const { importProviders } = await import('../../src/main/services/import/providers')
    const provider = importProviders.find((p) => p.format === 'paw')
    expect(provider?.canImport(JSON.stringify({ hello: 'world' }))).toBe(false)
  })

  it('rejects non-JSON content', async () => {
    const { importProviders } = await import('../../src/main/services/import/providers')
    const provider = importProviders.find((p) => p.format === 'paw')
    expect(provider?.canImport('not json at all')).toBe(false)
  })
})
