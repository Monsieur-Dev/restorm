// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

const { toasterPushMock } = vi.hoisted(() => ({ toasterPushMock: vi.fn() }))

vi.mock('electron-core-ui/renderer', () => ({
  toasterService: { push: toasterPushMock }
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
// Avoid the real `makeReactiveFolderItem` → `electron-core-ui/renderer`
// barrel (Monaco, doesn't run in jsdom) — same pattern as
// useConflictResolution.test.ts.
vi.mock('../services/conflictEntityClone', () => ({
  cloneEntityForResolution: (item: unknown) => structuredClone(item)
}))

import { useGitPullConflict } from './useGitPullConflict'

const OURS_YAML = [
  '_projectUuid: ours-project-uuid',
  'collections:',
  '  - id: r1',
  '    name: Find pet by ID',
  '    type: http',
  '    tags: []',
  '    url: https://ours.example.com'
].join('\n')

const THEIRS_YAML = [
  'collections:',
  '  - id: r1',
  '    name: Find pet by ID',
  '    type: http',
  '    tags: []',
  '    url: https://theirs.example.com'
].join('\n')

function stubGitApi(overrides: Partial<{
  getConflictVersions: ReturnType<typeof vi.fn>
  getConflictCommitTimestamps: ReturnType<typeof vi.fn>
  writeResolvedConflict: ReturnType<typeof vi.fn>
  commit: ReturnType<typeof vi.fn>
  push: ReturnType<typeof vi.fn>
  abortMerge: ReturnType<typeof vi.fn>
}> = {}): {
  getConflictVersions: ReturnType<typeof vi.fn>
  getConflictCommitTimestamps: ReturnType<typeof vi.fn>
  writeResolvedConflict: ReturnType<typeof vi.fn>
  commit: ReturnType<typeof vi.fn>
  push: ReturnType<typeof vi.fn>
  abortMerge: ReturnType<typeof vi.fn>
} {
  const api = {
    getConflictVersions: overrides.getConflictVersions ?? vi.fn().mockResolvedValue({
      path: 'api.restorm', base: null, ours: OURS_YAML, theirs: THEIRS_YAML
    }),
    getConflictCommitTimestamps: overrides.getConflictCommitTimestamps ?? vi.fn().mockResolvedValue({ ours: null, theirs: null }),
    writeResolvedConflict: overrides.writeResolvedConflict ?? vi.fn().mockResolvedValue(undefined),
    commit: overrides.commit ?? vi.fn().mockResolvedValue({ success: true, commit: 'abc123' }),
    push: overrides.push ?? vi.fn().mockResolvedValue({ success: true }),
    abortMerge: overrides.abortMerge ?? vi.fn().mockResolvedValue(undefined)
  }
  ;(window as unknown as { api: unknown }).api = { git: api }
  return api
}

beforeEach(() => { vi.clearAllMocks() })

afterEach(() => {
  cleanup()
  delete (window as { api?: unknown }).api
})

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

describe('useGitPullConflict', () => {
  it('is closed by default', () => {
    const { result } = renderHook(() => useGitPullConflict())
    expect(result.current.isOpen).toBe(false)
  })

  it('openFromPull fetches the conflict versions and opens with the identified conflicts', async () => {
    const api = stubGitApi()
    const { result } = renderHook(() => useGitPullConflict())
    await act(async () => { await result.current.openFromPull('/proj', 'api.restorm') })

    expect(api.getConflictVersions).toHaveBeenCalledWith('/proj', 'api.restorm')
    expect(result.current.isOpen).toBe(true)
    expect(result.current.conflictResolution.conflicts.map((c) => c.id)).toEqual(['r1'])
  })

  it('openFromPull also fetches the commit timestamps (AC#6 tie-breaker)', async () => {
    const api = stubGitApi({ getConflictCommitTimestamps: vi.fn().mockResolvedValue({ ours: 100, theirs: 200 }) })
    const { result } = renderHook(() => useGitPullConflict())
    await act(async () => { await result.current.openFromPull('/proj', 'api.restorm') })

    expect(api.getConflictCommitTimestamps).toHaveBeenCalledWith('/proj')
  })

  it('close aborts the in-progress merge before hiding the UI — cancelling has no resume path, so leaving MERGE_HEAD behind would strand the user mid-merge', async () => {
    const api = stubGitApi()
    const { result } = renderHook(() => useGitPullConflict())
    await act(async () => { await result.current.openFromPull('/proj', 'api.restorm') })
    act(() => { result.current.close() })

    expect(api.abortMerge).toHaveBeenCalledWith('/proj')
    expect(result.current.isOpen).toBe(false)
  })

  it('close is a no-op before openFromPull has run (no folder to abort a merge in)', () => {
    const api = stubGitApi()
    const { result } = renderHook(() => useGitPullConflict())
    act(() => { result.current.close() })

    expect(api.abortMerge).not.toHaveBeenCalled()
    expect(result.current.isOpen).toBe(false)
  })

  it('finishResolution writes the merged tree back, commits, toasts success, and closes', async () => {
    const api = stubGitApi()
    const { result } = renderHook(() => useGitPullConflict())
    await act(async () => { await result.current.openFromPull('/proj', 'api.restorm') })

    act(() => { result.current.conflictResolution.pickTheirsVersion('r1') })

    await act(async () => { await result.current.finishResolution() })
    await flush()

    expect(api.writeResolvedConflict).toHaveBeenCalledTimes(1)
    const [folder, relativePath, yamlText] = api.writeResolvedConflict.mock.calls[0] as [string, string, string]
    expect(folder).toBe('/proj')
    expect(relativePath).toBe('api.restorm')
    expect(yamlText).toContain('https://theirs.example.com')

    // Scoped to the project file: a commit must never sweep up whatever
    // else the user happens to have dirty in the same repository.
    expect(api.commit).toHaveBeenCalledWith('/proj', 'git.conflictResolvedCommitMessage', ['api.restorm'])
    // Commit+push is atomic: the merge commit must not strand the repo
    // "ahead" with a push pastille the user never asked for.
    expect(api.push).toHaveBeenCalledWith('/proj')
    expect(toasterPushMock).toHaveBeenCalledWith('app', { title: 'git.conflictResolvedTitle', body: 'git.conflictResolvedBody', durationMs: 5000 })
    expect(result.current.isOpen).toBe(false)
  })

  it('finishResolution preserves top-level project fields from `ours` (e.g. `_projectUuid`) — write-back must not rebuild the document from scratch', async () => {
    // Regression test: `writeResolvedConflict` is a raw git write that
    // bypasses `FileService`'s normal uuid-preservation entirely, so if
    // the renderer rebuilds `{ collections: merged }` from nothing it
    // silently drops `_projectUuid` (and any other top-level project
    // field) — the next open then regenerates a fresh uuid, orphaning the
    // DraftStore and changing the project's identity.
    const api = stubGitApi()
    const { result } = renderHook(() => useGitPullConflict())
    await act(async () => { await result.current.openFromPull('/proj', 'api.restorm') })

    act(() => { result.current.conflictResolution.pickTheirsVersion('r1') })

    await act(async () => { await result.current.finishResolution() })
    await flush()

    const [, , yamlText] = api.writeResolvedConflict.mock.calls[0] as [string, string, string]
    expect(yamlText).toContain('_projectUuid: ours-project-uuid')
  })

  it('finishResolution settles a saved configuration independently of the request itself', async () => {
    const oursQc = [
      '_projectUuid: ours-project-uuid',
      'collections:',
      '  - id: r1',
      '    name: Find pet by ID',
      '    type: http',
      '    tags: []',
      '    url: https://ours.example.com',
      '    quickConfigs:',
      '      - id: q1',
      '        name: Staging',
      '        requestId: r1',
      '        storageTarget: project',
      '        fields:',
      '          url: https://ours-staging.example.com',
      '        createdAt: \'\'',
      '        updatedAt: \'\''
    ].join('\n')
    const theirsQc = [
      'collections:',
      '  - id: r1',
      '    name: Find pet by ID',
      '    type: http',
      '    tags: []',
      '    url: https://theirs.example.com',
      '    quickConfigs:',
      '      - id: q2',
      '        name: Staging',
      '        requestId: r1',
      '        storageTarget: project',
      '        fields:',
      '          url: https://theirs-staging.example.com',
      '        createdAt: \'\'',
      '        updatedAt: \'\''
    ].join('\n')
    const api = stubGitApi({
      getConflictVersions: vi.fn().mockResolvedValue({ path: 'api.restorm', base: null, ours: oursQc, theirs: theirsQc })
    })
    const { result } = renderHook(() => useGitPullConflict())
    await act(async () => { await result.current.openFromPull('/proj', 'api.restorm') })

    // Two entries now: the request itself (its own url differs) and the
    // contested saved configuration, each arbitrated on its own.
    expect(result.current.conflictResolution.conflicts.map((c) => c.quickConfigName)).toEqual([undefined, 'Staging'])
    act(() => { result.current.conflictResolution.pickOursVersion('r1') })
    act(() => { result.current.conflictResolution.pickTheirsVersion('r1::quick-config::Staging') })

    await act(async () => { await result.current.finishResolution() })
    await flush()

    const [, , yamlText] = api.writeResolvedConflict.mock.calls[0] as [string, string, string]
    // The request's own URL follows its own decision (ours), while the
    // Staging configuration follows its own (theirs) — the two are
    // arbitrated independently, which is the whole point of splitting a
    // saved configuration out into its own conflict.
    expect(yamlText).toContain('url: https://ours.example.com')
    expect(yamlText).toContain('https://theirs-staging.example.com')
    expect(yamlText).not.toContain('https://ours-staging.example.com')
  })

  it('finishResolution shows a failure toast and leaves the modal open when the commit fails', async () => {
    stubGitApi({ commit: vi.fn().mockResolvedValue({ success: false, error: 'nothing to commit' }) })
    const { result } = renderHook(() => useGitPullConflict())
    await act(async () => { await result.current.openFromPull('/proj', 'api.restorm') })
    // Finishing requires every conflict to be decided — otherwise the
    // write-back refuses before it ever reaches the commit under test.
    act(() => { result.current.conflictResolution.pickOursVersion('r1') })

    await act(async () => { await result.current.finishResolution() })
    await flush()

    expect(toasterPushMock).toHaveBeenCalledWith('app', {
      title: 'git.pushFailedTitle',
      body: 'nothing to commit',
      durationMs: 10000
    })
    expect(result.current.isOpen).toBe(true)
  })

  it('finishResolution re-opens the project once the merged content is on disk', async () => {
    // The repository has moved on; leaving the app on its pre-merge tree
    // means the sidebar, the open tabs and the search index all describe a
    // file that no longer exists on disk.
    const onProjectReplaced = vi.fn()
    stubGitApi()
    const { result } = renderHook(() => useGitPullConflict({ onProjectReplaced }))
    await act(async () => { await result.current.openFromPull('/proj', 'api.restorm') })
    act(() => { result.current.conflictResolution.pickTheirsVersion('r1') })

    await act(async () => { await result.current.finishResolution() })
    await flush()

    expect(onProjectReplaced).toHaveBeenCalledTimes(1)
  })

  it('finishResolution is a no-op before openFromPull has run', async () => {
    stubGitApi()
    const { result } = renderHook(() => useGitPullConflict())
    await act(async () => { await result.current.finishResolution() })
    expect(toasterPushMock).not.toHaveBeenCalled()
  })
})
