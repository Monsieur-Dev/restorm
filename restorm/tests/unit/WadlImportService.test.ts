/**
 * Unit tests for `WadlImportService` — parses a JAX-RS-generated WADL
 * fixture and asserts the shape of the generated EnvironmentFolder.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { importWadl } from '../../src/main/services/import/WadlImportService'
import { HTTPRequest } from '../../src/shared/models'
import type { Folder } from '../../src/shared/types/collections'

const fixturePath = join(__dirname, 'fixtures/wadl/petstore.wadl')
const fixture = readFileSync(fixturePath, 'utf-8')

function expectPresent<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) {
    throw new Error(`expected ${label} to be present`)
  }
  return value
}

function findSubFolder(root: ReturnType<typeof importWadl>, name: string): Folder {
  const folder = (root.items as Folder[]).find((f): f is Folder => 'items' in f && f.name === name)
  return expectPresent(folder, `folder "${name}"`)
}

function findRequest(folder: Folder, method: string): HTTPRequest {
  const request = folder.items.find((i): i is HTTPRequest => i instanceof HTTPRequest && i.method === method)
  return expectPresent(request, `${method} request in folder "${folder.name}"`)
}

describe('importWadl', () => {
  it('returns an EnvironmentFolder with wadl-tagged import origin', () => {
    const root = importWadl(fixture, { sourceUrl: 'http://petstore.example.com/api/application.wadl' })
    expect(root.folderType).toBe('environment')
    expect(root.importSource).toBe('wadl')
    expect(root.apiDocumentation?.sourceType).toBe('wadl')
    expect(root.apiDocumentation?.sourceUrl).toBe('http://petstore.example.com/api/application.wadl')
  })

  it('derives the environment baseUrl from <resources base>', () => {
    const root = importWadl(fixture)
    expect(root.environments).toHaveLength(1)
    const env = expectPresent(root.environments[0], 'environment[0]')
    const baseUrl = env.variables.find((v) => v.key === 'baseUrl')
    expect(baseUrl?.value.toString()).toBe('http://petstore.example.com/api/')
  })

  it('honours a caller-supplied baseUrl override', () => {
    const root = importWadl(fixture, { baseUrl: 'https://prod.example.com/api/' })
    const env = expectPresent(root.environments[0], 'environment[0]')
    const baseUrl = env.variables.find((v) => v.key === 'baseUrl')
    expect(baseUrl?.value.toString()).toBe('https://prod.example.com/api/')
  })

  it('maps <resource path="pets"> to a top-level folder with GET + POST requests', () => {
    const root = importWadl(fixture)
    const pets = findSubFolder(root, 'pets')
    expect(pets.items.filter((i) => i instanceof HTTPRequest)).toHaveLength(2)
    const get = findRequest(pets, 'GET')
    expect(get.name).toBe('getPets')
    expect(get.url).toBe('{{baseUrl}}/pets')
  })

  it('maps a query-style <param> onto request.params', () => {
    const root = importWadl(fixture)
    const pets = findSubFolder(root, 'pets')
    const get = findRequest(pets, 'GET')
    expect(get.params.map((p) => p.key)).toContain('status')
    expect(get.pathParams).toHaveLength(0)
  })

  it('sets Content-Type + Accept headers from <representation mediaType>', () => {
    const root = importWadl(fixture)
    const pets = findSubFolder(root, 'pets')
    const post = findRequest(pets, 'POST')
    expect(post.headers.some((h) => h.key === 'Content-Type' && h.value.toString() === 'application/json')).toBe(true)
    expect(post.headers.some((h) => h.key === 'Accept' && h.value.toString() === 'application/json')).toBe(true)
    expect(post.body?.type).toBe('text')
  })

  it('nests <resource path="{id}"> as a child folder and rewrites the template to Handlebars', () => {
    const root = importWadl(fixture)
    const pets = findSubFolder(root, 'pets')
    const byId = (pets.items as Folder[]).find((f): f is Folder => 'items' in f && f.name === '{id}')
    const idFolder = expectPresent(byId, 'folder "{id}"')
    expect(idFolder.items.filter((i) => i instanceof HTTPRequest)).toHaveLength(2)
    const get = findRequest(idFolder, 'GET')
    expect(get.url).toBe('{{baseUrl}}/pets/{{id}}')
  })

  it('inherits the ancestor <resource>-level template param into every method under it', () => {
    const root = importWadl(fixture)
    const pets = findSubFolder(root, 'pets')
    const idFolder = expectPresent(
      (pets.items as Folder[]).find((f): f is Folder => 'items' in f && f.name === '{id}'),
      'folder "{id}"'
    )
    const get = findRequest(idFolder, 'GET')
    expect(get.pathParams.map((p) => p.key)).toEqual(['id'])
    const del = findRequest(idFolder, 'DELETE')
    expect(del.pathParams.map((p) => p.key)).toEqual(['id'])
  })

  it('maps a header-style <param> onto request.headers', () => {
    const root = importWadl(fixture)
    const pets = findSubFolder(root, 'pets')
    const idFolder = expectPresent(
      (pets.items as Folder[]).find((f): f is Folder => 'items' in f && f.name === '{id}'),
      'folder "{id}"'
    )
    const del = findRequest(idFolder, 'DELETE')
    expect(del.headers.some((h) => h.key === 'X-Api-Key')).toBe(true)
  })

  it('extracts the inline grammar complexType into an ApiDocumentation model', () => {
    const root = importWadl(fixture)
    const doc = expectPresent(root.apiDocumentation, 'apiDocumentation')
    const pet = expectPresent(doc.models['pet'], 'pet model')
    expect(pet.properties.map((p) => p.name).sort()).toEqual(['id', 'name', 'status'])
    const idProp = expectPresent(pet.properties.find((p) => p.name === 'id'), 'pet.id property')
    expect(idProp.type).toBe('long')
    expect(idProp.required).toBe(false)
    const nameProp = expectPresent(pet.properties.find((p) => p.name === 'name'), 'pet.name property')
    expect(nameProp.required).toBe(true)
  })

  it('notes an external XSD schema reference without resolving it', () => {
    const root = importWadl(fixture)
    const doc = expectPresent(root.apiDocumentation, 'apiDocumentation')
    expect(doc.api.description).toContain('order.xsd')
    expect(doc.api.description).toContain('not resolved')
  })

  it('produces one OperationDocumentation entry per method, keyed by URL + verb', () => {
    const root = importWadl(fixture)
    const doc = expectPresent(root.apiDocumentation, 'apiDocumentation')
    expect(doc.operations).toHaveLength(4)
    const getById = doc.operations.find((op) => op.match.urlPattern === '/pets/{id}' && op.match.method === 'GET')
    expect(getById?.operationId).toBe('getPetById')
  })

  it('is idempotent — re-parsing the same document yields identical output', () => {
    const first = importWadl(fixture)
    const second = importWadl(fixture)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('throws a clean error on malformed XML', () => {
    expect(() => importWadl('<application><resources base="x">')).toThrow(/Invalid WADL XML/)
  })
})

describe('WadlImportService provider registration', () => {
  it('detects the fixture via the .wadl extension', async () => {
    const { importProviders } = await import('../../src/main/services/import/providers')
    const provider = expectPresent(importProviders.find((p) => p.format === 'wadl'), 'wadl provider')
    expect(provider.canImport('not xml at all', 'application.wadl')).toBe(true)
  })

  it('detects the fixture via the WADL namespace, independent of the file extension', async () => {
    const { importProviders } = await import('../../src/main/services/import/providers')
    const provider = expectPresent(importProviders.find((p) => p.format === 'wadl'), 'wadl provider')
    expect(provider.canImport(fixture)).toBe(true)
  })

  it('declines a WSDL document', async () => {
    const { importProviders } = await import('../../src/main/services/import/providers')
    const provider = expectPresent(importProviders.find((p) => p.format === 'wadl'), 'wadl provider')
    const wsdl = readFileSync(join(__dirname, 'soap-petstore.wsdl'), 'utf-8')
    expect(provider.canImport(wsdl)).toBe(false)
  })
})
