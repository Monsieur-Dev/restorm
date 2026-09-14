import { describe, it, expect } from 'vitest'
import { deduceRoutes, flattenRoutes, classifySegment, paramNameFor, type CaptureSummary, type DeducedTree, type DeducedFolder } from '../../src/shared/recording/routeDeduction'

function must<T>(value: T | undefined, what = 'value'): T {
  if (value === undefined) throw new Error(`expected a ${what}`)
  return value
}

let clock = 1_000
function http(method: string, url: string, status = 200, extra: Partial<CaptureSummary> = {}): CaptureSummary {
  clock += 10
  return { id: `c${clock}`, protocol: 'http', timestamp: clock, method, url, status, ...extra }
}

function templates(tree: DeducedTree): string[] {
  return flattenRoutes(tree).map((r) => `${r.method} ${r.template}`).sort()
}

function folderPaths(folder: DeducedFolder | DeducedTree, prefix: string[] = []): string[] {
  const out: string[] = []
  for (const f of folder.folders) {
    const path = [...prefix, f.name]
    out.push(path.join('/'))
    out.push(...folderPaths(f, path))
  }
  return out.sort()
}

describe('route deduction — a REST resource with nested ids', () => {
  const captures = [
    http('GET', 'http://localhost:8080/api/users'),
    http('POST', 'http://localhost:8080/api/users', 201),
    http('GET', 'http://localhost:8080/api/users/1'),
    http('GET', 'http://localhost:8080/api/users/2'),
    http('PUT', 'http://localhost:8080/api/users/2', 500),
    http('PUT', 'http://localhost:8080/api/users/1'),
    http('GET', 'http://localhost:8080/api/users/1/posts'),
    http('GET', 'http://localhost:8080/api/users/1/posts/10'),
    http('GET', 'http://localhost:8080/api/users/2/posts/11', 404)
  ]
  const tree = deduceRoutes(captures)

  it('tells the parameter segments from the fixed ones', () => {
    expect(templates(tree)).toEqual([
      'GET /api/users',
      'GET /api/users/{{userId}}',
      'GET /api/users/{{userId}}/posts',
      'GET /api/users/{{userId}}/posts/{{postId}}',
      'POST /api/users',
      'PUT /api/users/{{userId}}'
    ])
  })

  it('nests folders per static prefix — parameters and lone leaves create no folder', () => {
    expect(folderPaths(tree)).toEqual(['api', 'api/users', 'api/users/posts'])
    const posts = must(must(must(tree.folders[0]).folders[0]).folders[0])
    expect(posts.routes.map((r) => r.template).sort()).toEqual(['/api/users/{{userId}}/posts', '/api/users/{{userId}}/posts/{{postId}}'])
  })

  it('collects the observed values of each path parameter and the last successful one', () => {
    const put = must(flattenRoutes(tree).find((r) => r.method === 'PUT'))
    expect(put.pathParams).toEqual([{ name: 'userId', samples: ['2', '1'], lastSuccessValue: '1' }])
    expect(put.captureIds).toHaveLength(2)
    // The 500 came first, the 200 last — the prefill is the successful one.
    expect(put.lastSuccessCaptureId).toBe(must(captures[5]).id)
  })

  it('falls back to the most recent capture when none succeeded', () => {
    const nested = must(flattenRoutes(tree).find((r) => r.template === '/api/users/{{userId}}/posts/{{postId}}'))
    expect(nested.captureIds).toHaveLength(2)
    expect(nested.lastSuccessCaptureId).toBe(must(captures[7]).id)
  })

  it('spells the url with handlebars placeholders and a stable key', () => {
    const get = must(flattenRoutes(tree).find((r) => r.method === 'GET' && r.template === '/api/users/{{userId}}'))
    expect(get.url).toBe('http://localhost:8080/api/users/{{userId}}')
    expect(get.key).toBe('http|GET|http://localhost:8080/api/users/{{userId}}')
    expect(get.name).toBe('GET /api/users/{{userId}}')
    expect(deduceRoutes(captures)).toEqual(tree)
  })
})

describe('route deduction — a route is not a parameter', () => {
  it('keeps two bare sibling resources apart', () => {
    const tree = deduceRoutes([
      http('GET', 'http://api.test/api/users'),
      http('GET', 'http://api.test/api/posts'),
      http('GET', 'http://api.test/api/comments')
    ])
    expect(templates(tree)).toEqual(['GET /api/comments', 'GET /api/posts', 'GET /api/users'])
    // Three lone leaves under one prefix: one folder, three requests in it.
    expect(folderPaths(tree)).toEqual(['api'])
    expect(must(tree.folders[0]).routes).toHaveLength(3)
  })

  it('a segment hosting several methods opens a folder even without sub-routes', () => {
    const tree = deduceRoutes([http('GET', 'http://api.test/api/users'), http('POST', 'http://api.test/api/users', 201)])
    expect(folderPaths(tree)).toEqual(['api', 'api/users'])
  })

  it('keeps a conventional static word next to identifiers', () => {
    const tree = deduceRoutes([
      http('GET', 'http://api.test/users/me'),
      http('GET', 'http://api.test/users/42'),
      http('GET', 'http://api.test/users/43')
    ])
    expect(templates(tree)).toEqual(['GET /users/me', 'GET /users/{{userId}}'])
  })

  it('collapses plain words only when enough siblings share a non-trivial shape', () => {
    const alike = deduceRoutes([
      http('GET', 'http://api.test/users/john/posts'),
      http('GET', 'http://api.test/users/mary/posts')
    ])
    expect(templates(alike)).toEqual(['GET /users/{{userId}}/posts'])
    const bareLeaves = deduceRoutes([
      http('GET', 'http://api.test/users/john'),
      http('GET', 'http://api.test/users/mary')
    ])
    expect(templates(bareLeaves)).toEqual(['GET /users/john', 'GET /users/mary'])
    const differentShapes = deduceRoutes([
      http('GET', 'http://api.test/users/john/posts'),
      http('GET', 'http://api.test/users/mary/comments')
    ])
    expect(templates(differentShapes)).toEqual(['GET /users/john/posts', 'GET /users/mary/comments'])
  })

  it('never collapses the top-level segments on word similarity', () => {
    const tree = deduceRoutes([
      http('GET', 'http://api.test/users/1'),
      http('GET', 'http://api.test/posts/1')
    ])
    expect(templates(tree)).toEqual(['GET /posts/{{postId}}', 'GET /users/{{userId}}'])
  })
})

describe('route deduction — identifier shapes and thresholds', () => {
  it('classifies segments', () => {
    expect(classifySegment('42')).toBe('strong-id')
    expect(classifySegment('3fa85f64-5717-4562-b3fc-2c963f66afa6')).toBe('strong-id')
    expect(classifySegment('507f1f77bcf86cd799439011')).toBe('strong-id')
    expect(classifySegment('user42')).toBe('weak-id')
    expect(classifySegment('john.doe@example.com')).toBe('weak-id')
    expect(classifySegment('users')).toBe('word')
    expect(classifySegment('me')).toBe('word')
    expect(classifySegment('v1')).toBe('weak-id')
  })

  it('a single UUID is a parameter on its own', () => {
    const tree = deduceRoutes([http('GET', 'http://api.test/orders/3fa85f64-5717-4562-b3fc-2c963f66afa6/items')])
    expect(templates(tree)).toEqual(['GET /orders/{{orderId}}/items'])
    expect(must(must(flattenRoutes(tree)[0]).pathParams[0]).samples).toEqual(['3fa85f64-5717-4562-b3fc-2c963f66afa6'])
  })

  it('collapseSingletonIds: false needs the threshold even for strong identifiers', () => {
    const one = deduceRoutes([http('GET', 'http://api.test/orders/42')], { collapseSingletonIds: false })
    expect(templates(one)).toEqual(['GET /orders/42'])
    const two = deduceRoutes([http('GET', 'http://api.test/orders/42'), http('GET', 'http://api.test/orders/43')], { collapseSingletonIds: false })
    expect(templates(two)).toEqual(['GET /orders/{{orderId}}'])
  })

  it('a weak identifier needs the threshold, then rides along with strong ones', () => {
    expect(templates(deduceRoutes([http('GET', 'http://api.test/users/john42')]))).toEqual(['GET /users/john42'])
    expect(templates(deduceRoutes([http('GET', 'http://api.test/users/john42'), http('GET', 'http://api.test/users/mary7')]))).toEqual(['GET /users/{{userId}}'])
    expect(templates(deduceRoutes([http('GET', 'http://api.test/users/john42'), http('GET', 'http://api.test/users/7')]))).toEqual(['GET /users/{{userId}}'])
  })

  it('honours a higher paramThreshold', () => {
    const captures = [http('GET', 'http://api.test/users/john42'), http('GET', 'http://api.test/users/mary7')]
    expect(templates(deduceRoutes(captures, { paramThreshold: 3 }))).toEqual(['GET /users/john42', 'GET /users/mary7'])
    expect(templates(deduceRoutes([...captures, http('GET', 'http://api.test/users/bob99')], { paramThreshold: 3 }))).toEqual(['GET /users/{{userId}}'])
  })

  it('a versioned prefix such as v1 stays static when it is the only value', () => {
    expect(templates(deduceRoutes([http('GET', 'http://api.test/v1/users')]))).toEqual(['GET /v1/users'])
  })

  it('names parameters after the singular of the parent segment, deduplicated along the path', () => {
    expect(paramNameFor('users')).toBe('userId')
    expect(paramNameFor('categories')).toBe('categoryId')
    expect(paramNameFor('addresses')).toBe('addressId')
    expect(paramNameFor('api-keys')).toBe('apiKeyId')
    expect(paramNameFor(null)).toBe('id')
    const tree = deduceRoutes([http('GET', 'http://api.test/1/2'), http('GET', 'http://api.test/3/4')])
    expect(templates(tree)).toEqual(['GET /{{id}}/{{id2}}'])
  })
})

describe('route deduction — query parameters', () => {
  it('unions the keys, tracks presence and prefers the last successful value', () => {
    const tree = deduceRoutes([
      http('GET', 'http://api.test/search?q=cats&page=1'),
      http('GET', 'http://api.test/search?q=dogs&page=2&sort=asc', 500),
      http('GET', 'http://api.test/search?q=birds')
    ])
    const route = must(flattenRoutes(tree)[0])
    expect(route.template).toBe('/search')
    expect(route.queryParams).toEqual([
      { key: 'q', samples: ['cats', 'dogs', 'birds'], alwaysPresent: true, lastSuccessValue: 'birds' },
      { key: 'page', samples: ['1', '2'], alwaysPresent: false, lastSuccessValue: null },
      { key: 'sort', samples: ['asc'], alwaysPresent: false, lastSuccessValue: null }
    ])
    expect(route.captureIds).toHaveLength(3)
  })
})

describe('route deduction — protocols without a REST path', () => {
  it('groups GraphQL calls per operation on the endpoint', () => {
    clock += 100
    const gql = (name: string | null, type: 'query' | 'mutation' = 'query'): CaptureSummary => ({
      ...http('POST', 'http://api.test/graphql'),
      protocol: 'graphql',
      graphql: { operationType: type, operationName: name }
    })
    const tree = deduceRoutes([gql('Users'), gql('Users'), gql('CreateUser', 'mutation'), gql(null)])
    const routes = flattenRoutes(tree)
    expect(routes.map((r) => r.name).sort()).toEqual(['CreateUser', 'Users', 'query /graphql'])
    expect(must(routes.find((r) => r.name === 'Users')).captureIds).toHaveLength(2)
    expect(must(routes.find((r) => r.name === 'Users')).key).toBe('graphql|graphql:query:Users|http://api.test/graphql')
    expect(folderPaths(tree)).toEqual(['graphql'])
  })

  it('groups gRPC-web calls per service and method, never as parameters', () => {
    const grpc = (service: string, method: string): CaptureSummary => ({
      ...http('POST', `http://api.test/${service}/${method}`),
      protocol: 'grpc-web',
      grpc: { service, method }
    })
    const tree = deduceRoutes([grpc('pets.PetService', 'GetPet'), grpc('pets.PetService', 'ListPets'), grpc('pets.PetService', 'GetPet')])
    expect(folderPaths(tree)).toEqual(['pets.PetService'])
    const routes = flattenRoutes(tree)
    expect(routes.map((r) => r.name).sort()).toEqual(['pets.PetService.GetPet', 'pets.PetService.ListPets'])
    expect(must(routes.find((r) => r.name === 'pets.PetService.GetPet')).captureIds).toHaveLength(2)
    expect(must(routes[0]).grpc).toBeDefined()
  })

  it('groups WebSocket traffic per socket url and message type', () => {
    const ws = (type: string | null): CaptureSummary => ({
      ...http('WS', 'ws://api.test/socket'),
      protocol: 'websocket',
      websocket: { messageType: type }
    })
    const tree = deduceRoutes([ws('chat.message'), ws('chat.message'), ws('presence'), ws(null)])
    const routes = flattenRoutes(tree)
    // The socket seen without a typed message (closed early, a reconnect…) is
    // the same endpoint: it is folded into the first typed route, not a third.
    expect(routes.map((r) => r.name).sort()).toEqual(['WS /socket · chat.message', 'WS /socket · presence'])
    expect(must(routes.find((r) => r.name === 'WS /socket · chat.message')).captureIds).toHaveLength(3)
    // Alone, an untyped socket is still a route.
    expect(flattenRoutes(deduceRoutes([ws(null)])).map((r) => r.name)).toEqual(['WS /socket'])
  })
})

describe('route deduction — origins and noise', () => {
  it('puts each origin under its own host folder when several are involved', () => {
    const tree = deduceRoutes([
      http('GET', 'http://api.test/users'),
      http('GET', 'https://cdn.test:8443/assets/app.js')
    ])
    expect(folderPaths(tree)).toEqual(['api.test', 'cdn.test:8443', 'cdn.test:8443/assets'])
    expect(flattenRoutes(tree).map((r) => r.url).sort()).toEqual(['http://api.test/users', 'https://cdn.test:8443/assets/app.js'])
  })

  it('a site called over http AND ws is ONE host: no host folder, each route keeps its own scheme', () => {
    const tree = deduceRoutes([
      http('GET', 'http://app.test/api/pets'),
      http('WS', 'ws://app.test/ws', 101, { protocol: 'websocket', websocket: { messageType: 'hello', messageTypes: ['hello'], frameCount: 1, closed: false } })
    ])
    expect(folderPaths(tree)).toEqual(['api'])
    expect(flattenRoutes(tree).map((r) => r.url).sort()).toEqual(['http://app.test/api/pets', 'ws://app.test/ws'])
  })

  it('a single origin needs no host folder, and a lone leaf sits at the root', () => {
    const tree = deduceRoutes([http('GET', 'http://api.test/users')])
    expect(folderPaths(tree)).toEqual([])
    expect(tree.routes.map((r) => r.template)).toEqual(['/users'])
  })

  it('a root call sits at the root of the tree', () => {
    const tree = deduceRoutes([http('GET', 'http://api.test/')])
    expect(tree.routes.map((r) => r.template)).toEqual(['/'])
    expect(tree.folders).toEqual([])
  })

  it('ignores a capture whose url does not parse', () => {
    expect(deduceRoutes([http('GET', 'not a url')])).toEqual({ folders: [], routes: [] })
  })

  it('re-encodes a decoded static segment on the way out', () => {
    const tree = deduceRoutes([http('GET', 'http://api.test/reports/monthly%20sales')])
    expect(must(flattenRoutes(tree)[0]).template).toBe('/reports/monthly%20sales')
    expect(folderPaths(tree)).toEqual(['reports'])
  })
})
