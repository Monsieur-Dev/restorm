import { describe, it, expect } from 'vitest'
import { deduceRoutes } from '../../src/shared/recording/routeDeduction'
import { materializeDeducedTree } from '../../src/shared/recording/deducedItems'
import type { CaptureSummary } from '../../src/shared/recording/routeDeduction'
import type { RecordedCallDetail } from '../../src/shared/types/recordingCapture'
import type { FolderItem, HTTPRequest, Folder } from '../../src/shared/types/collections'
import { isAnyFolder, isRequest } from '../../src/shared/types/collections'

let clock = 0
function call(method: string, url: string, status = 200): CaptureSummary {
  clock += 10
  return { id: `c${clock}`, protocol: 'http', timestamp: clock, method, url, status }
}
function detail(summary: CaptureSummary, body: string | null = null): RecordedCallDetail {
  return {
    ...summary, sessionId: 's1', runId: 'r1', resourceType: 'fetch',
    request: {
      headers: [{ key: 'Accept', value: 'application/json' }, { key: 'Host', value: 'localhost:8080' }, { key: 'content-length', value: '3' }, { key: 'cookie', value: 'sid=1' }],
      query: [],
      body: body === null ? null : { encoding: 'utf8', data: body, mimeType: 'application/json', size: body.length }
    },
    response: { headers: [], body: null }
  }
}
let ids = 0
const newId = (): string => `id-${++ids}`

function requestsIn(items: readonly FolderItem[]): HTTPRequest[] {
  return items.flatMap((item) => (isAnyFolder(item) ? requestsIn(item.items) : isRequest(item) && item.type === 'http' ? [item] : []))
}

describe('materializeDeducedTree — deduced routes as real tree items', () => {
  const captures = [
    call('GET', 'http://localhost:8080/api/pets?limit=2'),
    call('GET', 'http://localhost:8080/api/pets/1'),
    call('GET', 'http://localhost:8080/api/pets/2'),
    call('POST', 'http://localhost:8080/api/pets', 201)
  ]
  const post = captures[3]
  if (post === undefined) throw new Error('fixture')
  const references = new Map<string, RecordedCallDetail>([[post.id, detail(post, '{"name":"Rex"}')]])

  it('builds folders per static prefix and prefilled requests from the last successful call', () => {
    const tree = deduceRoutes(captures)
    const result = materializeDeducedTree(tree, references, undefined, newId)
    expect(result.summary).toEqual({ routes: 3, newRoutes: 3, folders: 2 })
    const api = result.items[0] as Folder
    expect(isAnyFolder(api) && api.name).toBe('api')
    const pets = api.items[0] as Folder
    expect(pets.name).toBe('pets')
    const requests = requestsIn(result.items)
    expect(requests.map((r) => r.name).sort()).toEqual(['GET /api/pets', 'GET /api/pets/{{petId}}', 'POST /api/pets'])
    const byId = requests.find((r) => r.name === 'GET /api/pets/{{petId}}')
    expect(byId?.url).toBe('http://localhost:8080/api/pets/{{petId}}')
    expect(byId?.pathParams?.[0]?.key).toBe('petId')
    const list = requests.find((r) => r.name === 'GET /api/pets')
    expect(list?.params[0]?.key).toBe('limit')
    const created = requests.find((r) => r.name === 'POST /api/pets')
    expect(created?.body).toEqual({ type: 'text', content: '{"name":"Rex"}' })
    // Wire-level headers never replay; the meaningful ones do.
    expect(created?.headers.map((h) => h.key)).toEqual(['Accept', 'cookie'])
    // One brand-new top-level folder carries the whole subtree.
    expect(result.created.map((c) => [c.parentId, (c.item as Folder).name])).toEqual([[null, 'api']])
    expect(result.history.map((h) => h.protocol)).toEqual(['http', 'http', 'http'])
    expect(result.history.find((h) => h.requestId === created?.id)?.referenceCaptureId).toBe(post.id)
  })

  it('a second deduction keeps the edited requests and adds only the new routes', () => {
    const first = materializeDeducedTree(deduceRoutes(captures), references, undefined, newId)
    const edited = requestsIn(first.items).find((r) => r.name === 'GET /api/pets')
    if (edited === undefined) throw new Error('fixture')
    edited.name = 'List the pets'
    edited.headers.push({ key: 'X-Debug', value: '1' } as HTTPRequest['headers'][number])
    const more = [...captures, call('DELETE', 'http://localhost:8080/api/pets/1', 204)]
    const second = materializeDeducedTree(deduceRoutes(more), references, first.items, newId)
    expect(second.summary).toEqual({ routes: 4, newRoutes: 1, folders: 0 })
    const again = requestsIn(second.items).find((r) => r.url === 'http://localhost:8080/api/pets' && r.method === 'GET')
    expect(again?.name).toBe('List the pets')
    expect(again?.headers.some((h) => h.key === 'X-Debug')).toBe(true)
    expect(requestsIn(second.items).some((r) => r.method === 'DELETE')).toBe(true)
    // The new request went into the EXISTING pets folder — announced on its own, under that folder.
    const pets = (first.items[0] as Folder).items[0] as Folder
    expect(second.created.map((c) => [c.parentId, isRequest(c.item) ? c.item.name : ''])).toEqual([[pets.id, 'DELETE /api/pets/{{petId}}']])
    expect(second.history).toHaveLength(1)
  })

  it('applies the wrap hook to every inserted node before it lands in the tree', () => {
    const seen: string[] = []
    const result = materializeDeducedTree(deduceRoutes(captures), references, undefined, newId, (item, parentId) => {
      seen.push(`${parentId ?? 'root'}:${isAnyFolder(item) ? 'folder' : 'request'}`)
      return item
    })
    expect(seen).toEqual(['root:folder'])
    expect(result.created).toHaveLength(1)
  })

  it('a GraphQL route becomes a GraphQL request with its operation', () => {
    const gql: CaptureSummary = { id: 'g1', protocol: 'graphql', timestamp: 1, method: 'POST', url: 'http://localhost:8080/graphql', status: 200, graphql: { operationType: 'query', operationName: 'Pets' } }
    const body = JSON.stringify({ query: 'query Pets($n: Int) { pets(first: $n) { id } }', variables: { n: 2 }, operationName: 'Pets' })
    const result = materializeDeducedTree(deduceRoutes([gql]), new Map([[gql.id, detail(gql, body)]]), undefined, newId)
    const [request] = result.items
    expect(request && isRequest(request) && request.type === 'graphql' ? { query: request.query, name: request.operationName, vars: request.variables } : null)
      .toEqual({ query: 'query Pets($n: Int) { pets(first: $n) { id } }', name: 'Pets', vars: JSON.stringify({ n: 2 }, null, 2) })
  })
})
