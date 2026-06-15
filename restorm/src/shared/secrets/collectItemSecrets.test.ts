import { describe, it, expect } from 'vitest'
import { collectItemDirectSecrets, collectItemReferencedVars } from './collectItemSecrets'
import { SecretValue } from '../types/valueTypes/SecretValue'
import { StringValue } from '../types/valueTypes/StringValue'
import { ExpressionValue } from '../types/valueTypes/ExpressionValue'
import type { FolderItem } from '../types/folderTypes'

const secret = (source: string, params: Record<string, unknown>): SecretValue => new SecretValue(source, params)

describe('collectItemDirectSecrets', () => {
  it('collects secrets from an HTTP request across headers / params / body fields', () => {
    const request = {
      type: 'http',
      id: 'r1',
      name: 'r',
      method: 'GET',
      url: '',
      headers: [
        { key: 'X-Api-Key', enabled: true, value: secret('envVar', { name: 'API_KEY' }) },
        { key: 'Accept', enabled: true, value: new StringValue('application/json') }
      ],
      params: [{ key: 'token', enabled: true, value: secret('someProvider', { value: 'v' }) }],
      body: { type: 'form-data', fields: [{ key: 'pwd', enabled: true, value: secret('envFileSecret', { key: 'a/b' }) }] }
    } as unknown as FolderItem

    const found = collectItemDirectSecrets(request)
    expect(found).toHaveLength(3)
    expect(found.map((s) => s.source).sort()).toEqual(['envFileSecret', 'envVar', 'someProvider'])
  })

  it('collects secrets from scenario node configs but NOT from the scenario child items', () => {
    const childRequestSecret = secret('envVar', { name: 'CHILD' })
    const scenario = {
      type: 'scenario',
      id: 's1',
      name: 's',
      tags: [],
      params: [],
      edges: [],
      nodes: [
        { id: 'n1', kind: 'if', config: { left: secret('envVar', { name: 'NODE_A' }), operator: '==' }, inputs: [], outputs: [], position: { x: 0, y: 0 } },
        { id: 'n2', kind: 'log', config: { data: new StringValue('hi') }, inputs: [], outputs: [], position: { x: 0, y: 0 } }
      ],
      // A child request that itself holds a secret — must NOT be collected here
      // (it is a separate tree item with its own status).
      items: [
        { type: 'http', id: 'child', name: 'c', method: 'GET', url: '', headers: [{ key: 'h', enabled: true, value: childRequestSecret }], params: [] }
      ]
    } as unknown as FolderItem

    const found = collectItemDirectSecrets(scenario)
    expect(found).toHaveLength(1)
    expect(found[0]?.params).toEqual({ name: 'NODE_A' })
  })

  it('returns nothing for a request with no secrets', () => {
    const request = {
      type: 'http', id: 'r', name: 'r', method: 'GET', url: '',
      headers: [{ key: 'Accept', enabled: true, value: new StringValue('*/*') }], params: []
    } as unknown as FolderItem
    expect(collectItemDirectSecrets(request)).toEqual([])
  })

  it('returns nothing for a plain folder', () => {
    const folder = { id: 'f', name: 'f', items: [] } as unknown as FolderItem
    expect(collectItemDirectSecrets(folder)).toEqual([])
  })

  it('counts {{vars}} from the url + expression values, NOT from literal string values', () => {
    const request = {
      type: 'http', id: 'r', name: 'r', method: 'GET', url: '{{baseUrl}}/echo',
      headers: [
        // A StringValue is literal — `{{apiKey}}` here is plain text, NOT a use.
        { key: 'X-Env-Api-Key', enabled: true, value: new StringValue('{{apiKey}}') },
        // An ExpressionValue actually resolves — `{{token}}` IS a reference.
        { key: 'X-Tok', enabled: true, value: new ExpressionValue('{{token}}') }
      ],
      params: []
    } as unknown as FolderItem
    const refs = collectItemReferencedVars(request)
    expect(refs.has('baseUrl')).toBe(true)   // bare url string is resolved
    expect(refs.has('token')).toBe(true)     // expression value
    expect(refs.has('apiKey')).toBe(false)   // literal string value — not a reference
  })

  it('counts scenario node EXPRESSION operands but not literal string operands', () => {
    const scenario = {
      type: 'scenario', id: 's', name: 's', tags: [], params: [], edges: [],
      nodes: [{
        id: 'n', kind: 'if',
        config: { left: new ExpressionValue('{{token}}'), right: new StringValue('{{literalOnly}}'), operator: '==' },
        inputs: [], outputs: [], position: { x: 0, y: 0 }
      }],
      items: [{ type: 'http', id: 'c', name: 'c', method: 'GET', url: '{{childOnly}}', headers: [], params: [] }]
    } as unknown as FolderItem
    const refs = collectItemReferencedVars(scenario)
    expect(refs.has('token')).toBe(true)
    expect(refs.has('literalOnly')).toBe(false)
    expect(refs.has('childOnly')).toBe(false)
  })

  it('matches the plain (deserialized) secret shape, not only class instances', () => {
    const request = {
      type: 'http', id: 'r', name: 'r', method: 'GET', url: '',
      headers: [{ key: 'X', enabled: true, value: { type: 'secret', source: 'envVar', params: { name: 'PLAIN' } } }],
      params: []
    } as unknown as FolderItem
    const found = collectItemDirectSecrets(request)
    expect(found).toHaveLength(1)
    expect(found[0]?.source).toBe('envVar')
  })
})
