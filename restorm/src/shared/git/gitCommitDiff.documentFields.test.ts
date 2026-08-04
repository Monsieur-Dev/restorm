import { describe, it, expect } from 'vitest'
import { diffDocumentFields, diffProjectEntities, parseProjectDocumentFields } from './gitCommitDiff'

describe('parseProjectDocumentFields', () => {
  it('reads a version declared at the document root', () => {
    expect(parseProjectDocumentFields('fileFormatVersion: 2\ncollections: []\n')).toEqual({ fileFormatVersion: 2 })
  })

  it('reports a document that declares none as unversioned, not as the current version', () => {
    // The distinction is the whole point: "absent" is what makes the first
    // save a reportable transition rather than a silent no-op.
    expect(parseProjectDocumentFields('collections: []\n')).toEqual({})
  })

  it('ignores a version nested on a collection — the root is the only read site', () => {
    expect(parseProjectDocumentFields('collections:\n  - fileFormatVersion: 9\n')).toEqual({})
  })

  it('treats a missing blob as unversioned', () => {
    expect(parseProjectDocumentFields(null)).toEqual({})
  })
})

describe('diffDocumentFields', () => {
  it('reports the first stamp of a previously unversioned file', () => {
    expect(diffDocumentFields({}, { fileFormatVersion: 1 })).toEqual({ kind: 'document', name: '1', action: 'added' })
  })

  it('reports a move between two versions with both sides named', () => {
    expect(diffDocumentFields({ fileFormatVersion: 1 }, { fileFormatVersion: 2 }))
      .toEqual({ kind: 'document', name: '1 → 2', action: 'modified' })
  })

  it('is silent when the version did not move', () => {
    expect(diffDocumentFields({ fileFormatVersion: 1 }, { fileFormatVersion: 1 })).toBeNull()
  })
})

describe('diffProjectEntities — the document is part of the diff', () => {
  it('reports a format stamp even when no entity changed', () => {
    // The defect this guards: a save that only stamps the format produced an
    // empty diff, so the push modal listed nothing and disabled its button on
    // a project git had already marked as modified.
    const changes = diffProjectEntities([], [], { before: {}, after: { fileFormatVersion: 1 } })
    expect(changes).toEqual([{ kind: 'document', name: '1', action: 'added' }])
  })

  it('stays empty when the document fields are unchanged', () => {
    const same = { fileFormatVersion: 1 }
    expect(diffProjectEntities([], [], { before: same, after: same })).toEqual([])
  })

  it('omits the document entirely when the caller passes no fields', () => {
    expect(diffProjectEntities([], [])).toEqual([])
  })
})
