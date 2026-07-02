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
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../services/gitCommitDiff', () => ({
  parseProjectYaml: vi.fn(() => []),
  diffProjectEntities: vi.fn(() => [{ kind: 'request', name: 'Find pet by ID', action: 'modified' }])
}))

vi.mock('../services/commitMessageContext', () => ({
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

function stubGitApi(overrides: Partial<{
  getFileAtHead: ReturnType<typeof vi.fn>
  stage: ReturnType<typeof vi.fn>
  commit: ReturnType<typeof vi.fn>
  push: ReturnType<typeof vi.fn>
}> = {}): {
  getFileAtHead: ReturnType<typeof vi.fn>
  stage: ReturnType<typeof vi.fn>
  commit: ReturnType<typeof vi.fn>
  push: ReturnType<typeof vi.fn>
} {
  const api = {
    getFileAtHead: overrides.getFileAtHead ?? vi.fn().mockResolvedValue(null),
    stage: overrides.stage ?? vi.fn().mockResolvedValue(undefined),
    commit: overrides.commit ?? vi.fn().mockResolvedValue({ success: true, commit: 'abc123' }),
    push: overrides.push ?? vi.fn().mockResolvedValue({ success: true })
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
async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

describe('usePushModal', () => {
  it('is closed by default with empty fields', () => {
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS))
    expect(result.current.isOpen).toBe(false)
    expect(result.current.title).toBe('')
    expect(result.current.body).toBe('')
  })

  it('openPushModal diffs against HEAD and opens with a generated title/body', async () => {
    const api = stubGitApi()
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS))
    act(() => { result.current.openPushModal() })
    await flush()

    expect(api.getFileAtHead).toHaveBeenCalledWith('/proj', 'api.restorm')
    expect(result.current.isOpen).toBe(true)
    expect(result.current.body).toBe('modified:request:Find pet by ID')
  })

  it('openPushModal is a no-op for a legacy folder-mode project (no single file to diff)', async () => {
    const api = stubGitApi()
    const { result } = renderHook(() => usePushModal('/proj/folder', ROOT_ITEMS))
    act(() => { result.current.openPushModal() })
    await flush()
    expect(api.getFileAtHead).not.toHaveBeenCalled()
    expect(result.current.isOpen).toBe(false)
  })

  it('defaults the language to English when no setting is persisted yet', async () => {
    stubGitApi()
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS))
    act(() => { result.current.openPushModal() })
    await flush()
    expect(result.current.language).toBe('en')
    expect(getFixedTMock).toHaveBeenCalledWith('en')
  })

  it('opens with the persisted default language when one is set', async () => {
    settingsStore.set('git.commitMessageLanguage', 'fr')
    stubGitApi()
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS))
    act(() => { result.current.openPushModal() })
    await flush()
    expect(result.current.language).toBe('fr')
  })

  it('setLanguage regenerates the title/body and persists the new default when "apply by default" is on', async () => {
    settingsStore.set('git.applyCommitMessageLanguageByDefault', true)
    stubGitApi()
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS))
    act(() => { result.current.openPushModal() })
    await flush()

    act(() => { result.current.setLanguage('ja') })
    expect(result.current.language).toBe('ja')
    expect(getFixedTMock).toHaveBeenCalledWith('ja')
    expect(settingsStore.get('git.commitMessageLanguage')).toBe('ja')
  })

  it('setLanguage does NOT persist the new default when "apply by default" is off', async () => {
    settingsStore.set('git.applyCommitMessageLanguageByDefault', false)
    stubGitApi()
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS))
    act(() => { result.current.openPushModal() })
    await flush()

    act(() => { result.current.setLanguage('ja') })
    expect(result.current.language).toBe('ja')
    expect(settingsStore.has('git.commitMessageLanguage')).toBe(false)
  })

  it('setApplyLanguageByDefault persists the checkbox state', () => {
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS))
    act(() => { result.current.setApplyLanguageByDefault(false) })
    expect(settingsStore.get('git.applyCommitMessageLanguageByDefault')).toBe(false)
  })

  it('push stages the file, commits with title+body, pushes, toasts success, and closes the modal', async () => {
    const api = stubGitApi()
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS))
    act(() => { result.current.openPushModal() })
    await flush()
    act(() => { result.current.setTitle('My title') })

    act(() => { result.current.push() })
    await flush()

    expect(api.stage).toHaveBeenCalledWith('/proj', ['api.restorm'])
    expect(api.commit).toHaveBeenCalledWith('/proj', 'My title\n\nmodified:request:Find pet by ID')
    expect(api.push).toHaveBeenCalledWith('/proj')
    expect(toasterPushMock).toHaveBeenCalledWith('app', { title: 'git.pushSucceededTitle', body: 'git.pushSucceededBody' })
    expect(result.current.isOpen).toBe(false)
  })

  it('push shows a failure toast and leaves the modal open when commit fails', async () => {
    const api = stubGitApi({ commit: vi.fn().mockResolvedValue({ success: false, error: 'nothing to commit' }) })
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS))
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
    expect(result.current.isOpen).toBe(true)
  })

  it('push shows a failure toast and leaves the modal open when the push itself fails', async () => {
    const api = stubGitApi({ push: vi.fn().mockResolvedValue({ success: false, error: 'rejected non-fast-forward' }) })
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS))
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
    expect(result.current.isOpen).toBe(true)
  })

  it('closePushModal closes without touching git', () => {
    const { result } = renderHook(() => usePushModal('/proj/api.restorm', ROOT_ITEMS))
    act(() => { result.current.closePushModal() })
    expect(result.current.isOpen).toBe(false)
  })
})
