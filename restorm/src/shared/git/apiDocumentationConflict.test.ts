import { describe, it, expect } from 'vitest'
import { resolveApiDocumentationConflict } from './apiDocumentationConflict'
import type { ApiDocumentation } from '../types/apiDocumentation'

function makeDoc(version: string | undefined): ApiDocumentation {
  return {
    sourceType: 'openapi',
    api: { title: 'Petstore', version },
    models: {},
    groups: {},
    operations: []
  } as unknown as ApiDocumentation
}

describe('resolveApiDocumentationConflict', () => {
  it('picks the higher dotted-numeric version', () => {
    const ours = makeDoc('1.2.3')
    const theirs = makeDoc('1.3.0')
    expect(resolveApiDocumentationConflict(ours, theirs)).toBe(theirs)
    expect(resolveApiDocumentationConflict(theirs, ours)).toBe(theirs)
  })

  it('compares numerically, not lexicographically (1.2.10 > 1.2.9)', () => {
    const ours = makeDoc('1.2.9')
    const theirs = makeDoc('1.2.10')
    expect(resolveApiDocumentationConflict(ours, theirs)).toBe(theirs)
  })

  it('treats differently-lengthed but equal versions as equal (1.2 == 1.2.0)', () => {
    const ours = makeDoc('1.2')
    const theirs = makeDoc('1.2.0')
    // Equal version → falls through to the timestamp tie-breaker; with none
    // provided, keeps ours (the stable default).
    expect(resolveApiDocumentationConflict(ours, theirs)).toBe(ours)
  })

  it('falls back to the newer commit timestamp when versions are equal', () => {
    const ours = makeDoc('2.0.0')
    const theirs = makeDoc('2.0.0')
    expect(resolveApiDocumentationConflict(ours, theirs, { ours: 100, theirs: 200 })).toBe(theirs)
    expect(resolveApiDocumentationConflict(ours, theirs, { ours: 300, theirs: 200 })).toBe(ours)
  })

  it('falls back to the newer commit timestamp when a version is missing', () => {
    const ours = makeDoc(undefined)
    const theirs = makeDoc('1.0.0')
    // No confident version signal (ours has none) → timestamp decides.
    expect(resolveApiDocumentationConflict(ours, theirs, { ours: 500, theirs: 100 })).toBe(ours)
    expect(resolveApiDocumentationConflict(ours, theirs, { ours: 100, theirs: 500 })).toBe(theirs)
  })

  it('falls back to the newer commit timestamp when a version string is not dotted-numeric', () => {
    const ours = makeDoc('1.0.0-beta')
    const theirs = makeDoc('1.0.0')
    expect(resolveApiDocumentationConflict(ours, theirs, { ours: 100, theirs: 200 })).toBe(theirs)
  })

  it('keeps ours when versions are equal/absent AND no timestamp signal is available', () => {
    const ours = makeDoc(undefined)
    const theirs = makeDoc(undefined)
    expect(resolveApiDocumentationConflict(ours, theirs)).toBe(ours)
    expect(resolveApiDocumentationConflict(ours, theirs, { ours: null, theirs: null })).toBe(ours)
  })

  it('returns whichever side is defined when the other is entirely absent', () => {
    const doc = makeDoc('1.0.0')
    expect(resolveApiDocumentationConflict(doc, undefined)).toBe(doc)
    expect(resolveApiDocumentationConflict(undefined, doc)).toBe(doc)
    expect(resolveApiDocumentationConflict(undefined, undefined)).toBeUndefined()
  })
})
