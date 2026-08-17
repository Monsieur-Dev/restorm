import { describe, it, expect } from 'vitest'
import { apiDocumentationToOpenApi, restormPathToSpec } from '../../src/shared/design/openApiExport'
import {
  openapi3ToApiDocumentation,
  type OAS3Spec
} from '../../src/main/services/import/transformers/openapi3ToApiDocumentation'
import { designToApiDocumentation } from '../../src/shared/design/apiDesignDoc'
import { buildReferenceApiDesign } from './apiDesignReference'

// A compact Petstore-shaped spec exercising every emitter mapping the
// importer can read back: $refs, arrays of refs, enum components, xml
// hints, multi-content-type bodies/responses, response headers, path
// parameters with constraints, oauth2 flows and apiKey security.
function buildPetstoreSpec(): OAS3Spec {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Petstore',
      version: '1.0.7',
      description: 'A sample pet store.',
      termsOfService: 'https://example.com/terms',
      contact: { email: 'apiteam@example.com' },
      license: { name: 'Apache 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0.html' }
    },
    externalDocs: { description: 'Find out more', url: 'https://example.com' },
    servers: [{ url: 'https://petstore.example.com/v2' }],
    tags: [
      { name: 'pet', description: 'Everything about your Pets', externalDocs: { url: 'https://example.com/pets' } }
    ],
    security: [{ api_key: [] }],
    paths: {
      '/pet': {
        post: {
          tags: ['pet'],
          summary: 'Add a new pet to the store',
          operationId: 'addPet',
          requestBody: {
            description: 'Pet object to add',
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
              'application/xml': { schema: { $ref: '#/components/schemas/Pet' } }
            }
          },
          responses: {
            '200': {
              description: 'successful operation',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
                'application/xml': { schema: { $ref: '#/components/schemas/Pet' } }
              }
            },
            '405': { description: 'Invalid input' }
          },
          security: [{ petstore_auth: ['write:pets', 'read:pets'] }]
        }
      },
      '/pet/{petId}': {
        get: {
          tags: ['pet'],
          summary: 'Find pet by ID',
          operationId: 'getPetById',
          deprecated: true,
          parameters: [
            {
              name: 'petId',
              in: 'path',
              description: 'ID of pet to return',
              required: true,
              schema: { type: 'integer', format: 'int64', minimum: 1 },
              example: 7
            }
          ],
          responses: {
            '200': {
              description: 'successful operation',
              headers: {
                'X-Rate-Limit': { description: 'calls per hour', schema: { type: 'integer' } }
              },
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } }
            },
            '404': { description: 'Pet not found' }
          }
        }
      },
      '/pet/findByStatus': {
        get: {
          tags: ['pet'],
          summary: 'Finds Pets by status',
          operationId: 'findPetsByStatus',
          parameters: [
            {
              name: 'status',
              in: 'query',
              required: true,
              schema: { type: 'string', enum: ['available', 'pending', 'sold'] }
            }
          ],
          responses: {
            '200': {
              description: 'successful operation',
              content: {
                'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } } }
              }
            }
          }
        }
      }
    },
    components: {
      schemas: {
        Category: {
          type: 'object',
          properties: {
            id: { type: 'integer', format: 'int64' },
            name: { type: 'string' }
          },
          xml: { name: 'Category' }
        },
        PetStatus: {
          type: 'string',
          description: 'pet status in the store',
          enum: ['available', 'pending', 'sold']
        },
        Pet: {
          type: 'object',
          required: ['name', 'photoUrls'],
          description: 'A pet for sale.',
          properties: {
            id: { type: 'integer', format: 'int64', readOnly: true },
            category: { $ref: '#/components/schemas/Category' },
            name: { type: 'string', example: 'doggie', minLength: 1, maxLength: 64 },
            photoUrls: {
              type: 'array',
              items: { type: 'string' },
              xml: { wrapped: true }
            },
            friends: {
              type: 'array',
              items: { $ref: '#/components/schemas/Pet' },
              xml: { wrapped: true }
            },
            status: { $ref: '#/components/schemas/PetStatus' }
          },
          xml: { name: 'Pet' }
        }
      },
      securitySchemes: {
        api_key: { type: 'apiKey', name: 'api_key', in: 'header', description: 'Store API key' },
        petstore_auth: {
          type: 'oauth2',
          flows: {
            implicit: {
              authorizationUrl: 'https://petstore.example.com/oauth/authorize',
              scopes: { 'write:pets': 'modify pets', 'read:pets': 'read pets' }
            },
            clientCredentials: {
              tokenUrl: 'https://petstore.example.com/oauth/token',
              scopes: {}
            }
          }
        }
      }
    }
  }
}

describe('openApiExport', () => {
  it('converts Restorm double-brace paths to spec spelling, leaving spec paths alone', () => {
    expect(restormPathToSpec('/pets/{{petId}}/photos/{{photoId}}')).toBe('/pets/{petId}/photos/{photoId}')
    expect(restormPathToSpec('/pets/{petId}')).toBe('/pets/{petId}')
    expect(restormPathToSpec('/plain')).toBe('/plain')
  })

  // THE contract: emit is the importer's inverse. Whatever survives the
  // import must survive emit → re-import unchanged — this is the same
  // loop the final validation ticket runs against the live server.
  it('round-trips a petstore-shaped documentation through emit + re-import', () => {
    const original = openapi3ToApiDocumentation(buildPetstoreSpec())
    const emitted = apiDocumentationToOpenApi(original)
    const reimported = openapi3ToApiDocumentation(emitted as unknown as OAS3Spec)
    expect(reimported).toEqual(original)
  })

  // The UI only exposes a BASE PATH field — a hostless design's server
  // block is `{ basePath }` and the emitter must still open the
  // `servers` channel (relative url), or a re-import loses the prefix.
  it('round-trips a hostless base path through a relative server url', () => {
    const original = openapi3ToApiDocumentation(buildPetstoreSpec())
    delete original.server
    original.server = { basePath: '/api/v1' }
    const emitted = apiDocumentationToOpenApi(original) as { servers?: { url: string }[] }
    expect(emitted.servers).toEqual([{ url: '/api/v1' }])
    const reimported = openapi3ToApiDocumentation(emitted as unknown as OAS3Spec)
    expect(reimported.server).toEqual({ basePath: '/api/v1' })
  })

  it('leaves a protocol-relative server url unparsed (not a base path)', () => {
    const spec = buildPetstoreSpec()
    spec.servers = [{ url: '//api.example.com/v2' }]
    const doc = openapi3ToApiDocumentation(spec)
    expect(doc.server).toBeUndefined()
  })

  it('emits oauth2 flows back under the OAS3 flow keys', () => {
    const doc = openapi3ToApiDocumentation(buildPetstoreSpec())
    const emitted = apiDocumentationToOpenApi(doc) as {
      components: { securitySchemes: Record<string, { flows?: Record<string, unknown> }> }
    }
    expect(Object.keys(emitted.components.securitySchemes['petstore_auth']?.flows ?? {}))
      .toEqual(['implicit', 'clientCredentials'])
  })

  it('emits one content entry per consumed/produced media type', () => {
    const doc = openapi3ToApiDocumentation(buildPetstoreSpec())
    const emitted = apiDocumentationToOpenApi(doc) as {
      paths: Record<string, { post?: { requestBody: { content: Record<string, unknown> } } }>
    }
    expect(Object.keys(emitted.paths['/pet']?.post?.requestBody.content ?? {}))
      .toEqual(['application/json', 'application/xml'])
  })

  it('serves a design projection as an importable spec', () => {
    const design = buildReferenceApiDesign()
    const doc = designToApiDocumentation(design)
    const emitted = apiDocumentationToOpenApi(doc)
    const paths = emitted['paths'] as Record<string, unknown>
    expect(Object.keys(paths)).toEqual(['/v1/users/{id}', '/v1/users'])
    const reimported = openapi3ToApiDocumentation(emitted as unknown as OAS3Spec)
    expect(reimported.api.title).toBe('Petstore')
    expect(Object.keys(reimported.models)).toContain('User')
    const getUser = reimported.operations.find((op) => op.operationId === 'getUser')
    expect(getUser?.match.urlPattern).toBe('/v1/users/{id}')
    expect(getUser?.parameters?.[0]?.name).toBe('id')
  })
})
