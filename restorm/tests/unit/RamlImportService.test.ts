import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { importRaml } from '../../src/main/services/import/RamlImportService'
import type { Folder, HTTPRequest } from '../../src/shared/models'
import { ExpressionValue } from '../../src/shared/types/collections'

const FIXTURE_PATH = join(__dirname, 'fixtures/raml/petstore.raml')
const loadFixture = (): string => readFileSync(FIXTURE_PATH, 'utf-8')

function collectRequests(items: Folder['items']): HTTPRequest[] {
  const out: HTTPRequest[] = []
  for (const item of items) {
    if ('items' in item) out.push(...collectRequests((item as Folder).items))
    else out.push(item as HTTPRequest)
  }
  return out
}

describe('RamlImportService — petstore fixture', () => {
  it('produces an EnvironmentFolder rooted at the API title', () => {
    const folder = importRaml(loadFixture())
    expect(folder.folderType).toBe('environment')
    expect(folder.name).toBe('Pet Store RAML API')
    expect(folder.importSource).toBe('raml')
    expect(folder.apiDocumentation?.sourceType).toBe('raml')
  })

  it('maps resources to folders and methods to HTTP requests', () => {
    const folder = importRaml(loadFixture())
    const petFolder = folder.items.find((item) => 'items' in item && (item as Folder).name === 'Pet') as Folder | undefined
    expect(petFolder).toBeDefined()

    const requests = collectRequests(folder.items)
    expect(requests.some((r) => r.method === 'GET' && r.url.endsWith('/pet/findByStatus'))).toBe(true)
    expect(requests.some((r) => r.method === 'POST' && r.url.endsWith('/pet'))).toBe(true)
    expect(requests.some((r) => r.method === 'GET' && r.url.includes('{{petId}}'))).toBe(true)
    expect(requests.some((r) => r.method === 'DELETE' && r.url.includes('{{petId}}'))).toBe(true)
  })

  it('rewrites RAML {var} path templates as Handlebars {{var}}', () => {
    const folder = importRaml(loadFixture())
    const requests = collectRequests(folder.items)
    const byId = requests.find((r) => r.method === 'GET' && r.url.includes('petId'))
    expect(byId?.url).toContain('{{petId}}')
    expect(byId?.url).not.toMatch(/(?<!\{)\{petId\}(?!\})/)
    expect(byId?.pathParams.some((p) => p.key === 'petId')).toBe(true)
  })

  it('pre-wires Basic and OAuth2 Authorization headers from securedBy', () => {
    const folder = importRaml(loadFixture())
    const requests = collectRequests(folder.items)
    const post = requests.find((r) => r.method === 'POST')
    expect(post?.headers.find((h) => h.key === 'Authorization')?.value).toBeInstanceOf(ExpressionValue)
    const getById = requests.find((r) => r.method === 'GET' && r.url.includes('petId'))
    expect(getById?.headers.find((h) => h.key === 'Authorization')?.value).toBeInstanceOf(ExpressionValue)
  })

  it('does not pre-wire an Authorization value on an unsecured method', () => {
    const folder = importRaml(loadFixture())
    const requests = collectRequests(folder.items)
    // "find by status" carries no `securedBy` — its `Authorization` header
    // (from the `secured` trait's plain header declaration) must stay an
    // empty, user-editable value rather than a pre-wired Bearer/Basic
    // expression, since there is no security scheme to derive one from.
    const findByStatus = requests.find((r) => r.method === 'GET' && r.url.endsWith('/pet/findByStatus'))
    const authHeader = findByStatus?.headers.find((h) => h.key === 'Authorization')
    expect(authHeader?.value).not.toBeInstanceOf(ExpressionValue)
  })

  it('maps RAML data types onto ApiDocumentation.models', () => {
    const folder = importRaml(loadFixture())
    const models = folder.apiDocumentation?.models ?? {}
    expect(models.Pet).toBeDefined()
    expect(models.Pet?.properties.some((p) => p.name === 'status')).toBe(true)
    expect(models.Tag).toBeDefined()
  })

  it('generates a sample body referencing named types', () => {
    const folder = importRaml(loadFixture())
    const requests = collectRequests(folder.items)
    const post = requests.find((r) => r.method === 'POST')
    expect(post?.body?.type).toBe('text')
    const parsed = JSON.parse((post?.body as { content: string }).content)
    expect(parsed).toHaveProperty('id')
    expect(parsed).toHaveProperty('name')
  })

  it('is idempotent — re-parsing the same content produces the same ids and order', () => {
    const first = importRaml(loadFixture())
    const second = importRaml(loadFixture())
    expect(second.id).toBe(first.id)
    const firstRequests = collectRequests(first.items).map((r) => r.id)
    const secondRequests = collectRequests(second.items).map((r) => r.id)
    expect(secondRequests).toEqual(firstRequests)
  })
})

describe('RamlImportService — !include lockdown', () => {
  // A RAML document is attacker-controlled content: its `!include` directive
  // must never be able to read an arbitrary local file or reach an arbitrary
  // URL (SSRF against loopback / RFC1918 / cloud metadata). Both channels
  // must throw rather than silently inline the fetched content.
  it('refuses to resolve a local-file !include', () => {
    const malicious = `#%RAML 1.0
title: Malicious
baseUri: http://localhost:8080
types:
  Evil: !include /etc/passwd
/pets:
  get:
    responses:
      200:
        body:
          application/json:
            type: Evil
`
    expect(() => importRaml(malicious)).toThrow(/refusing to resolve/)
  })

  it('refuses to resolve an http(s) !include (SSRF)', () => {
    const malicious = `#%RAML 1.0
title: Malicious
baseUri: http://localhost:8080
types:
  Evil: !include http://169.254.169.254/latest/meta-data/
/pets:
  get:
    responses:
      200:
        body:
          application/json:
            type: Evil
`
    expect(() => importRaml(malicious)).toThrow()
  })
})

describe('RamlImportService — canImport', () => {
  it('detects the RAML 1.0 header', async () => {
    const { importProviders } = await import('../../src/main/services/import/providers')
    const raml = importProviders.find((p) => p.format === 'raml')
    expect(raml).toBeDefined()
    expect(raml?.canImport(loadFixture())).toBe(true)
  })

  it('detects a .raml file extension even without scanning content', async () => {
    const { importProviders } = await import('../../src/main/services/import/providers')
    const raml = importProviders.find((p) => p.format === 'raml')
    expect(raml?.canImport('anything', 'spec.raml')).toBe(true)
  })

  it('detects the RAML 0.8 header', async () => {
    const { importProviders } = await import('../../src/main/services/import/providers')
    const raml = importProviders.find((p) => p.format === 'raml')
    expect(raml?.canImport('#%RAML 0.8\ntitle: Legacy API\nbaseUri: http://example.com')).toBe(true)
  })

  it('rejects plain YAML and JSON content', async () => {
    const { importProviders } = await import('../../src/main/services/import/providers')
    const raml = importProviders.find((p) => p.format === 'raml')
    expect(raml?.canImport('openapi: 3.0.0\ninfo:\n  title: Not RAML\n')).toBe(false)
    expect(raml?.canImport('{"openapi": "3.0.0"}')).toBe(false)
  })
})
