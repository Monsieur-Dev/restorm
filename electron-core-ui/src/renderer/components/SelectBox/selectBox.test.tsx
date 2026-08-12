// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { SelectBoxList } from './selectBoxCustom'
import { defaultSelectBoxStyles, type ISelectOptionItem } from './types'

// jsdom ships no ResizeObserver; the open dropdown mounts a
// ScrollableElement which constructs one. A no-op stub lets the tree render.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe(): void { /* no-op */ }
    unobserve(): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
  } as unknown as typeof ResizeObserver
})

afterEach(() => { cleanup() })

const options: ISelectOptionItem[] = [{ text: 'unary' }, { text: 'server-stream' }]

describe('SelectBox disabled prop (custom-drawn dropdown)', () => {
  it('enabled: clicking the trigger opens the dropdown', () => {
    const { getByTestId, container } = render(
      <SelectBoxList
        options={options}
        selected={0}
        onDidSelect={vi.fn()}
        selectBoxOptions={{}}
        styles={defaultSelectBoxStyles}
        className=""
        id="call-type"
      />
    )
    fireEvent.click(getByTestId('call-type-trigger'))
    expect(container.querySelector('[data-is-open="true"]')).not.toBeNull()
  })

  it('disabled: greyed, inert to click (dropdown never opens), no selection change', () => {
    const onDidSelect = vi.fn()
    const { getByTestId, container } = render(
      <SelectBoxList
        options={options}
        selected={0}
        onDidSelect={onDidSelect}
        selectBoxOptions={{}}
        styles={defaultSelectBoxStyles}
        className=""
        id="call-type"
        disabled
      />
    )
    const trigger = getByTestId('call-type-trigger')
    expect(trigger.classList.contains('disabled')).toBe(true)
    expect(trigger.getAttribute('aria-disabled')).toBe('true')
    expect(trigger.getAttribute('tabindex')).toBe('-1')

    fireEvent.click(trigger)
    expect(container.querySelector('[data-is-open="true"]')).toBeNull()

    // The native fallback <select> stays a real disabled element too — no
    // keyboard path around the click guard.
    expect(getByTestId('call-type-select')).toHaveProperty('disabled', true)
    expect(onDidSelect).not.toHaveBeenCalled()
  })
})

describe('SelectBox editable (combobox) mode', () => {
  const verbs: ISelectOptionItem[] = [{ text: 'GET' }, { text: 'POST' }, { text: 'PUT' }]

  function renderEditable(onDidSelect = vi.fn(), selected = 0): ReturnType<typeof render> & { onDidSelect: ReturnType<typeof vi.fn> } {
    const utils = render(
      <SelectBoxList
        options={verbs}
        selected={selected}
        onDidSelect={onDidSelect}
        selectBoxOptions={{ editable: true }}
        styles={defaultSelectBoxStyles}
        className=""
        id="method"
      />
    )
    return Object.assign(utils, { onDidSelect })
  }

  function openAndType(utils: ReturnType<typeof render>, text: string): HTMLInputElement {
    fireEvent.click(utils.getByTestId('method-trigger'))
    const entry = document.querySelector<HTMLInputElement>('.dropdown-filter-row input')
    if (entry === null) throw new Error('editable entry row not rendered')
    fireEvent.change(entry, { target: { value: text } })
    return entry
  }

  it('always renders the free-text entry row, even under the filter threshold', () => {
    const utils = renderEditable()
    fireEvent.click(utils.getByTestId('method-trigger'))
    expect(document.querySelector('.dropdown-filter-row input')).not.toBeNull()
  })

  it('Enter commits the typed text VERBATIM with index -1, even when it matches an option case-insensitively', () => {
    const onDidSelect = vi.fn()
    const utils = renderEditable(onDidSelect)
    const entry = openAndType(utils, 'Post')
    fireEvent.keyDown(entry, { key: 'Enter' })
    expect(onDidSelect).toHaveBeenCalledWith({ selected: 'Post', index: -1 })
    // Committing closes the popup.
    expect(utils.container.querySelector('[data-is-open="true"]')).toBeNull()
  })

  it('Enter commits unknown text when the filtered list is empty', () => {
    const onDidSelect = vi.fn()
    const utils = renderEditable(onDidSelect)
    const entry = openAndType(utils, 'Machin')
    fireEvent.keyDown(entry, { key: 'Enter' })
    expect(onDidSelect).toHaveBeenCalledWith({ selected: 'Machin', index: -1 })
  })

  it('ArrowDown then Enter picks the focused option instead of the raw text', () => {
    const onDidSelect = vi.fn()
    const utils = renderEditable(onDidSelect)
    const entry = openAndType(utils, 'P')
    fireEvent.keyDown(entry, { key: 'ArrowDown' })
    fireEvent.keyDown(entry, { key: 'Enter' })
    expect(onDidSelect).toHaveBeenCalledTimes(1)
    const arg = onDidSelect.mock.calls[0]?.[0] as { selected: string; index: number }
    expect(arg.index).toBeGreaterThanOrEqual(0)
    expect(['GET', 'POST', 'PUT']).toContain(arg.selected)
  })

  it('a free-text commit clears a stale internal pick (same-index custom verb replacement)', () => {
    // Reproduces the resurrection bug: pick an option (internal selection
    // set), commit a custom verb, then commit ANOTHER custom verb that lands
    // at the SAME index — the trigger must show the new text, not the old
    // pick.
    const onDidSelect = vi.fn()
    const utils = renderEditable(onDidSelect, 0)
    // Pick POST (sets internalState.selection = 1).
    fireEvent.click(utils.getByTestId('method-trigger'))
    fireEvent.click(utils.getByTestId('method-option-1'))
    expect(onDidSelect).toHaveBeenLastCalledWith({ selected: 'POST', index: 1 })
    // Free-commit — after this the host would re-render with a new options
    // array; here the internal state must have been dropped so the trigger
    // follows the `selected` prop, not the stale internal pick.
    const entry = openAndType(utils, 'TeSt')
    fireEvent.keyDown(entry, { key: 'Enter' })
    expect(onDidSelect).toHaveBeenLastCalledWith({ selected: 'TeSt', index: -1 })
    expect(utils.getByTestId('method')).toHaveProperty('dataset', expect.objectContaining({ selectedIndex: '0' }))
  })
})
