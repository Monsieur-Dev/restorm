// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import type { GitState } from 'electron-core-ui/types'
import { StatusbarGitIndicator } from './StatusbarGitIndicator'
import type { GitGateState } from '../../hooks/useGitGateState'

// Importing the real `electron-core-ui/renderer` barrel transitively loads
// Monaco Editor, which jsdom can't run (`document.queryCommandSupported` is
// missing) — see `useCapability.test.tsx` for the same workaround. Stub
// `useGitState`, the presentational `StatusbarGitIndicator`, and `GatedControl`
// (reduced to just enough to assert locked/unlocked + the upsell content —
// its own full behavior is covered by `electron-core-ui`'s own
// `GatedControl.test.tsx`).
const { useGitStateMock, subscribeToProMock } = vi.hoisted(() => ({
  useGitStateMock: vi.fn<() => GitState>(),
  subscribeToProMock: vi.fn()
}))

vi.mock('electron-core-ui/renderer', () => ({
  useGitState: () => useGitStateMock(),
  StatusbarGitIndicator: (props: {
    pushPending: boolean
    pullPending: boolean
    onPush: () => void
    onPull: () => void
  }) => (
    <div data-testid="ecui-git-indicator">
      <button data-testid="ecui-git-push" data-pending={props.pushPending} onClick={props.onPush}>push</button>
      <button data-testid="ecui-git-pull" data-pending={props.pullPending} onClick={props.onPull}>pull</button>
    </div>
  ),
  GatedControl: (props: {
    locked: boolean
    showSubscribeLink: boolean
    proLabel?: string
    onSubscribe?: () => void
    children: React.ReactNode
    'data-testid'?: string
  }) => (
    <div
      data-testid={props['data-testid']}
      data-locked={props.locked}
      data-show-subscribe={props.showSubscribeLink}
      data-pro-label={props.proLabel ?? ''}
    >
      <button data-testid="gate-subscribe-trigger" onClick={() => { props.onSubscribe?.() }}>subscribe</button>
      {props.children}
    </div>
  )
}))

vi.mock('../../services/subscribeToPro', () => ({
  subscribeToPro: subscribeToProMock
}))

const { useGitGateStateMock } = vi.hoisted(() => ({
  useGitGateStateMock: vi.fn<() => GitGateState>()
}))
vi.mock('../../hooks/useGitGateState', () => ({
  useGitGateState: () => useGitGateStateMock()
}))

const NO_REPO: GitState = { isRepo: false, gitInstalled: true, status: null, remoteHasNewerVersion: false, hasConflicts: false }
const HAS_REPO: GitState = { isRepo: true, gitInstalled: true, status: { branch: 'main', ahead: 0, behind: 0, files: [] }, remoteHasNewerVersion: false, hasConflicts: false }

const ENABLED: GitGateState = { kind: 'enabled', locked: false, showSubscribeLink: true }
const COMMUNITY: GitGateState = { kind: 'community', locked: true, showSubscribeLink: true }
const NO_GIT_FOLDER: GitGateState = { kind: 'no-git-folder', locked: true, message: 'Initialize your git folder', showSubscribeLink: false }

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('StatusbarGitIndicator (restorm container)', () => {
  it('renders nothing when no project is open at all', () => {
    useGitStateMock.mockReturnValue(NO_REPO)
    useGitGateStateMock.mockReturnValue(COMMUNITY)
    const { container } = render(<StatusbarGitIndicator filePath={null} onPush={vi.fn()} onHistory={vi.fn()} onPull={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('a project is open but not a git repo, Pro entitled: renders VISIBLE-BUT-LOCKED with the init-git message, no subscribe link', () => {
    useGitStateMock.mockReturnValue(NO_REPO)
    useGitGateStateMock.mockReturnValue(NO_GIT_FOLDER)
    render(<StatusbarGitIndicator filePath="/proj/api.restorm" onPush={vi.fn()} onHistory={vi.fn()} onPull={vi.fn()} />)
    const gate = screen.getByTestId('statusbar-git-indicator-gate')
    expect(gate.dataset['locked']).toBe('true')
    expect(gate.dataset['showSubscribe']).toBe('false')
    expect(gate.dataset['proLabel']).toBe('Initialize your git folder')
    // The indicator itself still renders underneath (visible, not hidden).
    expect(screen.getByTestId('ecui-git-indicator')).toBeTruthy()
  })

  it('a project is open but not a git repo, Community: renders VISIBLE-BUT-LOCKED with the standard Pro upsell', () => {
    useGitStateMock.mockReturnValue(NO_REPO)
    useGitGateStateMock.mockReturnValue(COMMUNITY)
    render(<StatusbarGitIndicator filePath="/proj/api.restorm" onPush={vi.fn()} onHistory={vi.fn()} onPull={vi.fn()} />)
    const gate = screen.getByTestId('statusbar-git-indicator-gate')
    expect(gate.dataset['locked']).toBe('true')
    expect(gate.dataset['showSubscribe']).toBe('true')
    // No override — GatedControl's own default "Version Pro" copy applies.
    expect(gate.dataset['proLabel']).toBe('')
  })

  it('Pro + git repo: renders unlocked', () => {
    useGitStateMock.mockReturnValue(HAS_REPO)
    useGitGateStateMock.mockReturnValue(ENABLED)
    render(<StatusbarGitIndicator filePath="/proj/api.restorm" onPush={vi.fn()} onHistory={vi.fn()} onPull={vi.fn()} />)
    expect(screen.getByTestId('statusbar-git-indicator-gate').dataset['locked']).toBe('false')
  })

  it('wires the gate\'s onSubscribe to subscribeToPro()', () => {
    useGitStateMock.mockReturnValue(NO_REPO)
    useGitGateStateMock.mockReturnValue(COMMUNITY)
    render(<StatusbarGitIndicator filePath="/proj/api.restorm" onPush={vi.fn()} onHistory={vi.fn()} onPull={vi.fn()} />)
    fireEvent.click(screen.getByTestId('gate-subscribe-trigger'))
    expect(subscribeToProMock).toHaveBeenCalledTimes(1)
  })

  it('sets pushPending on uncommitted working-tree changes', () => {
    useGitStateMock.mockReturnValue({
      isRepo: true,
      gitInstalled: true,
      status: { branch: 'main', ahead: 0, behind: 0, files: [{ path: 'api.restorm', state: 'modified' }] },
      remoteHasNewerVersion: false,
      hasConflicts: false
    })
    useGitGateStateMock.mockReturnValue(ENABLED)
    render(<StatusbarGitIndicator filePath="/proj/api.restorm" onPush={vi.fn()} onHistory={vi.fn()} onPull={vi.fn()} />)
    expect(screen.getByTestId('ecui-git-push').dataset['pending']).toBe('true')
  })

  it('sets pushPending on local commits still to sweep in (ahead > 0), even with a clean working tree', () => {
    useGitStateMock.mockReturnValue({
      isRepo: true,
      gitInstalled: true,
      status: { branch: 'main', ahead: 2, behind: 0, files: [] },
      remoteHasNewerVersion: false,
      hasConflicts: false
    })
    useGitGateStateMock.mockReturnValue(ENABLED)
    render(<StatusbarGitIndicator filePath="/proj/api.restorm" onPush={vi.fn()} onHistory={vi.fn()} onPull={vi.fn()} />)
    expect(screen.getByTestId('ecui-git-push').dataset['pending']).toBe('true')
  })

  it('sets pullPending from remoteHasNewerVersion', () => {
    useGitStateMock.mockReturnValue({
      isRepo: true,
      gitInstalled: true,
      status: { branch: 'main', ahead: 0, behind: 3, files: [] },
      remoteHasNewerVersion: true,
      hasConflicts: false
    })
    useGitGateStateMock.mockReturnValue(ENABLED)
    render(<StatusbarGitIndicator filePath="/proj/api.restorm" onPush={vi.fn()} onHistory={vi.fn()} onPull={vi.fn()} />)
    expect(screen.getByTestId('ecui-git-pull').dataset['pending']).toBe('true')
  })

  it('forwards clicks to the onPush / onPull props unchanged', () => {
    const onPush = vi.fn()
    const onPull = vi.fn()
    useGitStateMock.mockReturnValue(HAS_REPO)
    useGitGateStateMock.mockReturnValue(ENABLED)
    render(<StatusbarGitIndicator filePath="/proj/api.restorm" onPush={onPush} onHistory={vi.fn()} onPull={onPull} />)
    fireEvent.click(screen.getByTestId('ecui-git-push'))
    fireEvent.click(screen.getByTestId('ecui-git-pull'))
    expect(onPush).toHaveBeenCalledTimes(1)
    expect(onPull).toHaveBeenCalledTimes(1)
  })
})
