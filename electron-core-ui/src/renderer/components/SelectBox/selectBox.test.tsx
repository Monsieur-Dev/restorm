// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import SelectBoxList from './selectBoxCustom'
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
