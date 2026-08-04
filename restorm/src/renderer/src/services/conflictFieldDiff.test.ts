import { describe, it, expect } from 'vitest'
import { computeEntityFieldDiff, conflictVisibleTabIds } from './conflictFieldDiff'
import type { Folder, EnvironmentFolder, FolderItem } from '../../../shared/types/folderTypes'
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
    const diff = computeEntityFieldDiff('folder', ours, theirs)
    expect(diff?.fields['notes']).toBe(true)
    expect(diff?.preselectTabId).toBe('notes')
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

  it('reports the NAME as the differing field when only the name diverges', () => {
    // A rename used to produce an empty diff: the entity was listed as
    // conflicting and the panel then showed nothing to arbitrate.
    const ours = makeFolder({ name: 'Ours name' })
    const theirs = makeFolder({ name: 'Theirs name' })
    const diff = computeEntityFieldDiff('folder', ours, theirs)
    expect(diff?.fields['name']).toBe(true)
    expect(diff?.fields['notes']).toBe(false)
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
    const diff = computeEntityFieldDiff('environmentFolder', ours, theirs)
    expect(diff?.fields['notes']).toBe(true)
    expect(diff?.preselectTabId).toBe('notes')
  })

  it('returns undefined for scenario — no field-diff / highlighting by design', () => {
    expect(computeEntityFieldDiff('scenario', makeFolder(), makeFolder())).toBeUndefined()
  })

  it('two sides of different request.type still surface a name difference', () => {
    // No sensible per-field comparison exists across kinds — but the name
    // is comparable whatever the shapes are, and it is the one thing the
    // user can still arbitrate here.
    const diff = computeEntityFieldDiff('request', makeGraphQLRequest(), makeWebSocketRequest() as never)
    expect(diff?.fields['name']).toBe(true)
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
      rowDiffs: { headers: [], params: [], pathParams: [] },
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

  it('reports the exact KV row keys that differ (value change, one-sided, ignoring id churn + reorder)', () => {
    const ours = makeHTTPRequest({
      headers: [
        { id: 'id-a', key: 'Accept', value: 'application/json' } as never,
        { id: 'id-b', key: 'X-Only-Ours', value: 'keep' } as never,
        { id: 'id-c', key: 'Stable', value: 'same' } as never
      ]
    })
    const theirs = makeHTTPRequest({
      headers: [
        // reordered + fresh ids, Stable unchanged → not flagged
        { id: 'id-z', key: 'Stable', value: 'same' } as never,
        { id: 'id-d', key: 'Accept', value: 'text/plain' } as never, // value changed → flagged
        { id: 'id-e', key: 'X-Only-Theirs', value: 'new' } as never  // one-sided → flagged
      ]
    })
    const rows = computeEntityFieldDiff('request', ours, theirs)?.rowDiffs?.['headers'] ?? []
    expect([...rows].sort()).toEqual(['Accept', 'X-Only-Ours', 'X-Only-Theirs'])
  })

  it('reports no differing rows when the KV lists match (even reordered / re-id-ed)', () => {
    const ours = makeHTTPRequest({ params: [{ id: 'p1', key: 'a', value: '1' } as never, { id: 'p2', key: 'b', value: '2' } as never] })
    const theirs = makeHTTPRequest({ params: [{ id: 'p9', key: 'b', value: '2' } as never, { id: 'p8', key: 'a', value: '1' } as never] })
    expect(computeEntityFieldDiff('request', ours, theirs)?.rowDiffs?.['params']).toEqual([])
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
    const diff = computeEntityFieldDiff('request', ours, theirs)
    expect(diff?.fields['quickConfigs']).toBe(false)
    expect(diff?.conflictingQuickConfigNames).toBeUndefined()
  })

  it('quick configs: does NOT flag a conflict when same-named configs have identical fields', () => {
    const config = { id: 'q1', name: 'Staging', requestId: 'r1', storageTarget: 'project' as const, fields: { url: 'a' }, createdAt: '', updatedAt: '' }
    const ours = makeHTTPRequest({ quickConfigs: [config] } as never)
    const theirs = makeHTTPRequest({ quickConfigs: [{ ...config, id: 'q2' }] } as never)
    const diff = computeEntityFieldDiff('request', ours, theirs)
    expect(diff?.fields['quickConfigs']).toBe(false)
    expect(diff?.conflictingQuickConfigNames).toBeUndefined()
  })

  it('quick configs: flags a whole-config conflict + names it when the same name differs on both sides', () => {
    const ours = makeHTTPRequest({
      quickConfigs: [
        { id: 'q1', name: 'Staging', requestId: 'r1', storageTarget: 'project', fields: { url: 'a' }, createdAt: '', updatedAt: '' },
        { id: 'q3', name: 'Prod', requestId: 'r1', storageTarget: 'project', fields: { url: 'p' }, createdAt: '', updatedAt: '' }
      ]
    } as never)
    const theirs = makeHTTPRequest({
      quickConfigs: [
        { id: 'q2', name: 'Staging', requestId: 'r1', storageTarget: 'project', fields: { url: 'b' }, createdAt: '', updatedAt: '' },
        { id: 'q3', name: 'Prod', requestId: 'r1', storageTarget: 'project', fields: { url: 'p' }, createdAt: '', updatedAt: '' }
      ]
    } as never)
    const diff = computeEntityFieldDiff('request', ours, theirs)
    expect(diff?.fields['quickConfigs']).toBe(true)
    // Only the genuinely-divergent config is named; the identical "Prod" isn't.
    expect(diff?.conflictingQuickConfigNames).toEqual(['Staging'])
    // The picker for quick configs lives in a band above the tab strip, not in
    // a tab — so a quickConfigs-only conflict still never drives the preselect.
    expect(diff?.preselectTabId).toBeUndefined()
  })
})

describe('conflictVisibleTabIds', () => {
  it('keeps only the tabs that carry a divergence', () => {
    expect(conflictVisibleTabIds({ fields: { url: true, notes: false } })).toEqual(['request'])
    expect(conflictVisibleTabIds({ fields: { url: false, notes: true } })).toEqual(['notes'])
    expect(conflictVisibleTabIds({ fields: { url: true, notes: true } })).toEqual(['request', 'notes'])
  })

  it('returns nothing when the name is all that changed', () => {
    // The rename is rendered above the strip, so there is genuinely no tab
    // to show — the caller drops the entity view entirely.
    expect(conflictVisibleTabIds({ fields: { name: true } })).toEqual([])
    expect(conflictVisibleTabIds({ fields: { name: true, url: false } })).toEqual([])
  })

  it('never lists the documentation tab, even for a request that has one', () => {
    // Documentation is imported, never authored, and auto-resolved — it is
    // not the user's to arbitrate.
    expect(conflictVisibleTabIds({ fields: { documentation: true } })).not.toContain('docs')
  })
})

describe('contested tags', () => {
  it('flags a tag difference and gives it its own tab', () => {
    const ours = { ...makeHTTPRequest(), tags: ['smoke', 'v1'] }
    const theirs = { ...makeHTTPRequest(), tags: ['smoke', 'v2'] }

    const diff = computeEntityFieldDiff('request', ours, theirs)

    expect(diff?.fields['tags']).toBe(true)
    expect(conflictVisibleTabIds(diff)).toEqual(['conflict-tags'])
  })

  it('ignores a pure reorder — a tag list is a set, not a sequence', () => {
    const ours = { ...makeHTTPRequest(), tags: ['smoke', 'v1'] }
    const theirs = { ...makeHTTPRequest(), tags: ['v1', 'smoke'] }

    const diff = computeEntityFieldDiff('request', ours, theirs)

    expect(diff?.fields['tags']).toBeUndefined()
  })
})

describe('a folder conflict beyond notes', () => {
  const envFolder = (variableValue: string): FolderItem => ({
    id: 'e1', name: 'Lab', tags: [], configuration: {}, folderType: 'environment',
    environments: [{ id: 'env1', name: 'dev', variables: [{ key: 'url', value: variableValue }] }],
    items: []
  } as unknown as FolderItem)

  it('flags contested environment variables and opens on that tab', () => {
    // Previously only `notes` was computed, so this conflict highlighted
    // nothing and opened on the wrong tab — the user had to compare two
    // environment trees by eye.
    const diff = computeEntityFieldDiff('environmentFolder', envFolder('https://ours'), envFolder('https://theirs'))

    expect(diff?.fields['environments']).toBe(true)
    expect(diff?.preselectTabId).toBe('environments')
  })

  it('flags a contested folder configuration', () => {
    const ours = { id: 'f1', name: 'F', tags: [], configuration: { timeout: 1000 }, items: [] } as unknown as FolderItem
    const theirs = { id: 'f1', name: 'F', tags: [], configuration: { timeout: 9000 }, items: [] } as unknown as FolderItem

    const diff = computeEntityFieldDiff('folder', ours, theirs)

    expect(diff?.fields['configuration']).toBe(true)
    expect(diff?.preselectTabId).toBe('home')
  })

  it('leaves everything false when the two sides match', () => {
    const diff = computeEntityFieldDiff('environmentFolder', envFolder('https://same'), envFolder('https://same'))

    expect(diff?.fields['environments']).toBe(false)
    expect(diff?.preselectTabId).toBeUndefined()
  })
})
