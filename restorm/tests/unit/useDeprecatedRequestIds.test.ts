/**
 * Tests for `useDeprecatedRequestIds` — walks the workspace tree
 * and returns the set of request ids whose URL currently resolves
 * to a `deprecated: true` operation in the owning env folder's
 * apiDocumentation. Drives the sidebar's opacity dim.
 */

import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDeprecatedRequestIds } from '../../src/renderer/src/hooks/useDeprecatedRequestIds'
import type { EnvironmentFolder, Folder, Request } from '../../src/shared/types/collections'
import type { ApiDocumentation, OperationDocumentation } from '../../src/shared/types/apiDocumentation'

function makeOp(urlPattern: string, opts: { method?: string; deprecated?: boolean } = {}): OperationDocumentation {
  return {
    match: {
      urlPattern,
      method: opts.method ?? 'GET'
    },
    ...(opts.deprecated === true ? { deprecated: true } : {})
  }
}

function makeApiDoc(operations: OperationDocumentation[]): ApiDocumentation {
  return {
    sourceType: 'swagger',
    api: { title: 'fixture', version: '1.0' },
    models: {},
    groups: {},
    operations
  }
}

function makeRequest(id: string, name: string, url: string, method = 'GET'): Request {
  return {
    id,
    name,
    type: 'http',
    method,
    url,
    headers: [],
    params: [],
    pathParams: [],
    documentation: '',
    notes: '',
    tags: []
  } as unknown as Request
}

function makeEnvFolder(opts: {
  id: string
  name?: string
  apiDoc?: ApiDocumentation
  variables?: Record<string, string>
  items?: (Folder | Request)[]
}): EnvironmentFolder {
  const env = {
    id: `${opts.id}-env`,
    name: 'default',
    variables: Object.entries(opts.variables ?? {}).map(([key, value]) => ({ key, value, enabled: true })),
    subEnvironments: []
  }
  return {
    id: opts.id,
    folderType: 'environment',
    fileFormatVersion: 1,
    name: opts.name ?? 'env',
    documentation: '',
    tags: [],
    configuration: {},
    items: opts.items ?? [],
    environments: [env],
    ...(opts.apiDoc ? { apiDocumentation: opts.apiDoc } : {})
  } as unknown as EnvironmentFolder
}

describe('useDeprecatedRequestIds', () => {
  it('returns an empty set when there are no env folders', () => {
    const { result } = renderHook(() => useDeprecatedRequestIds([]))
    expect(result.current.size).toBe(0)
  })

  it('flags a request whose URL matches a `deprecated: true` operation', () => {
    const apiDoc = makeApiDoc([
      makeOp('/pet/findByTags', { deprecated: true }),
      makeOp('/pet/findByStatus')
    ])
    const deprecatedReq = makeRequest('r-deprec', 'Finds Pets by tags', '{{baseUrl}}/pet/findByTags')
    const otherReq = makeRequest('r-ok', 'Finds Pets by status', '{{baseUrl}}/pet/findByStatus')
    const env = makeEnvFolder({
      id: 'env-1',
      apiDoc,
      variables: { baseUrl: 'https://api.example.com' },
      items: [deprecatedReq, otherReq]
    })
    const { result } = renderHook(() => useDeprecatedRequestIds([env]))
    expect(result.current.has('r-deprec')).toBe(true)
    expect(result.current.has('r-ok')).toBe(false)
  })

  it('prefers the literal-pattern operation over a parameterised one with the same prefix', () => {
    // The matcher's specificity tie-break: `/pet/findByTags` (no
    // placeholders, deprecated) wins over `/pet/{petId}` (one
    // placeholder, NOT deprecated). Iteration order doesn't matter.
    const apiDoc = makeApiDoc([
      makeOp('/pet/{petId}'),
      makeOp('/pet/findByTags', { deprecated: true })
    ])
    const req = makeRequest('r-tags', 'Finds Pets by tags', '{{baseUrl}}/pet/findByTags')
    const env = makeEnvFolder({
      id: 'env-1',
      apiDoc,
      variables: { baseUrl: 'https://api.example.com' },
      items: [req]
    })
    const { result } = renderHook(() => useDeprecatedRequestIds([env]))
    expect(result.current.has('r-tags')).toBe(true)
  })

  it('skips a request when its URL no longer matches any operation', () => {
    const apiDoc = makeApiDoc([makeOp('/pet/findByTags', { deprecated: true })])
    const req = makeRequest('r-edited', 'edited URL', '{{baseUrl}}/animal/findByTags')
    const env = makeEnvFolder({
      id: 'env-1',
      apiDoc,
      variables: { baseUrl: 'https://api.example.com' },
      items: [req]
    })
    const { result } = renderHook(() => useDeprecatedRequestIds([env]))
    expect(result.current.has('r-edited')).toBe(false)
  })

  it('resolves composed env-vars (`baseUrl = {{scheme}}://{{host}}{{baseRoute}}`) before matching', () => {
    const apiDoc = makeApiDoc([makeOp('/pet/findByTags', { deprecated: true })])
    const req = makeRequest('r-tags', 'Finds Pets by tags', '{{baseUrl}}/pet/findByTags')
    const env = makeEnvFolder({
      id: 'env-1',
      apiDoc,
      variables: {
        scheme: 'https',
        host: 'api.example.com',
        baseRoute: '/v2',
        // baseUrl itself is templated — flatten resolves it
        // iteratively before the matcher runs, otherwise the URL
        // fallback path strips the literal `{{baseUrl}}` and the
        // pattern can't ride the basePath.
        baseUrl: '{{scheme}}://{{host}}{{baseRoute}}'
      },
      items: [req]
    })
    const { result } = renderHook(() => useDeprecatedRequestIds([env]))
    expect(result.current.has('r-tags')).toBe(true)
  })

  it('ignores a non-deprecated match', () => {
    const apiDoc = makeApiDoc([makeOp('/pet/findByStatus')])
    const req = makeRequest('r-ok', 'status', '{{baseUrl}}/pet/findByStatus')
    const env = makeEnvFolder({
      id: 'env-1',
      apiDoc,
      variables: { baseUrl: 'https://api.example.com' },
      items: [req]
    })
    const { result } = renderHook(() => useDeprecatedRequestIds([env]))
    expect(result.current.size).toBe(0)
  })

  it('returns an empty set for env folders without an apiDocumentation', () => {
    const req = makeRequest('r-x', 'orphan', '{{baseUrl}}/pet/findByTags')
    const env = makeEnvFolder({ id: 'env-1', items: [req] })
    const { result } = renderHook(() => useDeprecatedRequestIds([env]))
    expect(result.current.size).toBe(0)
  })

  it('descends into nested folders', () => {
    const apiDoc = makeApiDoc([makeOp('/pet/findByTags', { deprecated: true })])
    const req = makeRequest('r-deep', 'Finds Pets by tags', '{{baseUrl}}/pet/findByTags')
    const innerFolder: Folder = {
      id: 'pet-folder',
      name: 'pet',
      documentation: '',
      tags: [],
      configuration: {},
      items: [req]
    } as unknown as Folder
    const env = makeEnvFolder({
      id: 'env-1',
      apiDoc,
      variables: { baseUrl: 'https://api.example.com' },
      items: [innerFolder]
    })
    const { result } = renderHook(() => useDeprecatedRequestIds([env]))
    expect(result.current.has('r-deep')).toBe(true)
  })

  it('re-runs the matcher when updateCount bumps', () => {
    // The renderer increments `updateCount` on every in-place
    // mutation (URL edits, etc.) so the memo recomputes even when
    // the rootItems array reference itself is stable.
    const apiDoc = makeApiDoc([makeOp('/pet/findByTags', { deprecated: true })])
    const req = makeRequest('r-tags', 'tags', '{{baseUrl}}/pet/findByTags')
    const env = makeEnvFolder({
      id: 'env-1',
      apiDoc,
      variables: { baseUrl: 'https://api.example.com' },
      items: [req]
    })
    const items = [env]
    const { result, rerender } = renderHook(({ count }: { count: number }) => useDeprecatedRequestIds(items, count), {
      initialProps: { count: 0 }
    })
    const first = result.current
    expect(first.has('r-tags')).toBe(true)

    // Same `items` ref + same count → memo holds.
    rerender({ count: 0 })
    expect(result.current).toBe(first)

    // Bump count → memo invalidates and re-runs (still gets the
    // same answer because nothing actually changed in the tree, but
    // the recomputation is the contract — the renderer relies on it
    // to pick up reactive-proxy URL edits).
    rerender({ count: 1 })
    expect(result.current).not.toBe(first)
    expect(result.current.has('r-tags')).toBe(true)
  })
})
