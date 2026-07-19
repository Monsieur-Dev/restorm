// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { ConflictResolutionView } from './ConflictResolutionView'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// jsdom ships no ResizeObserver — SplitView/ScrollableElement (used inside
// Pane/ListView) construct one on mount. No-op stub, same pattern as
// EditorWorkbench.strictmode.test.tsx.
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void { /* no-op */ }
      unobserve(): void { /* no-op */ }
      disconnect(): void { /* no-op */ }
    }
  }
})

afterEach(() => { cleanup() })

const SINGLE_CONFLICT = [{ id: 'r1', label: 'Find pet by ID' }]
const CONFLICTS = [
  { id: 'r1', label: 'Find pet by ID' },
  { id: 'r2', label: 'Create pet' }
]

describe('ConflictResolutionView', () => {
  it('renders the user/server/resolved panels, no list, when there is only one conflict', () => {
    render(
      <ConflictResolutionView
        conflicts={SINGLE_CONFLICT}
        selectedConflictId="r1"
        onSelectConflict={vi.fn()}
        renderUserPanel={() => <div data-testid="user-content" />}
        renderServerPanel={() => <div data-testid="server-content" />}
        renderResolvedPanel={() => <div data-testid="resolved-content" />}
      />
    )
    expect(screen.queryByTestId('conflict-resolution-view-list')).toBeNull()
    expect(screen.getByText('conflictResolution.userTitle')).toBeTruthy()
    expect(screen.getByText('conflictResolution.serverTitle')).toBeTruthy()
    expect(screen.getByText('conflictResolution.resolvedTitle')).toBeTruthy()
    expect(screen.getByTestId('user-content')).toBeTruthy()
    expect(screen.getByTestId('server-content')).toBeTruthy()
    expect(screen.getByTestId('resolved-content')).toBeTruthy()
  })

  it('lays the panels out as side-by-side columns (a single columns row, list absent for one conflict)', () => {
    const { container } = render(
      <ConflictResolutionView
        conflicts={SINGLE_CONFLICT}
        selectedConflictId="r1"
        onSelectConflict={vi.fn()}
        renderUserPanel={() => <div data-testid="user-content" />}
        renderServerPanel={() => <div data-testid="server-content" />}
        renderResolvedPanel={() => <div data-testid="resolved-content" />}
      />
    )
    expect(screen.getByTestId('conflict-resolution-view-columns')).toBeTruthy()
    // 3 version columns, no list column, for a single conflict.
    expect(container.querySelectorAll('.conflict-resolution-column--version')).toHaveLength(3)
    expect(container.querySelectorAll('.conflict-resolution-column--list')).toHaveLength(0)
  })

  it('adds a fourth (list) column when there is more than one conflict', () => {
    const { container } = render(
      <ConflictResolutionView
        conflicts={CONFLICTS}
        selectedConflictId="r1"
        onSelectConflict={vi.fn()}
        renderUserPanel={() => <div />}
        renderServerPanel={() => <div />}
        renderResolvedPanel={() => <div />}
      />
    )
    expect(container.querySelectorAll('.conflict-resolution-column--list')).toHaveLength(1)
    expect(container.querySelectorAll('.conflict-resolution-column--version')).toHaveLength(3)
  })

  it('shows the conflict list master-detail panel ONLY when there is more than one conflict', () => {
    render(
      <ConflictResolutionView
        conflicts={CONFLICTS}
        selectedConflictId="r1"
        onSelectConflict={vi.fn()}
        renderUserPanel={() => <div />}
        renderServerPanel={() => <div />}
        renderResolvedPanel={() => <div />}
      />
    )
    expect(screen.getByTestId('conflict-resolution-view-list')).toBeTruthy()
    expect(screen.getByText('Find pet by ID')).toBeTruthy()
    expect(screen.getByText('Create pet')).toBeTruthy()
  })

  it('clicking a conflict-list row calls onSelectConflict with that entity\'s id', () => {
    const onSelectConflict = vi.fn()
    render(
      <ConflictResolutionView
        conflicts={CONFLICTS}
        selectedConflictId="r1"
        onSelectConflict={onSelectConflict}
        renderUserPanel={() => <div />}
        renderServerPanel={() => <div />}
        renderResolvedPanel={() => <div />}
      />
    )
    fireEvent.click(screen.getByText('Create pet'))
    expect(onSelectConflict).toHaveBeenCalledWith('r2')
  })

  it('shows an empty-selection placeholder in all 3 content panels when nothing is selected yet', () => {
    render(
      <ConflictResolutionView
        conflicts={CONFLICTS}
        selectedConflictId={null}
        onSelectConflict={vi.fn()}
        renderUserPanel={() => <div data-testid="user-content" />}
        renderServerPanel={() => <div data-testid="server-content" />}
        renderResolvedPanel={() => <div data-testid="resolved-content" />}
      />
    )
    expect(screen.queryByTestId('user-content')).toBeNull()
    expect(screen.queryByTestId('server-content')).toBeNull()
    expect(screen.queryByTestId('resolved-content')).toBeNull()
    expect(screen.getByTestId('conflict-resolution-view-user-empty')).toBeTruthy()
    expect(screen.getByTestId('conflict-resolution-view-server-empty')).toBeTruthy()
    expect(screen.getByTestId('conflict-resolution-view-resolved-empty')).toBeTruthy()
  })

  it('passes the selected conflict id through to every render prop', () => {
    const renderUserPanel = vi.fn(() => <div />)
    const renderServerPanel = vi.fn(() => <div />)
    const renderResolvedPanel = vi.fn(() => <div />)
    render(
      <ConflictResolutionView
        conflicts={CONFLICTS}
        selectedConflictId="r2"
        onSelectConflict={vi.fn()}
        renderUserPanel={renderUserPanel}
        renderServerPanel={renderServerPanel}
        renderResolvedPanel={renderResolvedPanel}
      />
    )
    expect(renderUserPanel).toHaveBeenCalledWith('r2')
    expect(renderServerPanel).toHaveBeenCalledWith('r2')
    expect(renderResolvedPanel).toHaveBeenCalledWith('r2')
  })

  it('supports a custom data-testid root', () => {
    render(
      <ConflictResolutionView
        conflicts={CONFLICTS}
        selectedConflictId="r1"
        onSelectConflict={vi.fn()}
        renderUserPanel={() => <div />}
        renderServerPanel={() => <div />}
        renderResolvedPanel={() => <div />}
        data-testid="custom-conflicts"
      />
    )
    expect(screen.getByTestId('custom-conflicts')).toBeTruthy()
    expect(screen.getByTestId('custom-conflicts-list')).toBeTruthy()
  })

  it('renders "use this version" buttons only when the callbacks are provided, and calls them on click', () => {
    const onUseUserVersion = vi.fn()
    const onUseServerVersion = vi.fn()
    render(
      <ConflictResolutionView
        conflicts={CONFLICTS}
        selectedConflictId="r1"
        onSelectConflict={vi.fn()}
        renderUserPanel={() => <div />}
        renderServerPanel={() => <div />}
        renderResolvedPanel={() => <div />}
        onUseUserVersion={onUseUserVersion}
        onUseServerVersion={onUseServerVersion}
      />
    )
    fireEvent.click(screen.getByTestId('conflict-resolution-view-use-user-version'))
    expect(onUseUserVersion).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('conflict-resolution-view-use-server-version'))
    expect(onUseServerVersion).toHaveBeenCalledTimes(1)
  })

  it('does not render "use this version" buttons when no callback is provided', () => {
    render(
      <ConflictResolutionView
        conflicts={CONFLICTS}
        selectedConflictId="r1"
        onSelectConflict={vi.fn()}
        renderUserPanel={() => <div />}
        renderServerPanel={() => <div />}
        renderResolvedPanel={() => <div />}
      />
    )
    expect(screen.queryByTestId('conflict-resolution-view-use-user-version')).toBeNull()
    expect(screen.queryByTestId('conflict-resolution-view-use-server-version')).toBeNull()
  })

  it('does not render "use this version" buttons before a conflict is selected', () => {
    render(
      <ConflictResolutionView
        conflicts={CONFLICTS}
        selectedConflictId={null}
        onSelectConflict={vi.fn()}
        renderUserPanel={() => <div />}
        renderServerPanel={() => <div />}
        renderResolvedPanel={() => <div />}
        onUseUserVersion={vi.fn()}
        onUseServerVersion={vi.fn()}
      />
    )
    expect(screen.queryByTestId('conflict-resolution-view-use-user-version')).toBeNull()
  })
})
