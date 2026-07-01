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
  curl: {
    content: 'curl -X GET https://petstore.example.com/pets'
  },
  powershell: {
    content: 'Invoke-RestMethod -Uri "https://petstore.example.com/pets" -Method GET'
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
    // bruno-petstore.json has version+name but no top-level type:'collection';
    // the provider also accepts any valid JSON with version+name when the file
    // extension is .json — so we pass the real filename as filePath.
    content: readFileSync(join(UNIT, 'bruno-petstore.json'), 'utf-8'),
    filePath: 'bruno-petstore.json'
  },
  asyncapi: {
    content: readFileSync(join(UNIT, 'asyncapi-petstore.yaml'), 'utf-8')
  },
  odata: {
    // JSON-CSDL (v4) — top-level $Version discriminator
    content: readFileSync(join(FIXTURES, 'odata', 'v4-csdl.json'), 'utf-8')
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
  }
}

describe('import provider registry', () => {
  beforeAll(() => {
    // Guard: the registry must be populated before any assertion.
    expect(importProviders.length).toBeGreaterThan(0)
  })

  it('has at least 13 registered providers (12 service files = 13 format entries)', () => {
    expect(importProviders.length).toBeGreaterThanOrEqual(13)
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
