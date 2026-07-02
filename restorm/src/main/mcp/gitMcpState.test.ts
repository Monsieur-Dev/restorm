import { describe, it, expect, afterEach } from 'vitest'
import {
  setPendingCommitReview,
  getPendingCommitReview,
  clearPendingCommitReview,
  setPendingConflictResolution,
  getPendingConflictResolution,
  clearPendingConflictResolution,
  resetGitMcpStateForTests
} from './gitMcpState'

afterEach(() => { resetGitMcpStateForTests() })

describe('pending commit review', () => {
  it('is null before anything is set', () => {
    expect(getPendingCommitReview()).toBeNull()
  })

  it('stamps a fresh token and stores it as the pending review', () => {
    const stored = setPendingCommitReview({ gitFolder: '/proj', relativePath: 'api.restorm', changes: [], title: 'T', body: 'B' })
    expect(stored.token).toBeTruthy()
    expect(getPendingCommitReview()).toEqual(stored)
  })

  it('a new call overwrites (invalidates) the previous pending review', () => {
    const first = setPendingCommitReview({ gitFolder: '/proj', relativePath: 'api.restorm', changes: [], title: 'T1', body: 'B1' })
    const second = setPendingCommitReview({ gitFolder: '/proj', relativePath: 'api.restorm', changes: [], title: 'T2', body: 'B2' })
    expect(getPendingCommitReview()).toEqual(second)
    expect(getPendingCommitReview()?.token).not.toBe(first.token)
  })

  it('clear resets to null', () => {
    setPendingCommitReview({ gitFolder: '/proj', relativePath: 'api.restorm', changes: [], title: 'T', body: 'B' })
    clearPendingCommitReview()
    expect(getPendingCommitReview()).toBeNull()
  })

  it('two consecutive calls never produce the same token', () => {
    const a = setPendingCommitReview({ gitFolder: '/proj', relativePath: 'api.restorm', changes: [], title: 'T', body: 'B' })
    const b = setPendingCommitReview({ gitFolder: '/proj', relativePath: 'api.restorm', changes: [], title: 'T', body: 'B' })
    expect(a.token).not.toBe(b.token)
  })
})

describe('pending conflict resolution', () => {
  const versions = { path: 'api.restorm', base: null, ours: 'ours-yaml', theirs: 'theirs-yaml' }
  const commitTimestamps = { ours: null, theirs: null }

  it('is null before anything is set', () => {
    expect(getPendingConflictResolution()).toBeNull()
  })

  it('stamps a fresh token and stores it as the pending resolution', () => {
    const stored = setPendingConflictResolution({ gitFolder: '/proj', relativePath: 'api.restorm', versions, conflicts: [], commitTimestamps })
    expect(stored.token).toBeTruthy()
    expect(getPendingConflictResolution()).toEqual(stored)
  })

  it('a new git_pull overwrites (invalidates) the previous pending resolution', () => {
    const first = setPendingConflictResolution({ gitFolder: '/proj', relativePath: 'api.restorm', versions, conflicts: [], commitTimestamps })
    const second = setPendingConflictResolution({ gitFolder: '/proj', relativePath: 'api.restorm', versions, conflicts: [], commitTimestamps })
    expect(getPendingConflictResolution()).toEqual(second)
    expect(getPendingConflictResolution()?.token).not.toBe(first.token)
  })

  it('clear resets to null', () => {
    setPendingConflictResolution({ gitFolder: '/proj', relativePath: 'api.restorm', versions, conflicts: [], commitTimestamps })
    clearPendingConflictResolution()
    expect(getPendingConflictResolution()).toBeNull()
  })
})

describe('resetGitMcpStateForTests', () => {
  it('clears both pending slots at once', () => {
    setPendingCommitReview({ gitFolder: '/proj', relativePath: 'api.restorm', changes: [], title: 'T', body: 'B' })
    setPendingConflictResolution({
      gitFolder: '/proj',
      relativePath: 'api.restorm',
      versions: { path: 'api.restorm', base: null, ours: null, theirs: null },
      conflicts: [],
      commitTimestamps: { ours: null, theirs: null }
    })
    resetGitMcpStateForTests()
    expect(getPendingCommitReview()).toBeNull()
    expect(getPendingConflictResolution()).toBeNull()
  })
})
