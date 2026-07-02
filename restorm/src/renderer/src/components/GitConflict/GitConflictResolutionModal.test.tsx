// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import type React from 'react'

vi.mock('react-i18next', () => ({
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
  Modal: ({ isOpen, title, children }: { isOpen: boolean, title: React.ReactNode, children: React.ReactNode }) =>
    isOpen ? <div data-testid="mock-modal"><span>{title}</span>{children}</div> : null,
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
import type { ConflictEntity } from '../../services/gitConflictModel'

afterEach(() => { cleanup() })

function makeConflictResolution(overrides: Partial<UseConflictResolutionResult> = {}): UseConflictResolutionResult {
  const conflicts: ConflictEntity[] = [
    { id: 'r1', kind: 'request', name: 'Find pet', ours: { id: 'r1', name: 'Ours name' } as never, theirs: { id: 'r1', name: 'Theirs name' } as never, base: null }
  ]
  return {
    conflicts,
    selectedConflictId: 'r1',
    selectConflict: vi.fn(),
    getResolvedEntity: vi.fn(() => ({ id: 'r1', name: 'Resolved name' }) as never),
    pickOursVersion: vi.fn(),
    pickTheirsVersion: vi.fn(),
    onScenarioChange: vi.fn(),
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

  it('computes + passes the same fieldDiff to the user and server panels, none to the request-kind default fixture', () => {
    const cr = makeConflictResolution()
    render(<GitConflictResolutionModal isOpen conflictResolution={cr} onClose={vi.fn()} onFinish={vi.fn()} />)
    for (const panel of screen.getAllByTestId('mock-panel-readOnly')) {
      expect(panel.getAttribute('data-field-diff')).toBe('')
    }
  })

  it('computes + passes an identical folder notes fieldDiff to user/server (not resolved, since #4 only borders readOnly panels)', () => {
    const cr = makeConflictResolution({
      conflicts: [{
        id: 'f1',
        kind: 'folder',
        name: 'My Folder',
        ours: { id: 'f1', name: 'My Folder', notes: 'ours', tags: [], configuration: {}, items: [] } as never,
        theirs: { id: 'f1', name: 'My Folder', notes: 'theirs', tags: [], configuration: {}, items: [] } as never,
        base: null
      }],
      selectedConflictId: 'f1'
    })
    render(<GitConflictResolutionModal isOpen conflictResolution={cr} onClose={vi.fn()} onFinish={vi.fn()} />)
    const [userPanel, serverPanel] = screen.getAllByTestId('mock-panel-readOnly')
    const expectedDiff = JSON.stringify({ fields: { notes: true }, preselectTabId: 'notes' })
    expect(userPanel?.getAttribute('data-field-diff')).toBe(expectedDiff)
    expect(serverPanel?.getAttribute('data-field-diff')).toBe(expectedDiff)
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
