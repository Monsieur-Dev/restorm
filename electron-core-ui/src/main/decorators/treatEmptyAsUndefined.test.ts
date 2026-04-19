import { describe, it, expect } from 'vitest'
import {
  TreatEmptyAsUndefined,
  isTreatedEmptyAsUndefined,
  getTreatEmptyAsUndefinedProperties,
  normalizeTreatEmptyAsUndefined
} from './treatEmptyAsUndefined'

/**
 * Project config disables TS's experimental decorators, so the `@` syntax
 * won't parse inside test files. Emulate what the legacy transform would
 * emit: call the decorator factory and apply it to the class prototype.
 */
function applyDecorator(cls: object, propertyKey: string): void {
  TreatEmptyAsUndefined()((cls as { prototype: object }).prototype, propertyKey)
}

class Note {
  body: string | null | undefined = undefined
  summary: string | null | undefined = undefined
  title = ''
}
applyDecorator(Note, 'body')
applyDecorator(Note, 'summary')

class NothingMarked {
  body: string | null | undefined = undefined
}

describe('TreatEmptyAsUndefined — metadata', () => {
  it('marks the decorated property', () => {
    expect(isTreatedEmptyAsUndefined(Note, 'body')).toBe(true)
    expect(isTreatedEmptyAsUndefined(Note, 'summary')).toBe(true)
  })

  it('does not mark unannotated properties', () => {
    expect(isTreatedEmptyAsUndefined(Note, 'title')).toBe(false)
    expect(isTreatedEmptyAsUndefined(NothingMarked, 'body')).toBe(false)
  })

  it('lists every marked property on the class', () => {
    const props = getTreatEmptyAsUndefinedProperties(Note)
    expect(props).toEqual(new Set(['body', 'summary']))
  })

  it('returns an empty set for a class with no marked properties', () => {
    expect(getTreatEmptyAsUndefinedProperties(NothingMarked).size).toBe(0)
  })
})

describe('normalizeTreatEmptyAsUndefined', () => {
  it('collapses null to undefined on marked props', () => {
    const out = normalizeTreatEmptyAsUndefined({ body: null, title: 't' }, Note)
    expect(out).toEqual({ body: undefined, title: 't' })
  })

  it('collapses "" to undefined on marked props', () => {
    const out = normalizeTreatEmptyAsUndefined({ body: '', title: 't' }, Note)
    expect(out['body']).toBeUndefined()
  })

  it('leaves undefined untouched (still undefined) on marked props', () => {
    const out = normalizeTreatEmptyAsUndefined({ body: undefined, title: 't' }, Note)
    expect(out['body']).toBeUndefined()
  })

  it('does NOT collapse whitespace-only strings', () => {
    const out = normalizeTreatEmptyAsUndefined({ body: '   ' }, Note)
    expect(out['body']).toBe('   ')
  })

  it('does NOT collapse a single space', () => {
    const out = normalizeTreatEmptyAsUndefined({ body: ' ' }, Note)
    expect(out['body']).toBe(' ')
  })

  it('does NOT trim non-empty strings', () => {
    const out = normalizeTreatEmptyAsUndefined({ body: '  abc  ' }, Note)
    expect(out['body']).toBe('  abc  ')
  })

  it('does NOT touch plain non-empty strings', () => {
    const out = normalizeTreatEmptyAsUndefined({ body: 'abc' }, Note)
    expect(out['body']).toBe('abc')
  })

  it('does NOT touch unmarked properties even when empty', () => {
    const out = normalizeTreatEmptyAsUndefined({ body: '', title: '' }, Note)
    expect(out['body']).toBeUndefined()
    expect(out['title']).toBe('')
  })

  it('does NOT normalize non-string values (leaves them untouched)', () => {
    const out = normalizeTreatEmptyAsUndefined({ body: 0, summary: false }, Note)
    expect(out['body']).toBe(0)
    expect(out['summary']).toBe(false)
  })

  it('returns the input as-is when no property is marked', () => {
    const input = { body: '', title: 't' }
    expect(normalizeTreatEmptyAsUndefined(input, NothingMarked)).toBe(input)
  })

  it('does not mutate the input object', () => {
    const input = { body: '', title: 't' }
    const out = normalizeTreatEmptyAsUndefined(input, Note)
    expect(input.body).toBe('')
    expect(out).not.toBe(input)
  })
})
