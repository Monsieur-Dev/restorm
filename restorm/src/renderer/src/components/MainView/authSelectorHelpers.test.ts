import { describe, it, expect } from 'vitest'
import type { FolderItem } from '../../../../shared/types/collections'
import { collectInScopeAuthRequests } from './authSelectorHelpers'

// Minimal structural fixtures — the helper only relies on the type-guards
// (`isRequest` = has `type`, no `items`; `isAuthenticationRequest` = type
// 'auth'; `isAnyFolder` = has `items` + `configuration`). We cast to
// FolderItem so the test stays focused on the scope-walk logic, not on
// constructing fully-populated model objects.
const authReq = (id: string): FolderItem =>
  ({ id, type: 'auth', name: id } as unknown as FolderItem)
const httpReq = (id: string): FolderItem =>
  ({ id, type: 'http', name: id } as unknown as FolderItem)
const folder = (id: string, items: FolderItem[]): FolderItem =>
  ({ id, name: id, configuration: {}, items } as unknown as FolderItem)

describe('collectInScopeAuthRequests', () => {
  it('includes an auth route in the request\'s own folder', () => {
    const tree = [folder('f', [authReq('a1'), httpReq('r')])]
    expect(collectInScopeAuthRequests(tree, 'r').map((x) => x.id)).toEqual(['a1'])
  })

  it('includes auth routes from ancestor folders up the path', () => {
    const tree = [
      authReq('root-auth'),
      folder('outer', [
        authReq('outer-auth'),
        folder('inner', [authReq('inner-auth'), httpReq('r')])
      ])
    ]
    expect(collectInScopeAuthRequests(tree, 'r').map((x) => x.id))
      .toEqual(['root-auth', 'outer-auth', 'inner-auth'])
  })

  it('excludes auth routes in sibling / unrelated branches', () => {
    const tree = [
      folder('sibling', [authReq('sibling-auth')]),
      folder('mine', [authReq('mine-auth'), httpReq('r')])
    ]
    expect(collectInScopeAuthRequests(tree, 'r').map((x) => x.id)).toEqual(['mine-auth'])
  })

  it('returns an empty list when no in-scope auth route exists', () => {
    const tree = [folder('mine', [httpReq('r')]), folder('other', [authReq('other-auth')])]
    expect(collectInScopeAuthRequests(tree, 'r')).toEqual([])
  })

  it('returns an empty list when the request is not found', () => {
    const tree = [folder('f', [authReq('a1'), httpReq('x')])]
    expect(collectInScopeAuthRequests(tree, 'missing')).toEqual([])
  })

  it('finds a request at the top level', () => {
    const tree = [authReq('a1'), httpReq('r')]
    expect(collectInScopeAuthRequests(tree, 'r').map((x) => x.id)).toEqual(['a1'])
  })
})
