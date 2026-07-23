import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGitUpdateGate } from './useGitUpdateGate'

const FOLDER = '/repo'
const REL = 'api.restorm'

/** A single-file project carrying one request, whose URL is the field the
 * two sides fight over in the conflicting cases below. */
function projectYaml(requestUrl: string, extraRequest?: { id: string; url: string }): string {
  const extra = extraRequest
    ? `
      - id: ${extraRequest.id}
        name: Second request
        type: http
        tags: []
        method: GET
        url: ${extraRequest.url}
        headers: []
        params: []
        pathParams: []`
    : ''
  return `_projectUuid: gate-test
collections:
  - id: env-folder
    name: Project
    tags: []
    configuration: {}
    folderType: environment
    environments: []
    items:
      - id: request-1
        name: First request
        type: http
        tags: []
        method: GET
        url: ${requestUrl}
        headers: []
        params: []
        pathParams: []${extra}
`
}

interface GitApiMock {
  fetchAndCompare: ReturnType<typeof vi.fn>
  getFileAtMergeBase: ReturnType<typeof vi.fn>
  getFileAtRemote: ReturnType<typeof vi.fn>
  getWorkingTreeFile: ReturnType<typeof vi.fn>
}

function installApi(git: Partial<GitApiMock>, readFile: () => Promise<string>): GitApiMock {
  const api: GitApiMock = {
    fetchAndCompare: vi.fn(),
    getFileAtMergeBase: vi.fn(),
    getFileAtRemote: vi.fn(),
    getWorkingTreeFile: vi.fn(readFile),
    ...git
  } as GitApiMock
  ;(globalThis as unknown as { window: unknown }).window = { api: { git: api } }
  return api
}

describe('useGitUpdateGate', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('reports nothing to do when the remote has no newer version', async () => {
    const api = installApi(
      { fetchAndCompare: vi.fn().mockResolvedValue({ remoteHasNewerVersion: false, behind: 0 }) },
      () => Promise.resolve(projectYaml('https://mine'))
    )
    const { result } = renderHook(() => useGitUpdateGate())

    const gate = await result.current.checkForUpdate(FOLDER, REL)

    expect(gate).toEqual({ behind: 0, conflicts: [], versions: null })
    // The three reads are only paid for when we're actually behind.
    expect(api.getFileAtMergeBase).not.toHaveBeenCalled()
    expect(api.getFileAtRemote).not.toHaveBeenCalled()
  })

  it('reports behind with NO conflict when the two sides touched different requests', async () => {
    // Base has both requests untouched; we edited request-1, they added
    // a different value on request-2 — entity-level, that is not a fight.
    installApi(
      {
        fetchAndCompare: vi.fn().mockResolvedValue({ remoteHasNewerVersion: true, behind: 2 }),
        getFileAtMergeBase: vi.fn().mockResolvedValue(projectYaml('https://base', { id: 'request-2', url: 'https://base-2' })),
        getFileAtRemote: vi.fn().mockResolvedValue(projectYaml('https://base', { id: 'request-2', url: 'https://theirs-2' }))
      },
      () => Promise.resolve(projectYaml('https://mine', { id: 'request-2', url: 'https://base-2' }))
    )
    const { result } = renderHook(() => useGitUpdateGate())

    const gate = await result.current.checkForUpdate(FOLDER, REL)

    expect(gate.behind).toBe(2)
    expect(gate.conflicts).toEqual([])
  })

  it('reports the conflicting entity when both sides changed the same request', async () => {
    installApi(
      {
        fetchAndCompare: vi.fn().mockResolvedValue({ remoteHasNewerVersion: true, behind: 1 }),
        getFileAtMergeBase: vi.fn().mockResolvedValue(projectYaml('https://base')),
        getFileAtRemote: vi.fn().mockResolvedValue(projectYaml('https://theirs'))
      },
      () => Promise.resolve(projectYaml('https://mine'))
    )
    const { result } = renderHook(() => useGitUpdateGate())

    const gate = await result.current.checkForUpdate(FOLDER, REL)

    expect(gate.behind).toBe(1)
    expect(gate.conflicts).toHaveLength(1)
    expect(gate.conflicts[0]).toMatchObject({ id: 'request-1', kind: 'request', name: 'First request' })
  })

  it('surfaces a fetch failure instead of pretending the repo is up to date', async () => {
    installApi(
      { fetchAndCompare: vi.fn().mockResolvedValue({ remoteHasNewerVersion: false, behind: 0, error: 'host unreachable' }) },
      () => Promise.resolve(projectYaml('https://mine'))
    )
    const { result } = renderHook(() => useGitUpdateGate())

    const gate = await result.current.checkForUpdate(FOLDER, REL)

    expect(gate.error).toBe('host unreachable')
  })

  it('treats a file absent from the upstream as a conflict-free update', async () => {
    installApi(
      {
        fetchAndCompare: vi.fn().mockResolvedValue({ remoteHasNewerVersion: true, behind: 3 }),
        getFileAtMergeBase: vi.fn().mockResolvedValue(projectYaml('https://base')),
        getFileAtRemote: vi.fn().mockResolvedValue(null)
      },
      () => Promise.resolve(projectYaml('https://mine'))
    )
    const { result } = renderHook(() => useGitUpdateGate())

    const gate = await result.current.checkForUpdate(FOLDER, REL)

    expect(gate).toMatchObject({ behind: 3, conflicts: [], versions: null })
  })

  it('refuses to judge when the working copy reads back empty', async () => {
    // A failed read must never look like "the user has no content": that
    // reads as "nothing of mine conflicts" and makes the merge adopt the
    // server's version wholesale, silently destroying their work.
    installApi(
      {
        fetchAndCompare: vi.fn().mockResolvedValue({ remoteHasNewerVersion: true, behind: 1 }),
        getFileAtMergeBase: vi.fn().mockResolvedValue(projectYaml('https://base')),
        getFileAtRemote: vi.fn().mockResolvedValue(projectYaml('https://theirs'))
      },
      () => Promise.resolve('')
    )
    const { result } = renderHook(() => useGitUpdateGate())

    const gate = await result.current.checkForUpdate(FOLDER, REL)

    expect(gate.versions).toBeNull()
    expect(gate.conflicts).toEqual([])
    expect(gate.error).toBeDefined()
  })
})

describe('the base side of the three-way merge', () => {
  it('comes from the merge base, so a commit of ours is not mistaken for the ancestor', async () => {
    // HEAD and the merge base coincide only while nothing is committed
    // locally. With a commit of our own, HEAD already holds our work, so
    // our side would read as "unchanged since the base" and the merge
    // would quietly revert it to the server's — losing committed work.
    // Here base and ours agree (that IS the committed-work shape) while
    // theirs differs: with the true ancestor this is one-sided and no
    // conflict is raised.
    const api = installApi(
      {
        fetchAndCompare: vi.fn().mockResolvedValue({ remoteHasNewerVersion: true, behind: 1 }),
        getFileAtMergeBase: vi.fn().mockResolvedValue(projectYaml('https://mine')),
        getFileAtRemote: vi.fn().mockResolvedValue(projectYaml('https://theirs'))
      },
      () => Promise.resolve(projectYaml('https://mine'))
    )
    const { result } = renderHook(() => useGitUpdateGate())

    const gate = await result.current.checkForUpdate('/proj', 'api.restorm')

    expect(api.getFileAtMergeBase).toHaveBeenCalledWith('/proj', 'api.restorm')
    expect(gate.conflicts).toEqual([])
  })
})
