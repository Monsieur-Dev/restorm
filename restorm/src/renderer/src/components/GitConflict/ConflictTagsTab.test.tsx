// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('electron-core-ui/renderer', () => ({
  // Must be a real CSS colour: jsdom drops anything it cannot parse.
  getColorFromString: () => '#0000ff',
  InputBox: ({ value, onChange, readOnly, 'data-testid': testId }: { value?: string, onChange?: (v: string) => void, readOnly?: boolean, 'data-testid'?: string }) =>
    <input data-testid={testId} value={value ?? ''} readOnly={readOnly ?? false} onChange={(e) => { onChange?.(e.target.value) }} />,
  Button: ({ children, onClick, 'data-testid': testId }: { children?: React.ReactNode, onClick?: () => void, 'data-testid'?: string }) =>
    <button data-testid={testId} onClick={onClick}>{children}</button>
}))

import { ConflictTagsTab } from './ConflictTagsTab'

afterEach(() => { cleanup() })

describe('ConflictTagsTab', () => {
  it('lists each tag with a colour square, read-only without a callback', () => {
    render(<ConflictTagsTab tags={['smoke', 'v1']} />)

    expect(screen.getAllByTestId('conflict-tags-row')).toHaveLength(2)
    expect(screen.getByTestId<HTMLInputElement>('conflict-tags-input-0').readOnly).toBe(true)
    // No editing affordances at all on a comparison column.
    expect(screen.queryByTestId('conflict-tags-add')).toBeNull()
    expect(screen.queryByTestId('conflict-tags-remove-0')).toBeNull()
  })

  it('renames, removes and adds in the resolved column', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ConflictTagsTab tags={['smoke', 'v1']} onChange={onChange} />)

    fireEvent.change(screen.getByTestId('conflict-tags-input-1'), { target: { value: 'v2' } })
    expect(onChange).toHaveBeenLastCalledWith(['smoke', 'v2'])

    fireEvent.click(screen.getByTestId('conflict-tags-remove-0'))
    expect(onChange).toHaveBeenLastCalledWith(['v1'])

    rerender(<ConflictTagsTab tags={['smoke']} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('conflict-tags-add'))
    expect(onChange).toHaveBeenLastCalledWith(['smoke', 'git.conflictTagNew'])
  })

  it('falls back to the name-derived colour for a tag the project has no colour for', () => {
    // A renamed tag is a new tag: it starts with no special colour, same as
    // one created anywhere else in the app.
    render(<ConflictTagsTab tags={['known', 'brand-new']} tagColors={{ known: '#123456' }} />)

    // jsdom normalises hex to rgb(); compare the computed value instead.
    const swatches = screen.getAllByTestId('conflict-tags-swatch')
    const [known, brandNew] = swatches
    expect(known?.style.backgroundColor).toBe('rgb(18, 52, 86)')
    expect(brandNew?.style.backgroundColor).toBe('rgb(0, 0, 255)')
  })

  it('says so when a side carries no tags at all', () => {
    render(<ConflictTagsTab tags={[]} />)
    expect(screen.getByTestId('conflict-tags-empty')).toBeTruthy()
  })
})
