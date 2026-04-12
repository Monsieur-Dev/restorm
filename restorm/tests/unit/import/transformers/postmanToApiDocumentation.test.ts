import { describe, it, expect } from 'vitest'
import { postmanToApiDocumentation, type PostmanCollectionData } from '../../../../src/main/services/import/transformers/postmanToApiDocumentation'

const collection: PostmanCollectionData = {
  info: {
    name: 'Petstore',
    description: { content: 'Sample Postman collection', type: 'text/markdown' }
  },
  item: [
    {
      name: 'pet',
      description: 'Pet operations',
      item: [
        {
          name: 'Find pet by ID',
          request: {
            method: 'GET',
            url: { raw: 'https://api.example.com/pet/{{petId}}', host: ['api', 'example', 'com'], path: ['pet', '{{petId}}'] },
            description: 'Returns a pet by id'
          },
          response: [
            { name: 'ok', status: 'OK', code: 200, body: '{ "id": 1 }' }
          ],
          event: [
            { listen: 'prerequest', script: { exec: ["pm.environment.set('petId', '1')"], type: 'text/javascript' } },
            { listen: 'test', script: { exec: ['pm.test("status 200", () => pm.response.to.have.status(200))'] } }
          ]
        },
        {
          name: 'Add pet',
          request: {
            method: 'POST',
            url: 'https://api.example.com/pet',
            auth: {
              type: 'apikey',
              apikey: [
                { key: 'key', value: 'api_key' },
                { key: 'value', value: 'SECRET123' },
                { key: 'in', value: 'header' }
              ]
            }
          }
        }
      ]
    },
    {
      name: 'ping',
      request: { method: 'GET', url: 'https://api.example.com/ping' }
    }
  ]
}

describe('postmanToApiDocumentation', () => {
  it('maps collection info to api.title / description', () => {
    const doc = postmanToApiDocumentation(collection)
    expect(doc.sourceType).toBe('postman')
    expect(doc.api.title).toBe('Petstore')
    expect(doc.api.description).toBe('Sample Postman collection')
  })

  it('creates one group per top-level folder with its description', () => {
    const doc = postmanToApiDocumentation(collection)
    expect(doc.groups.pet).toEqual({ name: 'pet', description: 'Pet operations' })
  })

  it('maps leaf items to operations with method + url + group', () => {
    const doc = postmanToApiDocumentation(collection)
    const find = doc.operations.find((op) => op.summary === 'Find pet by ID')
    expect(find?.match).toEqual({ urlPattern: 'https://api.example.com/pet/{{petId}}', method: 'GET' })
    expect(find?.group).toBe('pet')
    expect(find?.description).toBe('Returns a pet by id')
  })

  it('includes a flat leaf (no folder) without a group', () => {
    const doc = postmanToApiDocumentation(collection)
    const ping = doc.operations.find((op) => op.summary === 'ping')
    expect(ping?.group).toBeUndefined()
    expect(ping?.match.method).toBe('GET')
  })

  it('preserves auth in extra.auth, masking sensitive values', () => {
    const doc = postmanToApiDocumentation(collection)
    const add = doc.operations.find((op) => op.summary === 'Add pet')
    const auth = add?.extra?.auth as { type: string; params?: Record<string, unknown> } | undefined
    expect(auth?.type).toBe('apikey')
    expect(auth?.params?.key).toBe('api_key')
    expect(auth?.params?.value).toBe('***')
    expect(auth?.params?.in).toBe('header')
  })

  it('preserves pre-request and test scripts in extra', () => {
    const doc = postmanToApiDocumentation(collection)
    const find = doc.operations.find((op) => op.summary === 'Find pet by ID')
    const pre = find?.extra?.prereqScript as { type: string; code: string } | undefined
    const test = find?.extra?.testScript as { type: string; code: string } | undefined
    expect(pre?.code).toContain("pm.environment.set('petId', '1')")
    expect(test?.code).toContain('pm.response.to.have.status(200)')
  })

  it('records example responses', () => {
    const doc = postmanToApiDocumentation(collection)
    const find = doc.operations.find((op) => op.summary === 'Find pet by ID')
    expect(find?.responses?.ok?.description).toContain('status 200')
  })

  it('echoes sourceUrl when provided', () => {
    const doc = postmanToApiDocumentation(collection, { sourceUrl: 'https://example.com/collection.json' })
    expect(doc.sourceUrl).toBe('https://example.com/collection.json')
  })
})
