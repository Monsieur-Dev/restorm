import { describe, it, expect, vi, beforeEach } from 'vitest'

// resolvers.ts pulls main-process services + ECUI at import time; stub them so
// the union/__resolveType + mutation-validation logic can be tested in node.
const createRequestMock = vi.fn((_parentId: string, req: unknown) => req)
const createFolderMock = vi.fn((_parentId: string | null, f: unknown) => f)

vi.mock('electron-core-ui/main', () => ({
  searchService: {},
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('../services', () => ({
  contextService: {},
  responseHistoryService: {}
}))
vi.mock('../services/CollectionStore', () => ({
  collectionStore: {
    createRequest: (parentId: string, req: unknown) => createRequestMock(parentId, req),
    createFolder: (parentId: string | null, f: unknown) => createFolderMock(parentId, f)
  },
  pubsub: { asyncIterator: vi.fn() },
  PUBSUB_TOPICS: {}
}))

import { resolvers } from './resolvers'

type ResolveType = (obj: Record<string, unknown>) => string
const requestResolve = (resolvers as unknown as { Request: { __resolveType: ResolveType } }).Request.__resolveType
const folderItemResolve = (resolvers as unknown as { FolderItem: { __resolveType: ResolveType } }).FolderItem.__resolveType
const mutation = (resolvers as unknown as {
  Mutation: {
    createRequest: (p: unknown, a: { parentId: string; input: unknown }) => unknown
    createFolder: (p: unknown, a: { parentId: string | null; input: unknown }) => unknown
  }
}).Mutation

describe('GraphQL Request.__resolveType', () => {
  it('maps every request discriminant to its union member, including odata + auth', () => {
    expect(requestResolve({ type: 'http' })).toBe('HTTPRequest')
    expect(requestResolve({ type: 'graphql' })).toBe('GraphQLRequest')
    expect(requestResolve({ type: 'grpc' })).toBe('GrpcRequest')
    expect(requestResolve({ type: 'soap' })).toBe('SoapRequest')
    expect(requestResolve({ type: 'websocket' })).toBe('WebSocketRequest')
    expect(requestResolve({ type: 'odata' })).toBe('ODataRequest')
    expect(requestResolve({ type: 'auth' })).toBe('AuthenticationRequest')
  })

  it('throws on an unknown discriminant instead of silently defaulting to HTTPRequest', () => {
    expect(() => requestResolve({ type: 'mystery' })).toThrow(/Cannot resolve GraphQL Request type/)
  })
})

describe('GraphQL FolderItem.__resolveType', () => {
  it('resolves folders, environment folders, and every request type', () => {
    expect(folderItemResolve({ folderType: 'environment' })).toBe('EnvironmentFolder')
    expect(folderItemResolve({ items: [] })).toBe('Folder')
    expect(folderItemResolve({ type: 'odata' })).toBe('ODataRequest')
    expect(folderItemResolve({ type: 'auth' })).toBe('AuthenticationRequest')
  })

  it('throws on an unknown item discriminant', () => {
    expect(() => folderItemResolve({ type: 'mystery' })).toThrow(/Cannot resolve GraphQL FolderItem type/)
  })
})

describe('GraphQL mutation input validation', () => {
  beforeEach(() => {
    createRequestMock.mockClear()
    createFolderMock.mockClear()
  })

  it('rejects a createRequest input missing a name (no write reaches the store)', () => {
    expect(() => mutation.createRequest(null, { parentId: 'p', input: { type: 'http' } }))
      .toThrow(/Invalid input for createRequest/)
    expect(createRequestMock).not.toHaveBeenCalled()
  })

  it('rejects a createRequest input with an unknown type', () => {
    expect(() => mutation.createRequest(null, { parentId: 'p', input: { name: 'r', type: 'mystery' } }))
      .toThrow(/Invalid input for createRequest/)
  })

  it('accepts a valid createRequest input (incl. odata) and forwards it', () => {
    mutation.createRequest(null, { parentId: 'p', input: { name: 'r', type: 'odata' } })
    expect(createRequestMock).toHaveBeenCalledWith('p', { id: '', name: 'r', type: 'odata' })
  })

  it('rejects a createFolder input missing a name', () => {
    expect(() => mutation.createFolder(null, { parentId: null, input: {} }))
      .toThrow(/Invalid input for createFolder/)
    expect(createFolderMock).not.toHaveBeenCalled()
  })
})
