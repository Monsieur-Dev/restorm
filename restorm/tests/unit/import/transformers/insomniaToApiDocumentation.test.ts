import { describe, it, expect } from 'vitest'
import { insomniaToApiDocumentation, type InsomniaExportData } from '../../../../src/main/services/import/transformers/insomniaToApiDocumentation'

const exportData: InsomniaExportData = {
  _type: 'export',
  resources: [
    { _id: 'ws1', _type: 'workspace', name: 'My Workspace', description: 'Demo workspace', parentId: null },
    { _id: 'g1', _type: 'request_group', name: 'Pets', description: 'Pet operations', parentId: 'ws1' },
    { _id: 'r1', _type: 'request', name: 'Get Pet', description: 'Fetch by id', parentId: 'g1', method: 'get', url: 'https://example.com/pet/{{petId}}' },
    {
      _id: 'r2', _type: 'request', name: 'Login', parentId: 'ws1', method: 'post', url: 'https://example.com/login',
      authentication: { type: 'basic', username: 'admin', password: 'p@ssword' }
    },
    { _id: 'gr1', _type: 'grpc_request', name: 'GetUser', parentId: 'g1', protoMethodName: 'GetUser', url: 'grpc://example.com:50051' },
    { _id: 'ws2', _type: 'websocket_request', name: 'Chat', parentId: 'ws1', url: 'wss://example.com/chat', authentication: { type: 'bearer', token: 'SECRET' } }
  ]
}

describe('insomniaToApiDocumentation', () => {
  it('takes title/description from the workspace', () => {
    const doc = insomniaToApiDocumentation(exportData)
    expect(doc.sourceType).toBe('insomnia')
    expect(doc.api.title).toBe('My Workspace')
    expect(doc.api.description).toBe('Demo workspace')
  })

  it('creates groups for top-level request_groups only', () => {
    const doc = insomniaToApiDocumentation(exportData)
    expect(doc.groups.Pets).toEqual({ name: 'Pets', description: 'Pet operations' })
  })

  it('maps requests with method + url + group', () => {
    const doc = insomniaToApiDocumentation(exportData)
    const getPet = doc.operations.find((op) => op.summary === 'Get Pet')
    expect(getPet?.match).toEqual({ urlPattern: 'https://example.com/pet/{{petId}}', method: 'GET' })
    expect(getPet?.group).toBe('Pets')
    expect(getPet?.description).toBe('Fetch by id')
  })

  it('surfaces requests at workspace root without a group', () => {
    const doc = insomniaToApiDocumentation(exportData)
    const login = doc.operations.find((op) => op.summary === 'Login')
    expect(login?.group).toBeUndefined()
    expect(login?.match.method).toBe('POST')
  })

  it('maps grpc_request with operationName via protoMethodName', () => {
    const doc = insomniaToApiDocumentation(exportData)
    const grpc = doc.operations.find((op) => op.summary === 'GetUser')
    expect(grpc?.match).toEqual({ urlPattern: 'grpc://example.com:50051', operationName: 'GetUser' })
  })

  it('maps websocket_request via url only, no method', () => {
    const doc = insomniaToApiDocumentation(exportData)
    const ws = doc.operations.find((op) => op.summary === 'Chat')
    expect(ws?.match).toEqual({ urlPattern: 'wss://example.com/chat' })
  })

  it('preserves auth in extra.auth, masking sensitive fields', () => {
    const doc = insomniaToApiDocumentation(exportData)
    const login = doc.operations.find((op) => op.summary === 'Login')
    const auth = login?.extra?.auth as Record<string, unknown> | undefined
    expect(auth).toEqual({ type: 'basic', username: 'admin', password: '***' })

    const ws = doc.operations.find((op) => op.summary === 'Chat')
    const wsAuth = ws?.extra?.auth as Record<string, unknown> | undefined
    expect(wsAuth).toEqual({ type: 'bearer', token: '***' })
  })

  it('echoes sourceUrl when provided', () => {
    const doc = insomniaToApiDocumentation(exportData, { sourceUrl: 'https://example.com/insomnia.json' })
    expect(doc.sourceUrl).toBe('https://example.com/insomnia.json')
  })
})
