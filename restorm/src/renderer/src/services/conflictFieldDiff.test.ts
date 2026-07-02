import { describe, it, expect } from 'vitest'
import { computeEntityFieldDiff } from './conflictFieldDiff'
import type { Folder, EnvironmentFolder } from '../../../shared/types/folderTypes'
import type { HTTPRequest, AuthenticationRequest, GraphQLRequest, WebSocketRequest } from '../../../shared/types/requests'

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: 'f1',
    name: 'My folder',
    tags: [],
    configuration: {},
    items: [],
    ...overrides
  } as Folder
}

/** A REAL environment folder — `folderType: 'environment'` is what
 * `isEnvironmentFolder`/`isFolder` actually branch on, so a fixture built
 * from `makeFolder()` alone (missing this marker) would silently pass
 * `isFolder`'s guard too and never catch a regression there. */
function makeEnvironmentFolder(overrides: Partial<EnvironmentFolder> = {}): EnvironmentFolder {
  return {
    ...makeFolder(),
    folderType: 'environment',
    fileFormatVersion: 1,
    environments: [],
    ...overrides
  } as EnvironmentFolder
}

function makeHTTPRequest(overrides: Partial<HTTPRequest> = {}): HTTPRequest {
  return {
    id: 'r1',
    name: 'Find pet',
    type: 'http',
    tags: [],
    method: 'GET',
    url: 'https://example.com/pets',
    headers: [],
    params: [],
    ...overrides
  } as HTTPRequest
}

function makeAuthRequest(overrides: Partial<AuthenticationRequest> = {}): AuthenticationRequest {
  return {
    id: 'a1',
    name: 'Login',
    type: 'auth',
    tags: [],
    method: 'POST',
    url: 'https://example.com/login',
    headers: [],
    params: [],
    producedHeaders: [],
    authErrorCodes: [401, 403],
    ...overrides
  } as AuthenticationRequest
}

function makeGraphQLRequest(overrides: Partial<GraphQLRequest> = {}): GraphQLRequest {
  return {
    id: 'g1',
    name: 'Get pets',
    type: 'graphql',
    tags: [],
    url: 'https://example.com/graphql',
    operationType: 'query',
    query: '{ pets { id } }',
    headers: [],
    ...overrides
  } as unknown as GraphQLRequest
}

function makeWebSocketRequest(overrides: Partial<WebSocketRequest> = {}): WebSocketRequest {
  return {
    id: 'w1',
    name: 'Live feed',
    type: 'websocket',
    tags: [],
    url: 'wss://example.com/socket',
    protocol: 'ws',
    message: '{}',
    headers: [],
    ...overrides
  } as unknown as WebSocketRequest
}

describe('computeEntityFieldDiff', () => {
  it('flags notes as differing and preselects the notes tab for a folder conflict', () => {
    const ours = makeFolder({ notes: 'ours notes' })
    const theirs = makeFolder({ notes: 'theirs notes' })
    expect(computeEntityFieldDiff('folder', ours, theirs)).toEqual({
      fields: { notes: true },
      preselectTabId: 'notes'
    })
  })

  it('treats undefined and empty-string notes as equal', () => {
    // `notes` is optional and simply omitted here rather than passed as
    // `{ notes: undefined }` — `exactOptionalPropertyTypes` treats those
    // as different shapes even though they're runtime-equivalent.
    const ours = makeFolder()
    const theirs = makeFolder({ notes: '' })
    const diff = computeEntityFieldDiff('folder', ours, theirs)
    expect(diff?.fields['notes']).toBe(false)
    expect(diff?.preselectTabId).toBeUndefined()
  })

  it('reports no diff and no preselect when a folder conflict is on a non-panel field only', () => {
    const ours = makeFolder({ name: 'Ours name' })
    const theirs = makeFolder({ name: 'Theirs name' })
    expect(computeEntityFieldDiff('folder', ours, theirs)).toEqual({ fields: { notes: false } })
  })

  it('works the same for a REAL environment-folder object (folderType: "environment", not just the "folder" shape)', () => {
    // Regression test: `isFolder()` explicitly EXCLUDES environment
    // folders (`!isEnvironmentFolder(item)`), so guarding the dispatch on
    // `isFolder(ours) && isFolder(theirs)` silently returned `undefined`
    // for a real EnvironmentFolder — no preselectTabId ever reached the
    // panel live, even though a `makeFolder()`-shaped fixture masked it
    // here before. Dispatch must use `isAnyFolder` instead.
    const ours = makeEnvironmentFolder({ notes: 'a' })
    const theirs = makeEnvironmentFolder({ notes: 'b' })
    expect(computeEntityFieldDiff('environmentFolder', ours, theirs)).toEqual({
      fields: { notes: true },
      preselectTabId: 'notes'
    })
  })

  it('returns undefined for scenario — no field-diff / highlighting by design', () => {
    expect(computeEntityFieldDiff('scenario', makeFolder(), makeFolder())).toBeUndefined()
  })

  it('returns undefined when the two sides have different request.type (pathological, no sensible diff)', () => {
    expect(computeEntityFieldDiff('request', makeGraphQLRequest(), makeWebSocketRequest() as never)).toBeUndefined()
  })

  it('generic protocol diff (GraphQL): identical requests report no diff and no preselect', () => {
    const diff = computeEntityFieldDiff('request', makeGraphQLRequest(), makeGraphQLRequest())
    expect(diff).toEqual({ fields: { url: false, requestConfig: false, notes: false } })
  })

  it('generic protocol diff (GraphQL): flags url discretely and preselects the request tab', () => {
    const ours = makeGraphQLRequest({ url: 'https://ours.example.com/graphql' })
    const theirs = makeGraphQLRequest({ url: 'https://theirs.example.com/graphql' })
    expect(computeEntityFieldDiff('request', ours, theirs)).toEqual({
      fields: { url: true, requestConfig: false, notes: false },
      preselectTabId: 'request'
    })
  })

  it('generic protocol diff (GraphQL): a query/variables/operationName/headers difference is one coarse requestConfig flag', () => {
    const ours = makeGraphQLRequest({ query: '{ pets { id } }' })
    const theirs = makeGraphQLRequest({ query: '{ pets { id name } }' })
    const diff = computeEntityFieldDiff('request', ours, theirs)
    expect(diff?.fields['requestConfig']).toBe(true)
    expect(diff?.fields['url']).toBe(false)
    expect(diff?.preselectTabId).toBe('request')
  })

  it('generic protocol diff (GraphQL): ignores key-value row id churn in headers', () => {
    const ours = makeGraphQLRequest({ headers: [{ id: 'id-a', key: 'X-Test', value: 'a' } as never] })
    const theirsSame = makeGraphQLRequest({ headers: [{ id: 'id-b', key: 'X-Test', value: 'a' } as never] })
    expect(computeEntityFieldDiff('request', ours, theirsSame)?.fields['requestConfig']).toBe(false)
  })

  it('generic protocol diff (GraphQL): preselects notes when only notes differs', () => {
    const ours = makeGraphQLRequest({ notes: 'a' })
    const theirs = makeGraphQLRequest({ notes: 'b' })
    expect(computeEntityFieldDiff('request', ours, theirs)?.preselectTabId).toBe('notes')
  })

  it('generic protocol diff applies uniformly to WebSocket too (not just GraphQL)', () => {
    const ours = makeWebSocketRequest({ message: 'ping' })
    const theirs = makeWebSocketRequest({ message: 'pong' })
    const diff = computeEntityFieldDiff('request', ours, theirs)
    expect(diff?.fields['requestConfig']).toBe(true)
    expect(diff?.preselectTabId).toBe('request')
  })

  it('flags url and preselects the request tab when only the URL differs on an HTTP request', () => {
    const ours = makeHTTPRequest({ url: 'https://ours.example.com/pets' })
    const theirs = makeHTTPRequest({ url: 'https://theirs.example.com/pets' })
    expect(computeEntityFieldDiff('request', ours, theirs)).toEqual({
      fields: { url: true, method: false, headers: false, params: false, pathParams: false, body: false, notes: false, quickConfigs: false },
      preselectTabId: 'request'
    })
  })

  it('flags headers as a whole (coarse, not per-row) and ignores key-value row id churn', () => {
    const ours = makeHTTPRequest({ headers: [{ id: 'id-a', key: 'Accept', value: 'application/json' } as never] })
    const theirsSameContent = makeHTTPRequest({ headers: [{ id: 'id-b', key: 'Accept', value: 'application/json' } as never] })
    const diff = computeEntityFieldDiff('request', ours, theirsSameContent)
    expect(diff?.fields['headers']).toBe(false)

    const theirsDifferent = makeHTTPRequest({ headers: [{ id: 'id-c', key: 'Accept', value: 'text/plain' } as never] })
    expect(computeEntityFieldDiff('request', ours, theirsDifferent)?.fields['headers']).toBe(true)
  })

  it('preselects notes when only notes differs on an HTTP request', () => {
    const ours = makeHTTPRequest({ notes: 'a' })
    const theirs = makeHTTPRequest({ notes: 'b' })
    expect(computeEntityFieldDiff('request', ours, theirs)?.preselectTabId).toBe('notes')
  })

  it('adds auth-only fields and preselects the configuration tab when they differ (request tab identical)', () => {
    const ours = makeAuthRequest({ expirationExpression: '{{expires_in}}' })
    const theirs = makeAuthRequest({ expirationExpression: '{{other_expiry}}' })
    const diff = computeEntityFieldDiff('request', ours, theirs)
    expect(diff?.fields['expirationExpression']).toBe(true)
    expect(diff?.fields['producedHeaders']).toBe(false)
    expect(diff?.fields['authErrorCodes']).toBe(false)
    expect(diff?.preselectTabId).toBe('configuration')
  })

  it('prioritizes the request tab over configuration over notes when several differ', () => {
    const ours = makeAuthRequest({ url: 'https://ours.example.com', expirationExpression: 'a', notes: 'x' })
    const theirs = makeAuthRequest({ url: 'https://theirs.example.com', expirationExpression: 'b', notes: 'y' })
    expect(computeEntityFieldDiff('request', ours, theirs)?.preselectTabId).toBe('request')
  })

  it('has no preselect when two HTTP requests are identical', () => {
    const ours = makeHTTPRequest()
    const theirs = makeHTTPRequest()
    const diff = computeEntityFieldDiff('request', ours, theirs)
    expect(diff?.preselectTabId).toBeUndefined()
    expect(Object.values(diff?.fields ?? {}).every((v) => !v)).toBe(true)
  })

  it('quick configs: does NOT flag a conflict when a config exists on only one side (merges in automatically)', () => {
    const ours = makeHTTPRequest({
      quickConfigs: [{ id: 'q1', name: 'Staging', requestId: 'r1', storageTarget: 'project', fields: { url: 'a' }, createdAt: '', updatedAt: '' }]
    } as never)
    const theirs = makeHTTPRequest()
    expect(computeEntityFieldDiff('request', ours, theirs)?.fields['quickConfigs']).toBe(false)
  })

  it('quick configs: does NOT flag a conflict when same-named configs have identical fields', () => {
    const config = { id: 'q1', name: 'Staging', requestId: 'r1', storageTarget: 'project' as const, fields: { url: 'a' }, createdAt: '', updatedAt: '' }
    const ours = makeHTTPRequest({ quickConfigs: [config] } as never)
    const theirs = makeHTTPRequest({ quickConfigs: [{ ...config, id: 'q2' }] } as never)
    expect(computeEntityFieldDiff('request', ours, theirs)?.fields['quickConfigs']).toBe(false)
  })

  it('quick configs: flags a whole-config conflict when the same name differs in fields on both sides', () => {
    const ours = makeHTTPRequest({
      quickConfigs: [{ id: 'q1', name: 'Staging', requestId: 'r1', storageTarget: 'project', fields: { url: 'a' }, createdAt: '', updatedAt: '' }]
    } as never)
    const theirs = makeHTTPRequest({
      quickConfigs: [{ id: 'q2', name: 'Staging', requestId: 'r1', storageTarget: 'project', fields: { url: 'b' }, createdAt: '', updatedAt: '' }]
    } as never)
    const diff = computeEntityFieldDiff('request', ours, theirs)
    expect(diff?.fields['quickConfigs']).toBe(true)
    // No tab hosts quick configs inside the conflict panel yet — a
    // quickConfigs-only conflict never drives the tab preselect.
    expect(diff?.preselectTabId).toBeUndefined()
  })
})
