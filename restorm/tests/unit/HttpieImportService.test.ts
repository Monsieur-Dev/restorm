/**
 * Unit tests for `HttpieImportService` — covers both HTTPie export shapes
 * (Desktop collection tree, CLI session snapshot), the `canImport` sniff
 * that discriminates them from each other and from unrelated JSON, and
 * idempotent re-import.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  importHttpieCollection,
  importHttpieCollectionFromJson,
  importHttpieSession,
  importHttpieSessionFromJson
} from '../../src/main/services/import/HttpieImportService'
import { importProviders } from '../../src/main/services/import/providers'
import { HTTPRequest, Folder } from '../../src/shared/models'

const FIXTURES = join(__dirname, 'fixtures', 'httpie')
const collectionFixture = readFileSync(join(FIXTURES, 'collection.json'), 'utf-8')
const sessionFixture = readFileSync(join(FIXTURES, 'session.json'), 'utf-8')

function expectPresent<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) {
    throw new Error(`expected ${label} to be present`)
  }
  return value
}

const provider = expectPresent(
  importProviders.find((p) => p.format === 'httpie'),
  'the httpie provider'
)

describe('HttpieImportService — canImport', () => {
  it('returns false on an empty string', () => {
    expect(provider.canImport('', undefined)).toBe(false)
  })

  it('returns true for a Desktop collection export', () => {
    expect(provider.canImport(collectionFixture, undefined)).toBe(true)
  })

  it('returns true for a CLI session file', () => {
    expect(provider.canImport(sessionFixture, undefined)).toBe(true)
  })

  it('returns false for an unrelated JSON document', () => {
    expect(provider.canImport(JSON.stringify({ info: { title: 'Not HTTPie' } }), undefined)).toBe(false)
  })

  it('returns false for a Postman-shaped export (no HTTPie discriminators)', () => {
    expect(provider.canImport(JSON.stringify({ info: { schema: 'postman' }, item: [] }), undefined)).toBe(false)
  })
})

describe('importHttpieCollection', () => {
  it('imports a single top-level collection as the root folder', () => {
    const root = importHttpieCollectionFromJson(collectionFixture)
    expect(root.folderType).toBe('environment')
    expect(root.importSource).toBe('httpie')
    expect(root.name).toBe('Petstore')
  })

  it('builds a folder tree with nested requests', () => {
    const root = importHttpieCollectionFromJson(collectionFixture)
    const listPets = expectPresent(
      root.items.find((i): i is HTTPRequest => (i as HTTPRequest).type === 'http'),
      'the "List pets" request'
    )
    expect(listPets.name).toBe('List pets')
    expect(listPets.method).toBe('GET')
    expect(listPets.url).toBe('https://petstore.example.com/pets')
    expect(listPets.headers.find((h) => h.key === 'Accept')?.value.toString()).toBe('application/json')
    expect(listPets.params.find((p) => p.key === 'limit')?.value.toString()).toBe('20')

    const petFolder = expectPresent(
      root.items.find((i): i is Folder => 'items' in i && i.name === 'Pet'),
      'the "Pet" sub-folder'
    )
    expect(petFolder.items).toHaveLength(1)

    const createPet = petFolder.items[0] as HTTPRequest
    expect(createPet.name).toBe('Create pet')
    expect(createPet.method).toBe('POST')
    expect(createPet.body?.type).toBe('text')
    expect(createPet.body?.content).toContain('Fido')
  })

  it('honours a caller-supplied baseUrl', () => {
    const root = importHttpieCollectionFromJson(collectionFixture, { baseUrl: 'https://staging.example.com' })
    const baseUrl = root.environments[0]?.variables.find((v) => v.key === 'baseUrl')
    expect(baseUrl?.value.toString()).toBe('https://staging.example.com')
  })

  it('names multiple top-level collections generically and nests each as a sub-folder', () => {
    const root = importHttpieCollection({
      app: 'HTTPie Desktop',
      version: '2024.1.0',
      collections: [
        { name: 'Alpha', children: [] },
        { name: 'Beta', children: [] }
      ]
    })
    expect(root.name).toBe('HTTPie Import')
    expect((root.items as Folder[]).map((f) => f.name).sort()).toEqual(['Alpha', 'Beta'])
  })

  it('is idempotent: re-importing the same fixture yields structurally equal output', () => {
    const first = importHttpieCollectionFromJson(collectionFixture)
    const second = importHttpieCollectionFromJson(collectionFixture)
    expect(second).toEqual(first)
  })
})

describe('importHttpieSession', () => {
  it('imports the session as an empty environment folder carrying headers + auth as variables', () => {
    const root = importHttpieSessionFromJson(sessionFixture)
    expect(root.folderType).toBe('environment')
    expect(root.importSource).toBe('httpie')
    expect(root.items).toHaveLength(0)

    const vars = root.environments[0]?.variables ?? []
    expect(vars.find((v) => v.key === 'Accept')?.value.toString()).toBe('application/json')
    expect(vars.find((v) => v.key === 'X-Api-Key')?.value.toString()).toBe('sk_test_12345')
    expect(vars.find((v) => v.key === 'authType')?.value.toString()).toBe('basic')
    expect(vars.find((v) => v.key === 'authUsername')?.value.toString()).toBe('demo')
    expect(vars.find((v) => v.key === 'authPassword')?.value.toString()).toBe('demo-password')
  })

  it('includes baseUrl only when explicitly supplied', () => {
    const withoutBaseUrl = importHttpieSessionFromJson(sessionFixture)
    expect(withoutBaseUrl.environments[0]?.variables.find((v) => v.key === 'baseUrl')).toBeUndefined()

    const withBaseUrl = importHttpieSessionFromJson(sessionFixture, { baseUrl: 'https://api.example.com' })
    expect(withBaseUrl.environments[0]?.variables.find((v) => v.key === 'baseUrl')?.value.toString()).toBe(
      'https://api.example.com'
    )
  })

  it('skips auth variables entirely when the session has no auth configured', () => {
    const root = importHttpieSession({ __meta__: {}, headers: { 'X-Foo': 'bar' } })
    const vars = root.environments[0]?.variables ?? []
    expect(vars.find((v) => v.key === 'authType')).toBeUndefined()
  })

  it('is idempotent: re-importing the same fixture yields structurally equal output', () => {
    const first = importHttpieSessionFromJson(sessionFixture)
    const second = importHttpieSessionFromJson(sessionFixture)
    expect(second).toEqual(first)
  })
})
