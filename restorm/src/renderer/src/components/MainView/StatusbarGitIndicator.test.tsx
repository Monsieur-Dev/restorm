// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import type { GitState } from 'electron-core-ui/types'
import { StatusbarGitIndicator } from './StatusbarGitIndicator'

// Importing the real `electron-core-ui/renderer` barrel transitively loads
// Monaco Editor, which jsdom can't run (`document.queryCommandSupported` is
// missing) — see `useCapability.test.tsx` for the same workaround. Stub
// `useGitState` and the presentational `StatusbarGitIndicator` (reduced to
// its two clickable test hooks, since its own rendering is covered by
// `electron-core-ui`'s own `StatusbarGitIndicator.test.tsx`).
const { useGitStateMock } = vi.hoisted(() => ({
  useGitStateMock: vi.fn<() => GitState>()
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
  )
}))

const NO_REPO: GitState = { isRepo: false, gitInstalled: true, status: null, remoteHasNewerVersion: false, hasConflicts: false }

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('StatusbarGitIndicator (restorm container)', () => {
  it('renders nothing when the active folder is not a git repo', () => {
    useGitStateMock.mockReturnValue(NO_REPO)
    const { container } = render(<StatusbarGitIndicator onPush={vi.fn()} onPull={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the ECUI indicator once the folder is a git repo', () => {
    useGitStateMock.mockReturnValue({
      isRepo: true,
      gitInstalled: true,
      status: { branch: 'main', ahead: 0, behind: 0, files: [] },
      remoteHasNewerVersion: false,
      hasConflicts: false
    })
    render(<StatusbarGitIndicator onPush={vi.fn()} onPull={vi.fn()} />)
    expect(screen.getByTestId('ecui-git-indicator')).toBeTruthy()
  })

  it('sets pushPending on uncommitted working-tree changes', () => {
    useGitStateMock.mockReturnValue({
      isRepo: true,
      gitInstalled: true,
      status: { branch: 'main', ahead: 0, behind: 0, files: [{ path: 'api.restorm', state: 'modified' }] },
      remoteHasNewerVersion: false,
      hasConflicts: false
    })
    render(<StatusbarGitIndicator onPush={vi.fn()} onPull={vi.fn()} />)
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
    render(<StatusbarGitIndicator onPush={vi.fn()} onPull={vi.fn()} />)
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
    render(<StatusbarGitIndicator onPush={vi.fn()} onPull={vi.fn()} />)
    expect(screen.getByTestId('ecui-git-pull').dataset['pending']).toBe('true')
  })

  it('forwards clicks to the onPush / onPull props unchanged', () => {
    const onPush = vi.fn()
    const onPull = vi.fn()
    useGitStateMock.mockReturnValue({
      isRepo: true,
      gitInstalled: true,
      status: { branch: 'main', ahead: 0, behind: 0, files: [] },
      remoteHasNewerVersion: false,
      hasConflicts: false
    })
    render(<StatusbarGitIndicator onPush={onPush} onPull={onPull} />)
    fireEvent.click(screen.getByTestId('ecui-git-push'))
    fireEvent.click(screen.getByTestId('ecui-git-pull'))
    expect(onPush).toHaveBeenCalledTimes(1)
    expect(onPull).toHaveBeenCalledTimes(1)
  })
})
