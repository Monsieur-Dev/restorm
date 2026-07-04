// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
// Stand in for the ECUI SelectBox with a native <select> so the value +
// selection callback are drivable without pulling the barrel (Monaco) in.
vi.mock('electron-core-ui/renderer', () => ({
  SelectBox: ({ options, selected, onDidSelect, 'data-testid': testId }: {
    options: { text: string, label: string }[]
    selected: number
    onDidSelect: (d: { index: number }) => void
    'data-testid'?: string
  }) => (
    <select
      data-testid={testId}
      data-selected={selected}
      value={selected}
      onChange={(e) => { onDidSelect({ index: Number(e.target.value) }) }}
    >
      {options.map((o, i) => <option key={o.text} value={i}>{o.label}</option>)}
    </select>
  )
}))

import { ConflictQuickConfigBand } from './ConflictQuickConfigBand'

afterEach(() => { cleanup() })

describe('ConflictQuickConfigBand', () => {
  it('renders nothing when there are no conflicting configs', () => {
    const { container } = render(<ConflictQuickConfigBand mode="editable" conflictingNames={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('editable mode: one row per config with a picker reflecting the current side', () => {
    render(
      <ConflictQuickConfigBand
        mode="editable"
        conflictingNames={['Staging', 'Prod']}
        currentSides={{ Staging: 'theirs' }}
        onPick={vi.fn()}
        data-testid="band"
      />
    )
    expect(screen.getByTestId('conflict-quick-config-row-Staging')).toBeTruthy()
    expect(screen.getByTestId('conflict-quick-config-row-Prod')).toBeTruthy()
    // Explicit 'theirs' → index 1; unset defaults to 'ours' → index 0.
    expect(screen.getByTestId('conflict-quick-config-select-Staging').getAttribute('data-selected')).toBe('1')
    expect(screen.getByTestId('conflict-quick-config-select-Prod').getAttribute('data-selected')).toBe('0')
  })

  it('editable mode: picking a side calls onPick with the config name and chosen side', () => {
    const onPick = vi.fn()
    render(
      <ConflictQuickConfigBand
        mode="editable"
        conflictingNames={['Staging']}
        currentSides={{ Staging: 'theirs' }}
        onPick={onPick}
      />
    )
    fireEvent.change(screen.getByTestId('conflict-quick-config-select-Staging'), { target: { value: '0' } })
    expect(onPick).toHaveBeenCalledWith('Staging', 'ours')
  })

  it('read-only mode: flags the conflicting configs but shows no picker (the mirror)', () => {
    render(<ConflictQuickConfigBand mode="readOnly" conflictingNames={['Staging']} data-testid="band" />)
    expect(screen.getByTestId('conflict-quick-config-row-Staging')).toBeTruthy()
    expect(screen.queryByTestId('conflict-quick-config-select-Staging')).toBeNull()
  })
})
