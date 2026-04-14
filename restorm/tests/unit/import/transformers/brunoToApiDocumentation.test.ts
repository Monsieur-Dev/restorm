import { describe, it, expect } from 'vitest'
import { brunoToApiDocumentation, type BrunoSourceData } from '../../../../src/main/services/import/transformers/brunoToApiDocumentation'

const data: BrunoSourceData = {
  collection: { name: 'Petstore BRU', version: '1' },
  requests: [
    {
      path: 'pet/GetPet.bru',
      request: {
        meta: { name: 'Get Pet', seq: 1 },
        method: 'get',
        url: 'https://example.com/pet/{{petId}}',
        auth: { type: 'none' },
        docs: 'Fetch a pet by id',
        script: { prerequest: "bru.setEnvVar('petId', '1')" }
      }
    },
    {
      path: 'pet/CreatePet.bru',
      request: {
        meta: { name: 'Create Pet', seq: 2 },
        method: 'post',
        url: 'https://example.com/pet',
        auth: { type: 'bearer', bearer: { token: 'SECRET' } }
      }
    },
    {
      path: 'Ping.bru',
      request: {
        meta: { name: 'Ping' },
        method: 'get',
        url: 'https://example.com/ping',
        auth: { type: 'none' }
      }
    }
  ]
}

describe('brunoToApiDocumentation', () => {
  it('uses collection name as title', () => {
    const doc = brunoToApiDocumentation(data)
    expect(doc.sourceType).toBe('bruno')
    expect(doc.api.title).toBe('Petstore BRU')
  })

  it('creates a group per top-level directory, none for root-level files', () => {
    const doc = brunoToApiDocumentation(data)
    expect(doc.groups.pet).toEqual({ name: 'pet' })
    expect(Object.keys(doc.groups)).toEqual(['pet'])
  })

  it('maps each .bru file to an operation with method + url + group', () => {
    const doc = brunoToApiDocumentation(data)
    const get = doc.operations.find((op) => op.summary === 'Get Pet')
    expect(get?.match).toEqual({ urlPattern: 'https://example.com/pet/{{petId}}', method: 'GET' })
    expect(get?.group).toBe('pet')
    expect(get?.description).toBe('Fetch a pet by id')

    const ping = doc.operations.find((op) => op.summary === 'Ping')
    expect(ping?.group).toBeUndefined()
  })

  it('records prereq script in extra when non-empty', () => {
    const doc = brunoToApiDocumentation(data)
    const get = doc.operations.find((op) => op.summary === 'Get Pet')
    const pre = get?.extra?.prereqScript as { code: string } | undefined
    expect(pre?.code).toContain('bru.setEnvVar')
  })

  it('masks sensitive auth fields in extra', () => {
    const doc = brunoToApiDocumentation(data)
    const create = doc.operations.find((op) => op.summary === 'Create Pet')
    const auth = create?.extra?.auth as { type: string; params?: Record<string, unknown> } | undefined
    expect(auth?.type).toBe('bearer')
    expect(auth?.params?.token).toBe('***')
  })

  it('omits auth extra when type is none', () => {
    const doc = brunoToApiDocumentation(data)
    const get = doc.operations.find((op) => op.summary === 'Get Pet')
    expect(get?.extra?.auth).toBeUndefined()
  })

  it('falls back to options.name when collection has no name', () => {
    const doc = brunoToApiDocumentation({ requests: [] }, { name: 'Fallback' })
    expect(doc.api.title).toBe('Fallback')
  })

  it('echoes sourceUrl when provided', () => {
    const doc = brunoToApiDocumentation(data, { sourceUrl: 'file:///bruno' })
    expect(doc.sourceUrl).toBe('file:///bruno')
  })
})
