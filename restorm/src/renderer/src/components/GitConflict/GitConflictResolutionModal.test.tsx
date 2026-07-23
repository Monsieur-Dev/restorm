// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import type React from 'react'

vi.mock('react-i18next', () => ({
  // The placeholder hint draws a codicon inline via <Trans>.
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  useTranslation: () => ({ t: (key: string) => key })
}))
// `electron-core-ui/renderer` is the full merged barrel — importing ANY
// export from it (even just Modal/Button) eagerly runs CodeEditor's
// top-level `@monaco-editor/react` import, which crashes under jsdom (see
// ConflictEntityPanel.test.tsx's own note). `ConflictResolutionView` is
// already thoroughly covered by its own test suite — mocked here as a
// thin stand-in that still exercises this component's render props +
// "use this version" wiring, not a Monaco-safe re-render of the real one.
vi.mock('electron-core-ui/renderer', () => ({
  // `HeaderHoverTooltip` (wrapping the Finish button) renders this.
  Tooltip: ({ show, content }: { show?: boolean, content?: React.ReactNode }) =>
    show === true ? <div data-testid="mock-tooltip">{content}</div> : null,
  Modal: ({ isOpen, title, children }: { isOpen: boolean, title: React.ReactNode, children: React.ReactNode }) =>
    isOpen ? <div data-testid="mock-modal"><span>{title}</span>{children}</div> : null,
  Breadcrumb: ({ items, 'data-testid': testId }: { items: { id: string, label: string }[], 'data-testid'?: string }) =>
    <nav data-testid={testId}>{items.map((item) => item.label).join(' / ')}</nav>,
  Button: ({ children, onClick, disabled, 'data-testid': testId }: {
    children: React.ReactNode, onClick?: () => void, disabled?: boolean, 'data-testid'?: string
  }) => <button data-testid={testId} onClick={onClick} disabled={disabled}>{children}</button>,
  ConflictResolutionView: ({
    selectedConflictId,
    renderUserPanel,
    renderServerPanel,
    renderResolvedPanel,
    onUseUserVersion,
    onUseServerVersion
  }: {
    selectedConflictId: string | null
    renderUserPanel: (id: string) => React.ReactNode
    renderServerPanel: (id: string) => React.ReactNode
    renderResolvedPanel: (id: string) => React.ReactNode
    onUseUserVersion?: () => void
    onUseServerVersion?: () => void
  }) => (
    <div>
      {selectedConflictId && renderUserPanel(selectedConflictId)}
      {selectedConflictId && renderServerPanel(selectedConflictId)}
      {selectedConflictId && renderResolvedPanel(selectedConflictId)}
      {onUseUserVersion && <button data-testid="conflict-resolution-view-use-user-version" onClick={onUseUserVersion} />}
      {onUseServerVersion && <button data-testid="conflict-resolution-view-use-server-version" onClick={onUseServerVersion} />}
    </div>
  )
}))
vi.mock('./ConflictEntityPanel', () => ({
  ConflictEntityPanel: ({ entity, mode, fieldDiff }: {
    entity: { id: string, name: string }, mode: string, fieldDiff?: { fields: Record<string, boolean>, preselectTabId?: string }
  }) => (
    <div data-testid={`mock-panel-${mode}`} data-field-diff={fieldDiff ? JSON.stringify(fieldDiff) : ''}>
      {entity.id}:{entity.name}
    </div>
  )
}))

import { GitConflictResolutionModal } from './GitConflictResolutionModal'
import type { UseConflictResolutionResult } from '../../hooks/useConflictResolution'
import type { ConflictEntity } from '../../../../shared/git/gitConflictModel'

afterEach(() => { cleanup() })

function makeConflictResolution(overrides: Partial<UseConflictResolutionResult> = {}): UseConflictResolutionResult {
  const conflicts: ConflictEntity[] = [
    { id: 'r1', kind: 'request', name: 'Find pet', ours: { id: 'r1', name: 'Ours name' } as never, theirs: { id: 'r1', name: 'Theirs name' } as never, base: null, pathSegments: ['Petstore', 'Pets'] }
  ]
  return {
    conflicts,
    selectedConflictId: 'r1',
    selectConflict: vi.fn(),
    getResolvedEntity: vi.fn(() => ({ id: 'r1', name: 'Resolved name' }) as never),
    isResolved: vi.fn(() => true),
    allResolved: true,
    resolveItemOnSide: vi.fn(() => null),
    setResolvedName: vi.fn(),
    setResolvedTags: vi.fn(),
    pickOursVersion: vi.fn(),
    pickTheirsVersion: vi.fn(),
    onScenarioChange: vi.fn(),
    quickConfigPicks: {},
    pickQuickConfigVersion: vi.fn(),
    resolvedEpochById: {},
    pickedSideById: {},
    onResolvedEdited: vi.fn(),
    ...overrides
  }
}

describe('GitConflictResolutionModal', () => {
  it('renders the user/server/resolved panels via ConflictEntityPanel for the selected conflict', () => {
    const cr = makeConflictResolution()
    render(<GitConflictResolutionModal isOpen conflictResolution={cr} onClose={vi.fn()} onFinish={vi.fn()} />)
    const readOnlyPanels = screen.getAllByTestId('mock-panel-readOnly')
    expect(readOnlyPanels).toHaveLength(2)
    expect(readOnlyPanels.map((el) => el.textContent)).toEqual(['r1:Ours name', 'r1:Theirs name'])
    expect(screen.getByTestId('mock-panel-editable').textContent).toBe('r1:Resolved name')
  })

  it('shows the identity band: ONE plain breadcrumb ending with the conflicting entity itself', () => {
    render(
      <GitConflictResolutionModal isOpen conflictResolution={makeConflictResolution()} onClose={vi.fn()} onFinish={vi.fn()} />
    )
    expect(screen.getByTestId('git-conflict-entity-breadcrumb').textContent).toBe('Petstore / Pets / Find pet')
  })

  it('calls onClose from the Cancel button', () => {
    const onClose = vi.fn()
    render(<GitConflictResolutionModal isOpen conflictResolution={makeConflictResolution()} onClose={onClose} onFinish={vi.fn()} />)
    fireEvent.click(screen.getByTestId('git-conflict-resolution-cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onFinish from the Finish button', () => {
    const onFinish = vi.fn()
    render(<GitConflictResolutionModal isOpen conflictResolution={makeConflictResolution()} onClose={vi.fn()} onFinish={onFinish} />)
    fireEvent.click(screen.getByTestId('git-conflict-resolution-finish'))
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('the Finish button is disabled when there are no conflicts', () => {
    render(
      <GitConflictResolutionModal
        isOpen
        conflictResolution={makeConflictResolution({ conflicts: [], selectedConflictId: null })}
        onClose={vi.fn()}
        onFinish={vi.fn()}
      />
    )
    expect(screen.getByTestId('git-conflict-resolution-finish')).toHaveProperty('disabled', true)
  })

  it('computes + passes the same fieldDiff to the user and server panels', () => {
    // The default fixture's two sides carry different names, so the diff
    // is no longer empty: a rename is now something the panels can show.
    const cr = makeConflictResolution()
    render(<GitConflictResolutionModal isOpen conflictResolution={cr} onClose={vi.fn()} onFinish={vi.fn()} />)
    const panels = screen.getAllByTestId('mock-panel-readOnly')
    expect(panels.length).toBeGreaterThan(0)
    const diffs = panels.map((panel) => panel.getAttribute('data-field-diff'))
    expect(new Set(diffs).size).toBe(1)
    expect(diffs[0]).toContain('name')
  })

  it('computes + passes an identical folder notes fieldDiff to user/server (not resolved, since #4 only borders readOnly panels)', () => {
    const cr = makeConflictResolution({
      conflicts: [{
        id: 'f1',
        kind: 'folder',
        name: 'My Folder',
        pathSegments: [],
        ours: { id: 'f1', name: 'My Folder', notes: 'ours', tags: [], configuration: {}, items: [] } as never,
        theirs: { id: 'f1', name: 'My Folder', notes: 'theirs', tags: [], configuration: {}, items: [] } as never,
        base: null
      }],
      selectedConflictId: 'f1'
    })
    render(<GitConflictResolutionModal isOpen conflictResolution={cr} onClose={vi.fn()} onFinish={vi.fn()} />)
    const [userPanel, serverPanel] = screen.getAllByTestId('mock-panel-readOnly')
    const parse = (p: HTMLElement | undefined): { fields: Record<string, boolean>; preselectTabId?: string } =>
      JSON.parse(p?.getAttribute('data-field-diff') ?? '{}') as { fields: Record<string, boolean>; preselectTabId?: string }
    for (const panel of [userPanel, serverPanel]) {
      expect(parse(panel).fields['notes']).toBe(true)
      expect(parse(panel).preselectTabId).toBe('notes')
    }
  })

  it('wires "use this version" to pickOursVersion/pickTheirsVersion for the selected conflict', () => {
    const cr = makeConflictResolution()
    render(<GitConflictResolutionModal isOpen conflictResolution={cr} onClose={vi.fn()} onFinish={vi.fn()} />)
    fireEvent.click(screen.getByTestId('conflict-resolution-view-use-user-version'))
    expect(cr.pickOursVersion).toHaveBeenCalledWith('r1')
    fireEvent.click(screen.getByTestId('conflict-resolution-view-use-server-version'))
    expect(cr.pickTheirsVersion).toHaveBeenCalledWith('r1')
  })
})

describe('an undecided conflict cannot be published', () => {
  it('shows a prompt instead of a pre-filled resolution when no side is picked', () => {
    render(
      <GitConflictResolutionModal
        isOpen
        conflictResolution={makeConflictResolution({
          getResolvedEntity: vi.fn(() => null),
          isResolved: vi.fn(() => false),
          allResolved: false
        })}
        onClose={vi.fn()}
        onFinish={vi.fn()}
      />
    )
    // The resolved column must read as "your move", not as an answer we
    // picked on the user's behalf.
    expect(screen.getByTestId('conflict-resolved-placeholder')).toBeTruthy()
  })

  it('disables Finish while at least one conflict is undecided', () => {
    const onFinish = vi.fn()
    render(
      <GitConflictResolutionModal
        isOpen
        conflictResolution={makeConflictResolution({
          getResolvedEntity: vi.fn(() => null),
          isResolved: vi.fn(() => false),
          allResolved: false
        })}
        onClose={vi.fn()}
        onFinish={onFinish}
      />
    )
    const finish = screen.getByTestId('git-conflict-resolution-finish')
    expect(finish.hasAttribute('disabled')).toBe(true)
  })

  it('enables Finish once every conflict has been decided', () => {
    render(
      <GitConflictResolutionModal
        isOpen
        conflictResolution={makeConflictResolution({ allResolved: true })}
        onClose={vi.fn()}
        onFinish={vi.fn()}
      />
    )
    const finish = screen.getByTestId('git-conflict-resolution-finish')
    expect(finish.hasAttribute('disabled')).toBe(false)
  })
})
