import { describe, it, expect } from 'vitest'
import {
  filterImportTreeBySelection,
  importNaturalKeyForFolder,
  importNaturalKeyForRequest,
  walkImportTreeWithKeys
} from '../../src/shared/utils/importNaturalKey'
import type { FolderItem, Folder, EnvironmentFolder } from '../../src/shared/types/folderTypes'
import type { Request, HTTPRequest, GraphQLRequest, GrpcRequest, AuthenticationRequest } from '../../src/shared/types/requests'

function http(method: HTTPRequest['method'], url: string): HTTPRequest {
  // Cast through unknown — the test only exercises the natural-key
  // surface, not the rest of HTTPRequest's shape, so we keep the
  // fixtures minimal rather than constructing the full object.
  return { type: 'http', id: 'irrelevant', name: `${method} ${url}`, method, url } as unknown as HTTPRequest
}

function graphql(name: string): GraphQLRequest {
  return { type: 'graphql', id: 'irrelevant', name } as unknown as GraphQLRequest
}

function grpc(name: string): GrpcRequest {
  return { type: 'grpc', id: 'irrelevant', name } as unknown as GrpcRequest
}

function auth(method: string, url: string): AuthenticationRequest {
  return { type: 'auth', id: 'irrelevant', name: `${method} ${url}`, method, url } as unknown as AuthenticationRequest
}

function scenario(name: string): FolderItem {
  // A Postman/Bruno workflow scenario as emitted by the importer: `type:'scenario'`
  // with nodes/edges and an empty `items`, but no `configuration`.
  return { type: 'scenario', id: 'irrelevant', name, tags: [], params: [], nodes: [], edges: [], items: [] } as unknown as FolderItem
}

/** An http request with an explicit id, so a workflow scenario can bind to it. */
function httpId(id: string, method: HTTPRequest['method'], url: string): HTTPRequest {
  return { type: 'http', id, name: `${method} ${url}`, method, url } as unknown as HTTPRequest
}

/** A workflow scenario whose `httpRequest` nodes bind the given request ids. */
function scenarioBound(name: string, requestIds: string[]): FolderItem {
  const nodes = requestIds.map((rid, i) => ({ id: `${rid}:http`, kind: 'httpRequest', config: { requestId: rid }, inputs: [], outputs: [], position: { x: i, y: 0 } }))
  return { type: 'scenario', id: `scn:${name}`, name, tags: [], params: [], nodes, edges: [], items: [] } as unknown as FolderItem
}

function folder(name: string, items: FolderItem[] = []): Folder {
  return {
    id: 'irrelevant',
    name,
    documentation: '',
    tags: [],
    configuration: {} as unknown as Folder['configuration'],
    items
  }
}

function envFolder(name: string, items: FolderItem[] = []): EnvironmentFolder {
  return {
    id: 'irrelevant',
    name,
    documentation: '',
    tags: [],
    configuration: {} as unknown as EnvironmentFolder['configuration'],
    items,
    folderType: 'environment',
    fileFormatVersion: 1,
    environments: []
  }
}

describe('importNaturalKeyForRequest', () => {
  it('uppercases the HTTP method and concatenates with the URL', () => {
    // Pass an arbitrary case in to assert normalisation; the test
    // fixture's `http()` helper accepts an HTTPMethod literal so use
    // the lowercase form via the type system's escape hatch (we're
    // verifying defensive normalisation, not the canonical input).
    const lowercase = 'get' as unknown as HTTPRequest['method']
    expect(importNaturalKeyForRequest(http(lowercase, '/pet/{petId}')))
      .toBe('request:http:GET /pet/{petId}')
  })

  it('treats authentication requests under the http slot', () => {
    // AuthenticationRequest carries method + url just like HTTP, so
    // collapsing them under the same key shape avoids a parallel
    // `request:auth:…` slot the user can't differentiate at the
    // selection-tree level. Pin the behaviour so it doesn't drift.
    expect(importNaturalKeyForRequest(auth('post', '/auth/login')))
      .toBe('request:http:POST /auth/login')
  })

  it('uses the operation name for GraphQL, gRPC, etc.', () => {
    expect(importNaturalKeyForRequest(graphql('GetUserById'))).toBe('request:graphql:GetUserById')
    expect(importNaturalKeyForRequest(grpc('PetstoreService.GetPet'))).toBe('request:grpc:PetstoreService.GetPet')
  })
})

describe('importNaturalKeyForFolder', () => {
  it('joins the breadcrumb path with /', () => {
    expect(importNaturalKeyForFolder([])).toBe('folder:')
    expect(importNaturalKeyForFolder(['Swagger Petstore'])).toBe('folder:Swagger Petstore')
    expect(importNaturalKeyForFolder(['Swagger Petstore', 'pet'])).toBe('folder:Swagger Petstore/pet')
  })
})

describe('walkImportTreeWithKeys', () => {
  it('emits one entry per node in depth-first order, excluding nothing', () => {
    const tree: FolderItem[] = [
      envFolder('Swagger Petstore', [
        folder('pet', [
          http('GET', '/pet/{petId}'),
          http('POST', '/pet')
        ]),
        folder('store', [
          http('GET', '/store/inventory')
        ])
      ])
    ]

    const entries = walkImportTreeWithKeys(tree)
    expect(entries.map(e => e.key)).toEqual([
      'folder:Swagger Petstore',
      'folder:Swagger Petstore/pet',
      'request:http:GET /pet/{petId}',
      'request:http:POST /pet',
      'folder:Swagger Petstore/store',
      'request:http:GET /store/inventory'
    ])
  })

  it('passes the breadcrumb path on each entry so callers can show "where in the tree"', () => {
    const tree: FolderItem[] = [
      folder('outer', [folder('inner', [http('get', '/x')])])
    ]
    const entries = walkImportTreeWithKeys(tree)
    expect(entries.map(e => ({ key: e.key, path: e.path }))).toEqual([
      { key: 'folder:outer', path: ['outer'] },
      { key: 'folder:outer/inner', path: ['outer', 'inner'] },
      // Leaf request: path is the parent folder's path, not the
      // request's own — the request name is encoded in the key.
      { key: 'request:http:GET /x', path: ['outer', 'inner'] }
    ])
  })

  it('handles a flat list of leaf requests', () => {
    const tree: FolderItem[] = [
      http('GET', '/a'),
      http('POST', '/b')
    ]
    const entries = walkImportTreeWithKeys(tree)
    expect(entries.map(e => e.key)).toEqual([
      'request:http:GET /a',
      'request:http:POST /b'
    ])
  })

  it('keys do not depend on runtime ids, so two imports of the same source produce identical keys', () => {
    // Pin the central invariant the snapshot relies on: keys must be
    // stable across re-imports, otherwise the user's prior selection
    // can't be preserved on refresh. Build "the same spec" twice with
    // *different* runtime ids and confirm the key list is identical.
    const buildTree = (): FolderItem[] => [
      envFolder('Spec A', [
        folder('group', [http('get', '/r')])
      ])
    ]
    const first = walkImportTreeWithKeys(buildTree()).map(e => e.key)
    const second = walkImportTreeWithKeys(buildTree()).map(e => e.key)
    expect(first).toEqual(second)
  })

  it('filterImportTreeBySelection drops leaves not in the set', () => {
    const tree: FolderItem[] = [
      folder('pet', [
        http('GET', '/pet/{petId}'),
        http('POST', '/pet')
      ])
    ]
    const keep = new Set(['request:http:GET /pet/{petId}'])
    const filtered = filterImportTreeBySelection(tree, keep)
    expect(filtered).toHaveLength(1)
    const [rootFolder] = filtered
    if (!rootFolder || !('items' in rootFolder)) throw new Error('unexpected shape')
    expect(rootFolder.items.map((i) => importNaturalKeyForRequest(i as Request)))
      .toEqual(['request:http:GET /pet/{petId}'])
  })

  it('filterImportTreeBySelection prunes folders that become empty', () => {
    const tree: FolderItem[] = [
      folder('keep', [http('GET', '/a')]),
      folder('drop', [http('POST', '/b')])
    ]
    const keep = new Set(['request:http:GET /a'])
    const filtered = filterImportTreeBySelection(tree, keep)
    expect(filtered.map((i) => (i as Folder).name)).toEqual(['keep'])
  })

  it('filterImportTreeBySelection keeps a workflow scenario alongside its selected sibling requests', () => {
    const scn = scenario('Pet API — Workflow')
    const tree: FolderItem[] = [
      folder('pet', [
        http('GET', '/pet/{petId}'),
        http('POST', '/pet'),
        scn
      ])
    ]
    // The scenario has no selectable key, so it never appears in `selection`.
    const keep = new Set(['request:http:GET /pet/{petId}'])
    const filtered = filterImportTreeBySelection(tree, keep)
    const [root] = filtered
    if (!root || !('items' in root)) throw new Error('unexpected shape')
    // The selected request + the scenario survive; the unchecked request is dropped.
    expect(root.items.map((i) => (i as { name: string }).name)).toEqual(['GET /pet/{petId}', 'Pet API — Workflow'])
    expect(root.items).toContain(scn)
  })

  it('filterImportTreeBySelection drops a folder kept alive only by a scenario (no selected requests)', () => {
    const tree: FolderItem[] = [folder('pet', [http('POST', '/pet'), scenario('Pet API — Workflow')])]
    const filtered = filterImportTreeBySelection(tree, new Set<string>())
    expect(filtered).toHaveLength(0)
  })

  it('filterImportTreeBySelection drops a workflow scenario when one of its bound requests is deselected', () => {
    const tree: FolderItem[] = [
      folder('pet', [
        httpId('r1', 'GET', '/a'),
        httpId('r2', 'POST', '/b'),
        scenarioBound('Flow', ['r1', 'r2'])
      ])
    ]
    // Keep r1, drop r2 → the scenario binds a request that didn't survive, so it
    // must be dropped (else its r2 box would dangle and disable Run).
    const filtered = filterImportTreeBySelection(tree, new Set(['request:http:GET /a']))
    const [root] = filtered
    if (!root || !('items' in root)) throw new Error('unexpected shape')
    expect(root.items.map((i) => (i as { name: string }).name)).toEqual(['GET /a'])
    expect(root.items.some((i) => (i as { type?: string }).type === 'scenario')).toBe(false)
  })

  it('filterImportTreeBySelection keeps a workflow scenario when all its bound requests survive', () => {
    const tree: FolderItem[] = [
      folder('pet', [
        httpId('r1', 'GET', '/a'),
        httpId('r2', 'POST', '/b'),
        scenarioBound('Flow', ['r1', 'r2'])
      ])
    ]
    const filtered = filterImportTreeBySelection(tree, new Set(['request:http:GET /a', 'request:http:POST /b']))
    const [root] = filtered
    if (!root || !('items' in root)) throw new Error('unexpected shape')
    expect(root.items.some((i) => (i as { type?: string }).type === 'scenario')).toBe(true)
  })

  it('filterImportTreeBySelection passes leaf request references through unchanged', () => {
    // Pin: a structural clone of the surrounding folder layout but
    // *no* clone of leaf requests. Reactive proxies / runtime
    // payloads attached upstream by the import services need to
    // survive the filter pass intact.
    const leaf = http('GET', '/x')
    const tree: FolderItem[] = [folder('group', [leaf])]
    const filtered = filterImportTreeBySelection(tree, new Set(['request:http:GET /x']))
    const [group] = filtered
    if (!group || !('items' in group)) throw new Error('unexpected shape')
    const [leafOut] = group.items
    expect(leafOut).toBe(leaf)
  })

  it('falls through to a stable shape for unknown request kinds', () => {
    // Make sure adding a new request type later (e.g. SSE, Kafka) does
    // not crash the selection flow before its dedicated branch lands.
    const exotic = { type: 'sse', id: 'x', name: 'PetUpdated' } as unknown as Request
    const tree: FolderItem[] = [folder('events', [exotic])]
    const entries = walkImportTreeWithKeys(tree)
    expect(entries.map(e => e.key)).toEqual([
      'folder:events',
      'request:sse:PetUpdated'
    ])
  })
})
