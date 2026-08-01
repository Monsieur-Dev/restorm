import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useRestormStore } from './restormStore'

// Main's stale-write guard is `clientVersion !== undefined && clientVersion <
// modelVersion`, so an UNSTAMPED mirror skips the check entirely and overwrites
// whatever main holds. Every mirror this store sends must therefore carry a
// version — callers that know the version their tree was built from pass it,
// and the rest fall back to the last version this renderer applied.

type SyncCall = [unknown[], number | undefined]

function installApi(): SyncCall[] {
  const calls: SyncCall[] = []
  ;(window as unknown as { restorm?: unknown }).restorm = {
    apiUpdate: {
      syncCollections: (collections: unknown[], mcpVersion?: number) => {
        calls.push([collections, mcpVersion])
        return Promise.resolve()
      }
    }
  }
  return calls
}

describe('restormStore — every mirror carries a version', () => {
  beforeEach(() => {
    useRestormStore.setState({ collections: [], lastMcpVersion: 0 })
  })

  afterEach(() => {
    ;(window as unknown as { restorm?: unknown }).restorm = undefined
    vi.restoreAllMocks()
  })

  it('stamps an unstamped mirror with the last applied version', () => {
    const calls = installApi()
    useRestormStore.getState().setLastMcpVersion(4)

    // A caller that holds a fresh tree but has no access to the version — the
    // in-place-proxy re-mirror path.
    useRestormStore.getState().setCollections([], 'user')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.[1]).toBe(4)
  })

  it('prefers an explicit version over the stored one', () => {
    const calls = installApi()
    useRestormStore.getState().setLastMcpVersion(4)

    // A caller that knows the version ITS tree was built from must win: that
    // is a stronger claim than "as fresh as the last replace we saw".
    useRestormStore.getState().setCollections([], 'user', 2)

    expect(calls[0]?.[1]).toBe(2)
  })

  it('never sends an unstamped mirror, even before any version was applied', () => {
    const calls = installApi()
    useRestormStore.getState().setCollections([], 'user')
    expect(calls[0]?.[1]).toBe(0)
    expect(calls[0]?.[1]).not.toBeUndefined()
  })

  it('skips the mirror entirely for an MCP-sourced change', () => {
    const calls = installApi()
    useRestormStore.getState().setCollections([], 'mcp')
    expect(calls).toHaveLength(0)
  })
})
