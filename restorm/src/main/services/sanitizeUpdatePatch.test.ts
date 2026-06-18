import { describe, it, expect } from 'vitest'
import { sanitizeUpdatePatch } from './sanitizeUpdatePatch'

describe('sanitizeUpdatePatch', () => {
  it('drops the id key so a patch cannot re-key the node', () => {
    const out = sanitizeUpdatePatch({ id: 'evil', name: 'New name' })
    expect(out).toEqual({ name: 'New name' })
    expect('id' in out).toBe(false)
  })

  it('drops extra forbidden structural keys (items) for folder/scenario', () => {
    const out = sanitizeUpdatePatch({ id: 'x', items: [{}, {}], name: 'F' }, ['items'])
    expect(out).toEqual({ name: 'F' })
  })

  it('keeps legitimate scalar + config fields', () => {
    const out = sanitizeUpdatePatch({ name: 'n', notes: 'note', tags: ['a'], configuration: { x: 1 } })
    expect(out).toEqual({ name: 'n', notes: 'note', tags: ['a'], configuration: { x: 1 } })
  })

  it('returns a fresh object (does not mutate the input)', () => {
    const input = { id: 'x', name: 'n' }
    const out = sanitizeUpdatePatch(input)
    expect(out).not.toBe(input)
    expect(input.id).toBe('x')
  })
})
