// @vitest-environment node
/**
 * Registry smoke test — verifies that every registered provider:
 *   1. Declines an empty string (canImport('') === false)
 *   2. Accepts its own canonical fixture (canImport(fixture) === true)
 *
 * Importing from ImportManager triggers providers.ts, which triggers all
 * service self-registrations, so importProviders is fully populated here.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { importProviders } from '../../src/main/services/import/providers'

const UNIT = join(__dirname)
const FIXTURES = join(__dirname, 'fixtures')

/** Canonical fixture for each registered format. */
const fixtures: Record<string, { content: string; filePath?: string }> = {
  restorm: {
    content: readFileSync(join(FIXTURES, 'restorm', 'mini-project.restorm'), 'utf-8'),
    filePath: 'mini-project.restorm'
  },
  curl: {
    content: 'curl -X GET https://petstore.example.com/pets'
  },
  powershell: {
    content: 'Invoke-RestMethod -Uri "https://petstore.example.com/pets" -Method GET'
  },
  'rest-client': {
    content: 'GET https://petstore.example.com/pets'
  },
  swagger: {
    content: readFileSync(join(UNIT, 'swagger-petstore.json'), 'utf-8')
  },
  'openapi-3.0': {
    content: readFileSync(join(FIXTURES, 'openapi', 'petstore-3.0.json'), 'utf-8')
  },
  'openapi-3.1': {
    content: readFileSync(join(FIXTURES, 'openapi', 'petstore-3.1.json'), 'utf-8')
  },
  postman: {
    content: readFileSync(join(UNIT, 'postman-petstore.json'), 'utf-8')
  },
  insomnia: {
    content: readFileSync(join(UNIT, 'insomnia-petstore.json'), 'utf-8')
  },
  bruno: {
    // No filePath on purpose: a Bruno export has neither a top-level
    // `type: 'collection'` nor a filename when it arrives from a URL or a
    // paste, so the provider has to recognise the collection's own shape.
    content: readFileSync(join(UNIT, 'bruno-petstore.json'), 'utf-8')
  },
  asyncapi: {
    content: readFileSync(join(UNIT, 'asyncapi-petstore.yaml'), 'utf-8')
  },
  odata: {
    // JSON-CSDL (v4) — top-level $Version discriminator
    content: readFileSync(join(FIXTURES, 'odata', 'v4-csdl.json'), 'utf-8')
  },
  openrpc: {
    // Top-level `openrpc` + `methods` discriminator
    content: readFileSync(join(FIXTURES, 'openrpc', 'echo.openrpc.json'), 'utf-8')
  },
  trpc: {
    // The restorm-specific `<base>/.trpc/_schema` shape — a `procedures`
    // object with at least one recognised `kind`.
    content: JSON.stringify({ procedures: { 'user.get': { kind: 'query', input: { id: 'number' }, output: {} } } })
  },
  'thunder-client': {
    content: readFileSync(join(FIXTURES, 'thunder-client', 'thunder-collection-sample.json'), 'utf-8')
  },
  httpie: {
    // HTTPie Desktop collection export — the session-file shape is covered
    // by HttpieImportService's own canImport tests.
    content: readFileSync(join(FIXTURES, 'httpie', 'collection.json'), 'utf-8')
  },
  graphql: {
    content: 'type Query { pet(id: ID!): Pet }\ntype Pet { id: ID! name: String }'
  },
  grpc: {
    content: readFileSync(join(UNIT, 'grpc-petstore.proto'), 'utf-8')
  },
  soap: {
    content: readFileSync(join(UNIT, 'soap-petstore.wsdl'), 'utf-8')
  },
  har: {
    content: readFileSync(join(FIXTURES, 'har', 'petstore.har'), 'utf-8')
  },
  paw: {
    content: readFileSync(join(FIXTURES, 'paw', 'paw-petstore.json'), 'utf-8')
  },
  smithy: {
    content: readFileSync(join(FIXTURES, 'smithy', 'weather.json'), 'utf-8')
  },
  raml: {
    content: readFileSync(join(FIXTURES, 'raml', 'petstore.raml'), 'utf-8')
  },
  wadl: {
    content: readFileSync(join(FIXTURES, 'wadl', 'petstore.wadl'), 'utf-8')
  },
  'api-blueprint': {
    content: readFileSync(join(FIXTURES, 'api-blueprint', 'polls.apib'), 'utf-8')
  },
  thrift: {
    content: readFileSync(join(FIXTURES, 'thrift', 'petstore.thrift'), 'utf-8')
  },
  typespec: {
    // canImport is extension-only (a .tsp file commonly needs its own
    // node_modules to compile, so content sniffing isn't meaningful here) —
    // the filePath is what the provider actually checks.
    content: readFileSync(join(FIXTURES, 'typespec', 'petstore.tsp'), 'utf-8'),
    filePath: 'main.tsp'
  }
}

describe('import provider registry', () => {
  beforeAll(() => {
    // Guard: the registry must be populated before any assertion.
    expect(importProviders.length).toBeGreaterThan(0)
  })

  it('has at least 14 registered providers (13 service files = 14 format entries)', () => {
    expect(importProviders.length).toBeGreaterThanOrEqual(14)
  })

  for (const provider of importProviders) {
    describe(`provider "${provider.format}"`, () => {
      it('returns false on empty string', () => {
        expect(provider.canImport('', undefined)).toBe(false)
      })

      it('returns true on its own canonical fixture', () => {
        const fixture = fixtures[provider.format]
        if (!fixture) {
          // A future provider without a fixture entry here would fail loudly.
          throw new Error(
            `No smoke-test fixture defined for provider "${provider.format}". ` +
            `Add an entry to the fixtures map in importRegistry.test.ts.`
          )
        }
        expect(provider.canImport(fixture.content, fixture.filePath)).toBe(true)
      })
    })
  }
})
