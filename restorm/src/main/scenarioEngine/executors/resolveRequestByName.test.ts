import { describe, it, expect } from 'vitest'
import { resolveRequestByName } from './resolveRequestByName'

// Minimal tree shapes: a folder carries `items`; an http request carries
// `type:'http'` + id + name + method (the only fields the resolver reads / the
// `isHTTPRequest` guard checks).
const req = (id: string, name: string, method = 'GET'): unknown => ({ type: 'http', id, name, method })
const folder = (name: string, items: unknown[]): unknown => ({ name, configuration: {}, items })

describe('resolveRequestByName', () => {
  const tree = [
    folder('Auth', [req('r-login', 'Login', 'POST'), req('r-refresh', 'Refresh')]),
    req('r-top-login', 'Login'),               // a second "Login" at the root
    req('r-slash', 'weird/name'),              // a request whose NAME contains a slash
    folder('Pets', [req('r-get', 'Get Pet')])
  ]

  it('resolves a bare name of a nested request via the leaf tier', () => {
    // "Refresh" only exists inside Auth (path "Auth/Refresh"); a bare reference
    // resolves it by leaf name.
    expect(resolveRequestByName(tree, 'Refresh')).toEqual({ id: 'r-refresh', method: 'GET' })
  })

  it('a bare name prefers a ROOT request (path == name) over a same-named nested one', () => {
    // Two "Login" exist: nested Auth/Login and root-level Login. A bare "Login"
    // matches the root request at the path tier (its path IS "Login") — more
    // specific than a nested leaf collision.
    expect(resolveRequestByName(tree, 'Login')).toEqual({ id: 'r-top-login', method: 'GET' })
  })

  it('resolves a collection-relative folder/req path (most specific)', () => {
    expect(resolveRequestByName(tree, 'Auth/Login')).toEqual({ id: 'r-login', method: 'POST' })
    expect(resolveRequestByName(tree, 'Pets/Get Pet')).toEqual({ id: 'r-get', method: 'GET' })
  })

  it('resolves a request whose NAME literally contains a slash (no blind split)', () => {
    // The bug being fixed: `weird/name` must NOT be reduced to leaf `name`.
    expect(resolveRequestByName(tree, 'weird/name')).toEqual({ id: 'r-slash', method: 'GET' })
  })

  it('resolves by item id', () => {
    expect(resolveRequestByName(tree, 'r-refresh')).toEqual({ id: 'r-refresh', method: 'GET' })
  })

  it('falls back to the requested leaf when the folder segments do not map to the tree', () => {
    // `Some/Other/Path/Get Pet` — no such path, but the leaf `Get Pet` exists.
    expect(resolveRequestByName(tree, 'Some/Other/Path/Get Pet')).toEqual({ id: 'r-get', method: 'GET' })
  })

  it('prefers the full-path match over a same-leaf request elsewhere', () => {
    // `Login` exists at the root too (r-top-login); the path form must win.
    expect(resolveRequestByName(tree, 'Auth/Login')?.id).toBe('r-login')
  })

  it('returns undefined for an unknown target or empty input', () => {
    expect(resolveRequestByName(tree, 'Nope')).toBeUndefined()
    expect(resolveRequestByName(tree, '')).toBeUndefined()
    expect(resolveRequestByName(tree, '   ')).toBeUndefined()
  })

  it('ignores folders and non-http items when matching', () => {
    // 'Auth' is a folder name; it must not resolve to a request.
    expect(resolveRequestByName(tree, 'Auth')).toBeUndefined()
  })
})
