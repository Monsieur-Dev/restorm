// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { StatusbarGitIndicator } from './StatusbarGitIndicator'

// i18n is mocked to echo the key so assertions don't depend on a loaded bundle.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

afterEach(() => { cleanup() })

describe('StatusbarGitIndicator', () => {
  it('renders the fixed "GIT" label and both action icons', () => {
    render(<StatusbarGitIndicator pushPending={false} pullPending={false} onRefresh={vi.fn()} onPush={vi.fn()} onPull={vi.fn()} />)
    expect(screen.getByTestId('statusbar-git-indicator-label').textContent).toBe('GIT')
    expect(screen.getByTestId('statusbar-git-indicator-push')).toBeTruthy()
    expect(screen.getByTestId('statusbar-git-indicator-pull')).toBeTruthy()
  })

  it('clicking the refresh icon calls onRefresh only', () => {
    const onRefresh = vi.fn()
    const onPush = vi.fn()
    render(<StatusbarGitIndicator pushPending={false} pullPending={false} onRefresh={onRefresh} onPush={onPush} onPull={vi.fn()} />)
    fireEvent.click(screen.getByTestId('statusbar-git-indicator-refresh'))
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(onPush).not.toHaveBeenCalled()
  })

  it('clicking repo-push calls onPush; clicking repo-pull calls onPull', () => {
    const onPush = vi.fn()
    const onPull = vi.fn()
    render(<StatusbarGitIndicator pushPending={false} pullPending={false} onRefresh={vi.fn()} onPush={onPush} onPull={onPull} />)

    fireEvent.click(screen.getByTestId('statusbar-git-indicator-push'))
    expect(onPush).toHaveBeenCalledTimes(1)
    expect(onPull).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('statusbar-git-indicator-pull'))
    expect(onPull).toHaveBeenCalledTimes(1)
  })

  it('Enter/Space on a focused action icon also triggers its click handler', () => {
    const onPush = vi.fn()
    render(<StatusbarGitIndicator pushPending={false} pullPending={false} onRefresh={vi.fn()} onPush={onPush} onPull={vi.fn()} />)
    fireEvent.keyDown(screen.getByTestId('statusbar-git-indicator-push'), { key: 'Enter' })
    fireEvent.keyDown(screen.getByTestId('statusbar-git-indicator-push'), { key: ' ' })
    expect(onPush).toHaveBeenCalledTimes(2)
  })

  it('shows the push pastille only when pushPending is true — a dot, never a count', () => {
    const { rerender } = render(
      <StatusbarGitIndicator pushPending={false} pullPending={false} onRefresh={vi.fn()} onPush={vi.fn()} onPull={vi.fn()} />
    )
    expect(screen.queryByTestId('statusbar-git-indicator-push-pastille')).toBeNull()

    rerender(<StatusbarGitIndicator pushPending pullPending={false} onRefresh={vi.fn()} onPush={vi.fn()} onPull={vi.fn()} />)
    const pastille = screen.getByTestId('statusbar-git-indicator-push-pastille')
    expect(pastille).toBeTruthy()
    // No number is ever rendered inside the pastille — a plain empty dot.
    expect(pastille.textContent).toBe('')
  })

  it('shows the pull pastille independently of the push pastille', () => {
    render(<StatusbarGitIndicator pushPending={false} pullPending onRefresh={vi.fn()} onPush={vi.fn()} onPull={vi.fn()} />)
    expect(screen.queryByTestId('statusbar-git-indicator-push-pastille')).toBeNull()
    expect(screen.getByTestId('statusbar-git-indicator-pull-pastille')).toBeTruthy()
  })

  it('hovering an action icon reveals its tooltip with the translated text', () => {
    render(<StatusbarGitIndicator pushPending={false} pullPending={false} onRefresh={vi.fn()} onPush={vi.fn()} onPull={vi.fn()} />)
    const pushAction = screen.getByTestId('statusbar-git-indicator-push')
    fireEvent.mouseEnter(pushAction)
    expect(screen.getByTestId('statusbar-git-indicator-push-tooltip').textContent).toContain('statusbar.git.pushTooltip')
    fireEvent.mouseLeave(pushAction)
    expect(screen.queryByTestId('statusbar-git-indicator-push-tooltip')).toBeNull()
  })

  it('supports a custom data-testid root', () => {
    render(
      <StatusbarGitIndicator
        pushPending={false}
        pullPending={false}
        onRefresh={vi.fn()}
        onPush={vi.fn()}
        onPull={vi.fn()}
        data-testid="custom-git"
      />
    )
    expect(screen.getByTestId('custom-git')).toBeTruthy()
    expect(screen.getByTestId('custom-git-push')).toBeTruthy()
    expect(screen.getByTestId('custom-git-pull')).toBeTruthy()
  })
})
