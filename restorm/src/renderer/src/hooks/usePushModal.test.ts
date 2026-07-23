// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

// `usePushModal` only needs a handful of `electron-core-ui/renderer`
// exports — avoid the real barrel (transitively loads Monaco, which jsdom
// can't run) by mocking exactly what it uses. `renderCommitMessage` is
// stubbed to a trivial passthrough (its own Handlebars behavior is
// covered by ECUI's own `CommitMessageEngine.test.ts`); this suite tests
// orchestration (diff → regenerate → stage/commit/push → toast), not
// rendering.
const { toasterPushMock, settingsStore, getFixedTMock } = vi.hoisted(() => ({
  toasterPushMock: vi.fn(),
  settingsStore: new Map<string, unknown>(),
  getFixedTMock: vi.fn((lang: string) => (key: string, opts?: Record<string, unknown>) => `${lang}:${key}:${JSON.stringify(opts ?? {})}`)
}))

vi.mock('electron-core-ui/renderer', () => ({
  toasterService: { push: toasterPushMock },
  i18n: { getFixedT: getFixedTMock },
  renderCommitMessage: (
    _templates: unknown,
    context: { titleSummary: string, lines: string[] }
  ) => ({ title: context.titleSummary, body: context.lines.join('\n') }),
  useSetting: (key: string) => {
    const setValue = vi.fn((v: unknown) => { settingsStore.set(key, v); return Promise.resolve() })
    return [settingsStore.get(key), setValue, false]
  },
  // The REAL implementation (types/settings.ts), not a stub — this test
  // exercises the actual `<groupPath>:<settingId>` format usePushModal.ts
  // relies on, the same one SettingsService.buildStorageKey produces for
  // the `git` group's registered `applyCommitMessageLanguageByDefault` row.
  buildSettingsStorageKey: (groupPath: string[], settingId: string) =>
    (groupPath.length > 0 ? `${groupPath.join('.')}:${settingId}` : settingId)
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// PARTIAL mock: the commit-message half is stubbed (this suite asserts
// the generated message, not the diff engine), but the real
// `flattenEntities` / `ownFieldsSnapshot` must stay — the pre-flight gate
// computes actual conflicts through them, and a fully-stubbed module
// silently turns every "behind" case into "no conflicts".
vi.mock('../../../shared/git/gitCommitDiff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/git/gitCommitDiff')>()),
  diffProjectEntities: vi.fn(() => [{ kind: 'request', name: 'Find pet by ID', action: 'modified' }])
}))

vi.mock('../utils/serialization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/serialization')>()),
  processAfterDeserialization: (data: unknown) => data
}))

vi.mock('../../../shared/git/commitMessageContext', () => ({
  buildCommitMessageContext: (
    changes: { kind: string, name: string, action: string }[],
    t: (key: string, opts?: Record<string, unknown>) => string
  ) => ({
    titleSummary: t('title-for', { lang: 'x' }),
    lines: changes.map((c) => `${c.action}:${c.kind}:${c.name}`)
  })
}))

import { usePushModal } from './usePushModal'
import type { FolderItem } from '../../../shared/types/folderTypes'

const ROOT_ITEMS: FolderItem[] = []
const saveBeforePushMock = vi.fn().mockResolvedValue(undefined)

function stubGitApi(overrides: Partial<{
  getFileAtHead: ReturnType<typeof vi.fn>
  getFileAtMergeBase: ReturnType<typeof vi.fn>
  getConflictCommitTimestamps: ReturnType<typeof vi.fn>
  stage: ReturnType<typeof vi.fn>
  commit: ReturnType<typeof vi.fn>
  push: ReturnType<typeof vi.fn>
}> & Partial<GitApiStub> = {}): GitApiStub {
  const api = {
    getFileAtHead: overrides.getFileAtHead ?? vi.fn().mockResolvedValue(null),
    // The commit diff reads HEAD; the behind-check's three-way base reads
    // the merge base. Two different questions, two different primitives.
    getFileAtMergeBase: overrides.getFileAtMergeBase ?? vi.fn().mockResolvedValue(null),
    getConflictCommitTimestamps: overrides.getConflictCommitTimestamps ?? vi.fn().mockResolvedValue({ ours: null, theirs: null }),
    stage: overrides.stage ?? vi.fn().mockResolvedValue(undefined),
    commit: overrides.commit ?? vi.fn().mockResolvedValue({ success: true, commit: 'abc123' }),
    push: overrides.push ?? vi.fn().mockResolvedValue({ success: true }),
    // Pre-flight primitives. The default answer is "already up to date",
    // so every pre-existing expectation still describes the plain publish
    // path; the behind cases opt in explicitly below.
    fetchAndCompare: overrides.fetchAndCompare ?? vi.fn().mockResolvedValue({ remoteHasNewerVersion: false, behind: 0 }),
    getFileAtRemote: overrides.getFileAtRemote ?? vi.fn().mockResolvedValue(null),
    resetToRemoteKeepingWorkingTree: overrides.resetToRemoteKeepingWorkingTree ?? vi.fn().mockResolvedValue({ success: true }),
    resetHardToRemote: overrides.resetHardToRemote ?? vi.fn().mockResolvedValue({ success: true }),
    writeResolvedConflict: overrides.writeResolvedConflict ?? vi.fn().mockResolvedValue(undefined),
    getWorkingTreeFile: overrides.getWorkingTreeFile ?? vi.fn().mockResolvedValue(null),
    getStatus: overrides.getStatus ?? vi.fn().mockResolvedValue({ branch: 'main', ahead: 0, behind: 0, files: [{ path: 'api.restorm', state: 'modified' }] })
  }
  ;(window as unknown as { api: unknown }).api = { git: api }
  return api
}

beforeEach(() => { settingsStore.clear() })

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as { api?: unknown }).api
})

// Flush the microtask queue so the `.then()` chains inside the hook settle
// before assertions.
interface GitApiStub {
  getFileAtHead: ReturnType<typeof vi.fn>
  getFileAtMergeBase: ReturnType<typeof vi.fn>
  getConflictCommitTimestamps: ReturnType<typeof vi.fn>
  stage: ReturnType<typeof vi.fn>
  commit: ReturnType<typeof vi.fn>
  push: ReturnType<typeof vi.fn>
  fetchAndCompare: ReturnType<typeof vi.fn>
  getFileAtRemote: ReturnType<typeof vi.fn>
  resetToRemoteKeepingWorkingTree: ReturnType<typeof vi.fn>
  resetHardToRemote: ReturnType<typeof vi.fn>
  writeResolvedConflict: ReturnType<typeof vi.fn>
  getWorkingTreeFile: ReturnType<typeof vi.fn>
  getStatus: ReturnType<typeof vi.fn>
}

async function flush(): Promise<void> {
  // The push chain awaits a fetch, then three reads in parallel, then a
  // merge/write — several microtask turns deep. Drain generously rather
  // than counting them: an under-drained flush reads as "the hook did
  // nothing" and fails in a way that looks like a logic bug.
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  })
}

describe('usePushModal', () => {
  it('is closed by default with empty fields', () => {
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS, saveBeforePushMock))
    expect(result.current.isOpen).toBe(false)
    expect(result.current.title).toBe('')
    expect(result.current.body).toBe('')
  })

  it('openPushModal diffs against HEAD and opens with a generated title/body', async () => {
    const api = stubGitApi()
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS, saveBeforePushMock))
    act(() => { result.current.openPushModal() })
    await flush()

    expect(api.getFileAtHead).toHaveBeenCalledWith('/proj', 'api.restorm')
    expect(result.current.isOpen).toBe(true)
    expect(result.current.body).toBe('modified:request:Find pet by ID')
  })

  it('openPushModal is a no-op for a legacy folder-mode project (no single file to diff)', async () => {
    const api = stubGitApi()
    const { result } = renderHook(() => usePushModal('/proj/folder', ROOT_ITEMS, saveBeforePushMock))
    act(() => { result.current.openPushModal() })
    await flush()
    expect(api.getFileAtHead).not.toHaveBeenCalled()
    expect(result.current.isOpen).toBe(false)
  })

  it('defaults the language to English when no setting is persisted yet', async () => {
    stubGitApi()
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS, saveBeforePushMock))
    act(() => { result.current.openPushModal() })
    await flush()
    expect(result.current.language).toBe('en')
    expect(getFixedTMock).toHaveBeenCalledWith('en')
  })

  it('opens with the persisted default language when one is set', async () => {
    settingsStore.set('git:commitMessageLanguage', 'fr')
    stubGitApi()
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS, saveBeforePushMock))
    act(() => { result.current.openPushModal() })
    await flush()
    expect(result.current.language).toBe('fr')
  })

  it('setLanguage regenerates the title/body and persists the new default when "apply by default" is on', async () => {
    settingsStore.set('git:applyCommitMessageLanguageByDefault', true)
    stubGitApi()
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS, saveBeforePushMock))
    act(() => { result.current.openPushModal() })
    await flush()

    act(() => { result.current.setLanguage('ja') })
    expect(result.current.language).toBe('ja')
    expect(getFixedTMock).toHaveBeenCalledWith('ja')
    expect(settingsStore.get('git:commitMessageLanguage')).toBe('ja')
  })

  it('setLanguage does NOT persist the new default when "apply by default" is off', async () => {
    settingsStore.set('git:applyCommitMessageLanguageByDefault', false)
    stubGitApi()
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS, saveBeforePushMock))
    act(() => { result.current.openPushModal() })
    await flush()

    act(() => { result.current.setLanguage('ja') })
    expect(result.current.language).toBe('ja')
    expect(settingsStore.has('git:commitMessageLanguage')).toBe(false)
  })

  it('setApplyLanguageByDefault persists the checkbox state', () => {
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS, saveBeforePushMock))
    act(() => { result.current.setApplyLanguageByDefault(false) })
    expect(settingsStore.get('git:applyCommitMessageLanguageByDefault')).toBe(false)
  })

  it('the "apply by default" toggle resolves to the SAME storage key the Settings→Git row uses (no silent drift)', () => {
    // Regression test: this key used to be hand-written as
    // `'git.applyCommitMessageLanguageByDefault'` (a dot), while
    // `resources/settings.yaml`'s registered `git` group +
    // `applyCommitMessageLanguageByDefault` setting resolves via
    // `SettingsService.buildStorageKey(['git'], 'applyCommitMessageLanguageByDefault')`
    // to a COLON-separated key — two different storage entries, silently
    // disconnected. Both sides must compute through the same
    // `buildSettingsStorageKey` helper so they can never diverge again.
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS, saveBeforePushMock))
    act(() => { result.current.setApplyLanguageByDefault(true) })
    const expectedKey = 'git:applyCommitMessageLanguageByDefault' // groupPath=['git'], settingId='applyCommitMessageLanguageByDefault'
    expect(settingsStore.has(expectedKey)).toBe(true)
    expect(settingsStore.get(expectedKey)).toBe(true)
  })

  it('push stages the file, commits with title+body, pushes, toasts success, and closes the modal', async () => {
    const api = stubGitApi()
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS, saveBeforePushMock))
    act(() => { result.current.openPushModal() })
    await flush()
    act(() => { result.current.setTitle('My title') })

    act(() => { result.current.push() })
    await flush()

    expect(api.stage).toHaveBeenCalledWith('/proj', ['api.restorm'])
    // Scoped to the project file — see useGitPullConflict.test.ts.
    expect(api.commit).toHaveBeenCalledWith('/proj', 'My title\n\nmodified:request:Find pet by ID', ['api.restorm'])
    expect(api.push).toHaveBeenCalledWith('/proj')
    expect(toasterPushMock).toHaveBeenCalledWith('app', { title: 'git.pushSucceededTitle', body: 'git.pushSucceededBody', durationMs: 5000 })
    expect(result.current.isOpen).toBe(false)
  })

  it('awaits saveBeforePush and completes it BEFORE staging — regression guard against staging stale, pre-edit disk content', async () => {
    // `git.stage` reads whatever's on disk; without an explicit save first,
    // an edit made just before clicking Push could still be sitting
    // unflushed in the renderer when git reads the file. Assert the ORDER,
    // not just that both were called — a same-tick Promise.all would call
    // both without proving `stage` waited for the save to actually finish.
    const callOrder: string[] = []
    const orderedSaveBeforePush = vi.fn(() => {
      callOrder.push('saveBeforePush:start')
      return Promise.resolve().then(() => { callOrder.push('saveBeforePush:done') })
    })
    const api = stubGitApi({
      stage: vi.fn(() => { callOrder.push('stage'); return Promise.resolve(undefined) })
    })
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS, orderedSaveBeforePush))
    act(() => { result.current.openPushModal() })
    await flush()

    act(() => { result.current.push() })
    await flush()

    expect(orderedSaveBeforePush).toHaveBeenCalledTimes(1)
    expect(api.stage).toHaveBeenCalledWith('/proj', ['api.restorm'])
    expect(callOrder).toEqual(['saveBeforePush:start', 'saveBeforePush:done', 'stage'])
  })

  it('push shows a failure toast and CLOSES the modal when commit fails (the toast renders under the modal overlay)', async () => {
    const api = stubGitApi({ commit: vi.fn().mockResolvedValue({ success: false, error: 'nothing to commit' }) })
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS, saveBeforePushMock))
    act(() => { result.current.openPushModal() })
    await flush()

    act(() => { result.current.push() })
    await flush()

    expect(api.push).not.toHaveBeenCalled()
    expect(toasterPushMock).toHaveBeenCalledWith('app', {
      title: 'git.pushFailedTitle',
      body: 'nothing to commit',
      durationMs: 10000
    })
    expect(result.current.isOpen).toBe(false)
  })

  it('push shows a failure toast and CLOSES the modal when the push itself fails', async () => {
    const api = stubGitApi({ push: vi.fn().mockResolvedValue({ success: false, error: 'rejected non-fast-forward' }) })
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS, saveBeforePushMock))
    act(() => { result.current.openPushModal() })
    await flush()

    act(() => { result.current.push() })
    await flush()

    expect(api.commit).toHaveBeenCalled()
    expect(toasterPushMock).toHaveBeenCalledWith('app', {
      title: 'git.pushFailedTitle',
      body: 'rejected non-fast-forward',
      durationMs: 10000
    })
    expect(result.current.isOpen).toBe(false)
  })

  it('closePushModal closes without touching git', () => {
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS, saveBeforePushMock))
    act(() => { result.current.closePushModal() })
    expect(result.current.isOpen).toBe(false)
  })
})

describe('usePushModal — behind the server', () => {
  const BASE = `_projectUuid: p
collections:
  - id: env
    name: Project
    tags: []
    configuration: {}
    folderType: environment
    environments: []
    items:
      - id: r1
        name: Base name
        type: http
        tags: []
        method: GET
        url: https://base
        headers: []
        params: []
        pathParams: []
`
  const mine = BASE.replace('https://base', 'https://mine')
  const theirsSameEntity = BASE.replace('https://base', 'https://theirs')
  const theirsOtherName = BASE.replace('Base name', 'Their name')

  function behindStub(theirsYaml: string): GitApiStub {
    return stubGitApi({
      fetchAndCompare: vi.fn().mockResolvedValue({ remoteHasNewerVersion: true, behind: 1 }),
      getFileAtHead: vi.fn().mockResolvedValue(BASE),
      getFileAtMergeBase: vi.fn().mockResolvedValue(BASE),
      getFileAtRemote: vi.fn().mockResolvedValue(theirsYaml)
    })
  }

  it('publishes without prompting when nothing is contested', async () => {
    // They renamed the request, we changed its url — different fields of
    // the same entity would clash, so use a genuinely untouched-by-us doc.
    const api = behindStub(theirsOtherName)
    api.getWorkingTreeFile.mockResolvedValue(BASE)

    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS, saveBeforePushMock))
    act(() => { result.current.push() })
    await flush()

    // No prompt, and the publish went through after the silent update.
    expect(result.current.pendingUpdate).toBeNull()
    expect(api.resetToRemoteKeepingWorkingTree).toHaveBeenCalledWith('/proj')
    expect(api.commit).toHaveBeenCalled()
    expect(api.push).toHaveBeenCalledWith('/proj')
  })

  it('prompts WITHOUT committing when the same entity is contested', async () => {
    const api = behindStub(theirsSameEntity)
    api.getWorkingTreeFile.mockResolvedValue(mine)

    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS, saveBeforePushMock))
    act(() => { result.current.push() })
    await flush()

    expect(result.current.pendingUpdate?.conflicts).toHaveLength(1)
    // THE guarantee: reaching the prompt must not have committed anything.
    expect(api.commit).not.toHaveBeenCalled()
    expect(api.push).not.toHaveBeenCalled()
    expect(api.resetToRemoteKeepingWorkingTree).not.toHaveBeenCalled()
    expect(api.resetHardToRemote).not.toHaveBeenCalled()
  })

  it('cancelling the prompt leaves the repository completely untouched', async () => {
    const api = behindStub(theirsSameEntity)
    api.getWorkingTreeFile.mockResolvedValue(mine)

    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS, saveBeforePushMock))
    act(() => { result.current.push() })
    await flush()
    act(() => { result.current.cancelPendingUpdate() })
    await flush()

    expect(result.current.pendingUpdate).toBeNull()
    expect(api.commit).not.toHaveBeenCalled()
    expect(api.push).not.toHaveBeenCalled()
    expect(api.resetToRemoteKeepingWorkingTree).not.toHaveBeenCalled()
    expect(api.resetHardToRemote).not.toHaveBeenCalled()
  })

  it('"keep the server version" resets hard and publishes nothing', async () => {
    const api = behindStub(theirsSameEntity)
    api.getWorkingTreeFile.mockResolvedValue(mine)

    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS, saveBeforePushMock))
    act(() => { result.current.push() })
    await flush()
    act(() => { result.current.resolvePendingUpdate('keepServer') })
    await flush()

    expect(api.resetHardToRemote).toHaveBeenCalledWith('/proj')
    // Taking the server's version leaves nothing of ours to publish.
    expect(api.commit).not.toHaveBeenCalled()
    expect(api.push).not.toHaveBeenCalled()
  })

  it('"keep my version" merges, then commits and publishes', async () => {
    const api = behindStub(theirsSameEntity)
    api.getWorkingTreeFile.mockResolvedValue(mine)

    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS, saveBeforePushMock))
    act(() => { result.current.push() })
    await flush()
    act(() => { result.current.resolvePendingUpdate('keepMine') })
    await flush()

    expect(api.resetToRemoteKeepingWorkingTree).toHaveBeenCalledWith('/proj')
    expect(api.writeResolvedConflict).toHaveBeenCalled()
    expect(api.commit).toHaveBeenCalled()
    expect(api.push).toHaveBeenCalledWith('/proj')
  })
})
