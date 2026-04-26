import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { importOpenAPI, importOpenAPIFromJson, resolveServerUrl } from '../../src/main/services/import/OpenAPIImportService'
import type { OAS3Spec } from '../../src/main/services/import/transformers/openapi3ToApiDocumentation'
import type { OAS31Spec } from '../../src/main/services/import/transformers/openapi31ToApiDocumentation'
import type { Folder, HTTPRequest } from '../../src/shared/models'

const FIXTURES = join(__dirname, 'fixtures/openapi')
const loadFixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), 'utf-8'))
const loadJson = (name: string): string => readFileSync(join(FIXTURES, name), 'utf-8')

describe('OpenAPIImportService — petstore-3.0', () => {
  it('produces an EnvironmentFolder rooted at the spec title', () => {
    const folder = importOpenAPI(loadFixture('petstore-3.0.json') as OAS3Spec)
    expect(folder.folderType).toBe('environment')
    expect(folder.name).toBe('Petstore')
    expect(folder.importSource).toBe('openapi')
    expect(folder.apiDocumentation?.sourceType).toBe('openapi')
  })

  it('groups requests by tag', () => {
    const folder = importOpenAPI(loadFixture('petstore-3.0.json') as OAS3Spec)
    const petFolder = folder.items.find((it) => 'items' in it && (it as Folder).name === 'pet') as Folder | undefined
    expect(petFolder).toBeDefined()
    expect(petFolder?.items.length).toBeGreaterThan(0)
  })

  it('rewrites OpenAPI {var} path templates as Handlebars {{var}}', () => {
    const folder = importOpenAPI(loadFixture('petstore-3.0.json') as OAS3Spec)
    const allRequests: HTTPRequest[] = []
    const walk = (items: Folder['items']): void => {
      for (const it of items) {
        if ('items' in it) walk((it as Folder).items)
        else allRequests.push(it as HTTPRequest)
      }
    }
    walk(folder.items)
    const getById = allRequests.find((r) => r.name === 'Find pet by ID')
    expect(getById?.url).toContain('{{petId}}')
    // Single-brace `{petId}` would mean the rewriter missed this placeholder.
    // Match isolated `{petId}` (not part of `{{petId}}`).
    expect(getById?.url).not.toMatch(/(?<!\{)\{petId\}(?!\})/)
  })

  it('extracts query enums as EnumDefinition with matching rules', () => {
    const folder = importOpenAPI(loadFixture('petstore-3.0.json') as OAS3Spec)
    expect(folder.enumDefinitions).toBeDefined()
    const statusEnum = folder.enumDefinitions?.find((d) => d.values.join(',') === 'available,pending,sold')
    expect(statusEnum).toBeDefined()
    expect(statusEnum?.matchingRules.some((r) => r.pathPattern === '/pet/findByStatus' && r.method === 'get' && r.paramName === 'status')).toBe(true)
  })

  it('produces an env with a baseUrl ExpressionValue derived from servers[0]', () => {
    const folder = importOpenAPI(loadFixture('petstore-3.0.json') as OAS3Spec)
    const env = folder.environments[0]
    const baseUrl = env?.variables.find((v) => v.key === 'baseUrl')
    expect(baseUrl).toBeDefined()
    // ExpressionValue's serialised form starts with '$' or carries the raw template;
    // assert that the template contains the host part.
    expect(JSON.stringify(baseUrl)).toContain('petstore3.swagger.io')
  })

  it('builds a JSON request body when the operation has multiple content types', () => {
    const folder = importOpenAPI(loadFixture('petstore-3.0.json') as OAS3Spec)
    const allRequests: HTTPRequest[] = []
    const walk = (items: Folder['items']): void => {
      for (const it of items) {
        if ('items' in it) walk((it as Folder).items)
        else allRequests.push(it as HTTPRequest)
      }
    }
    walk(folder.items)
    const addPet = allRequests.find((r) => r.name === 'Add a new pet')
    expect(addPet?.body?.type).toBe('text')
    if (addPet?.body?.type === 'text') {
      expect(addPet.body.content).toContain('"name"')
    }
  })
})

describe('OpenAPIImportService — multi-server', () => {
  it('builds one sub-environment per additional server', () => {
    const folder = importOpenAPI(loadFixture('multi-server-3.0.json') as OAS3Spec)
    const env = folder.environments[0]
    expect(env?.subEnvironments).toBeDefined()
    expect(env?.subEnvironments?.length).toBe(2)
    const names = env?.subEnvironments?.map((s) => s.name) ?? []
    expect(names).toEqual(expect.arrayContaining(['Staging', 'Local']))
  })

  it('exposes server-template variables as env vars', () => {
    const folder = importOpenAPI(loadFixture('multi-server-3.0.json') as OAS3Spec)
    const env = folder.environments[0]
    const envVarNames = env?.variables.map((v) => v.key) ?? []
    expect(envVarNames).toEqual(expect.arrayContaining(['environment', 'port', 'basePath', 'baseUrl']))
  })
})

describe('OpenAPIImportService — multi-content-type', () => {
  it('imports a request with the JSON body chosen by default', () => {
    const folder = importOpenAPI(loadFixture('multi-content-type-3.0.json') as OAS3Spec)
    const allRequests: HTTPRequest[] = []
    const walk = (items: Folder['items']): void => {
      for (const it of items) {
        if ('items' in it) walk((it as Folder).items)
        else allRequests.push(it as HTTPRequest)
      }
    }
    walk(folder.items)
    const op = allRequests[0]
    expect(op?.body?.type).toBe('text')
    if (op?.body?.type === 'text') {
      expect(op.body.content).toContain('"name"')
    }
  })

  it('records every content-type in the doc layer', () => {
    const folder = importOpenAPI(loadFixture('multi-content-type-3.0.json') as OAS3Spec)
    const opDoc = folder.apiDocumentation?.operations[0]
    expect(opDoc?.consumes).toEqual(expect.arrayContaining(['application/json', 'application/xml']))
    expect(opDoc?.produces).toEqual(expect.arrayContaining(['application/json', 'application/xml']))
  })
})

describe('OpenAPIImportService — 3.1 dispatching', () => {
  it('routes 3.1 specs through the 3.1 transformer', () => {
    const folder = importOpenAPI(loadFixture('petstore-3.1.json') as OAS31Spec)
    expect(folder.apiDocumentation?.sourceType).toBe('openapi')
    expect(folder.apiDocumentation?.api.title).toBe('Petstore 3.1')
  })

  it('exposes webhooks as a separate "Webhooks" folder marked documentation-only', () => {
    const folder = importOpenAPI(loadFixture('petstore-3.1.json') as OAS31Spec)
    const webhooksFolder = folder.items.find((it) => 'items' in it && (it as Folder).name === 'Webhooks') as Folder | undefined
    expect(webhooksFolder).toBeDefined()
    expect(webhooksFolder?.tags).toContain('webhook')
    expect(webhooksFolder?.documentation).toContain('Documentation-only')
  })
})

describe('OpenAPIImportService — JSON entry point', () => {
  it('importOpenAPIFromJson parses + imports + sets sourceUrl when provided', () => {
    const json = loadJson('petstore-3.0.json')
    const folder = importOpenAPIFromJson(json, { sourceUrl: 'https://example.com/openapi.json' })
    expect(folder.apiDocumentation?.sourceUrl).toBe('https://example.com/openapi.json')
  })
})

describe('resolveServerUrl', () => {
  it('passes absolute URLs through unchanged', () => {
    expect(resolveServerUrl('https://api.example.com/v1', 'https://example.com/openapi.json'))
      .toBe('https://api.example.com/v1')
    expect(resolveServerUrl('http://localhost:8080', undefined))
      .toBe('http://localhost:8080')
  })

  it('resolves a root-relative server URL against the spec source URL', () => {
    expect(resolveServerUrl('/v3', 'http://localhost:8081/openapi.json'))
      .toBe('http://localhost:8081/v3')
  })

  it('resolves a path-relative server URL against the spec source URL', () => {
    expect(resolveServerUrl('./api', 'https://example.com/specs/openapi.json'))
      .toBe('https://example.com/specs/api')
  })

  it('returns the raw URL when no sourceUrl is provided (file / paste import)', () => {
    expect(resolveServerUrl('/v3', undefined)).toBe('/v3')
  })

  it('passes server templates with placeholders through unchanged', () => {
    // `new URL("/{var}", base)` URL-encodes the braces — keep the
    // template intact so the env-variable layer can substitute.
    const template = 'https://{env}.api.example.com/v1'
    expect(resolveServerUrl(template, 'https://example.com/spec.json')).toBe(template)
  })
})

describe('OpenAPIImportService — relative servers[] resolution', () => {
  it('builds an absolute baseUrl when the spec has a root-relative server URL + sourceUrl is set', () => {
    const spec: OAS3Spec = {
      openapi: '3.0.0',
      info: { title: 'Local', version: '1.0' },
      servers: [{ url: '/v3' }],
      paths: {}
    }
    const folder = importOpenAPI(spec, { sourceUrl: 'http://localhost:8081/openapi.json' })
    const baseUrl = folder.environments[0]?.variables.find((v) => v.key === 'baseUrl')
    expect(JSON.stringify(baseUrl)).toContain('http://localhost:8081/v3')
  })

  it('keeps the relative server URL when no sourceUrl is provided', () => {
    const spec: OAS3Spec = {
      openapi: '3.0.0',
      info: { title: 'Local', version: '1.0' },
      servers: [{ url: '/v3' }],
      paths: {}
    }
    const folder = importOpenAPI(spec)
    const baseUrl = folder.environments[0]?.variables.find((v) => v.key === 'baseUrl')
    expect(JSON.stringify(baseUrl)).toContain('/v3')
    expect(JSON.stringify(baseUrl)).not.toContain('http://')
  })
})

describe('OpenAPIImportService — re-import idempotency', () => {
  it('produces the same folder shape on repeated imports', () => {
    const json = loadJson('petstore-3.0.json')
    const a = importOpenAPIFromJson(json)
    const b = importOpenAPIFromJson(json)
    // Stable ids derive from the spec path/method seed, not Date.now().
    expect(a.id).toEqual(b.id)
    expect(a.items.length).toEqual(b.items.length)
    const collectIds = (items: Folder['items']): string[] => {
      const out: string[] = []
      for (const it of items) {
        out.push(it.id)
        if ('items' in it) out.push(...collectIds((it as Folder).items))
      }
      return out
    }
    expect(collectIds(a.items)).toEqual(collectIds(b.items))
  })
})
