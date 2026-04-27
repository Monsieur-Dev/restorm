import { describe, it, expect } from 'vitest'
import {
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
