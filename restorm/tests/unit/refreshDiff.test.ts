import { describe, it, expect } from 'vitest'
import { resolveRefreshDiff, defaultDecisionFor } from '../../src/main/services/apiUpdate/refreshDiff'
import type { NormalizedSpec } from '../../src/main/services/import/idempotent/types'
import type { ImportSelectionSnapshot } from '../../src/shared/types/baseTypes'

function spec(operations: { naturalKey: string }[], version?: string): NormalizedSpec {
  return {
    ...(version !== undefined ? { version } : {}),
    operations: operations.map(({ naturalKey }) => ({
      naturalKey,
      name: naturalKey,
      deprecated: false,
      shape: { protocol: 'http', method: 'GET', url: '/x', parameters: [] }
    })),
    models: [],
    enums: [],
    environments: []
  }
}

function snapshot(imported: string[], skipped: string[] = []): ImportSelectionSnapshot {
  return {
    capturedAt: 0,
    source: 'https://x',
    imported,
    skipped
  }
}

describe('resolveRefreshDiff', () => {
  it('classifies a fully untouched delta correctly', () => {
    const diff = resolveRefreshDiff({
      oldSnapshot: snapshot(['GET /a', 'GET /b']),
      newSpec: spec([{ naturalKey: 'GET /a' }, { naturalKey: 'GET /b' }])
    })
    expect(diff.counts).toEqual({ unchanged: 2, added: 0, modified: 0, removed: 0, previouslySkipped: 0 })
  })

  it('classifies a brand-new operation as `added`', () => {
    const diff = resolveRefreshDiff({
      oldSnapshot: snapshot(['GET /a']),
      newSpec: spec([{ naturalKey: 'GET /a' }, { naturalKey: 'GET /new' }])
    })
    expect(diff.byNaturalKey.get('GET /new')).toBe('added')
    expect(diff.counts.added).toBe(1)
  })

  it('classifies an operation the user previously skipped as `previouslySkipped`', () => {
    // Pin the OYO-257 carry-over: the user said no last time, the
    // wizard should NOT default it back to imported. Without this,
    // every refresh would silently undo the user's skip decisions.
    const diff = resolveRefreshDiff({
      oldSnapshot: snapshot(['GET /a'], ['GET /skipped']),
      newSpec: spec([{ naturalKey: 'GET /a' }, { naturalKey: 'GET /skipped' }])
    })
    expect(diff.byNaturalKey.get('GET /skipped')).toBe('previouslySkipped')
  })

  it('classifies a vanished operation as `removed`', () => {
    const diff = resolveRefreshDiff({
      oldSnapshot: snapshot(['GET /a', 'GET /gone']),
      newSpec: spec([{ naturalKey: 'GET /a' }])
    })
    expect(diff.byNaturalKey.get('GET /gone')).toBe('removed')
    expect(diff.counts.removed).toBe(1)
  })

  it('classifies a content-changed operation as `modified` when fingerprints diverge', () => {
    const diff = resolveRefreshDiff({
      oldSnapshot: snapshot(['GET /a']),
      newSpec: spec([{ naturalKey: 'GET /a' }]),
      fingerprintBySnapshotKey: new Map([['GET /a', 'fp:v1']]),
      fingerprintBySpecKey: new Map([['GET /a', 'fp:v2']])
    })
    expect(diff.byNaturalKey.get('GET /a')).toBe('modified')
    expect(diff.counts.modified).toBe(1)
  })

  it('does not classify `modified` when only one side has a fingerprint', () => {
    // Pin the conservative classification: missing data on one side
    // collapses to `unchanged`, not a false-positive `modified`. A
    // first-ever refresh that hasn't yet stored fingerprints would
    // otherwise flag every operation as modified.
    const diff = resolveRefreshDiff({
      oldSnapshot: snapshot(['GET /a']),
      newSpec: spec([{ naturalKey: 'GET /a' }]),
      fingerprintBySpecKey: new Map([['GET /a', 'fp:v2']])
    })
    expect(diff.byNaturalKey.get('GET /a')).toBe('unchanged')
  })

  it('treats every spec operation as `added` when no snapshot exists', () => {
    // First-ever refresh on a folder OYO-257 didn't capture; safest
    // default is "import everything", same as the initial-import
    // pathway.
    const diff = resolveRefreshDiff({
      oldSnapshot: undefined,
      newSpec: spec([{ naturalKey: 'GET /a' }, { naturalKey: 'GET /b' }])
    })
    expect(diff.counts).toEqual({ added: 2, unchanged: 0, modified: 0, removed: 0, previouslySkipped: 0 })
  })

  it('extracts newVersion from the spec', () => {
    const diff = resolveRefreshDiff({
      oldSnapshot: snapshot([]),
      newSpec: spec([], '2.0.0')
    })
    expect(diff.newVersion).toBe('2.0.0')
  })
})

describe('defaultDecisionFor', () => {
  it('checks added / modified / unchanged by default', () => {
    expect(defaultDecisionFor('added')).toBe(true)
    expect(defaultDecisionFor('modified')).toBe(true)
    expect(defaultDecisionFor('unchanged')).toBe(true)
  })

  it('unchecks removed / previouslySkipped by default', () => {
    expect(defaultDecisionFor('removed')).toBe(false)
    expect(defaultDecisionFor('previouslySkipped')).toBe(false)
  })
})
