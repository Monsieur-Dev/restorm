import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'

// A header / param / metadata KEY *is* Handlebars-resolved at execution time,
// so its cell must offer the variable-aware editor ({{}} highlighting +
// autocomplete) — but only where the caller opts in via `variableAware`. Every
// other consumer of this table (env-folder variables, the body form-fields
// table, …) must keep the plain `InputBox`. This pins both directions of that
// switch; nothing else asserted it.

// ECUI resolves to its built dist in vitest, whose CSS side-imports don't
// resolve. Stub it with a `KeyValueTable` that just drives the key-cell
// renderer over the supplied rows — the wiring under test is which editor
// `renderKeyCell` returns, not the table's own row chrome.
interface RowLike { id?: string; key?: string; value?: string }
vi.mock('electron-core-ui/renderer', () => {
  const InputBox = (props: { 'data-testid'?: string; disabled?: boolean }): ReactNode =>
    createElement('input', {
      'data-variable-aware': 'false',
      ...(props['data-testid'] ? { 'data-testid': props['data-testid'] } : {}),
      ...(props.disabled ? { disabled: true } : {})
    })
  const KeyValueTable = (props: {
    initialRows?: RowLike[]
    renderKeyCell?: (p: { value: string; onChange: (v: string) => void; rowId?: string }) => ReactNode
  }): ReactNode =>
    createElement(
      'div',
      {},
      (props.initialRows ?? []).map((row, i) =>
        createElement(
          'div',
          { key: row.id ?? String(i) },
          props.renderKeyCell?.({
            value: row.key ?? '',
            onChange: vi.fn(),
            ...(row.id !== undefined && { rowId: row.id })
          })
        )
      )
    )
  return {
    __esModule: true,
    InputBox,
    KeyValueTable,
    fieldDiffStyle: () => ({})
  }
})

// The variable-aware editor is Monaco-backed and unrenderable in jsdom — stand
// it in with a marker carrying the same testid, so the assertion is purely
// "which of the two editors did the key cell pick".
vi.mock('../RestormVariableInputBox', () => ({
  RestormVariableInputBox: (props: { 'data-testid'?: string }): ReactNode =>
    createElement('div', {
      'data-variable-aware': 'true',
      ...(props['data-testid'] ? { 'data-testid': props['data-testid'] } : {})
    })
}))

// The VALUE cell is out of scope here (and pulls the whole per-type widget
// fan-out with it).
vi.mock('../TypedValueField', () => ({ TypedValueField: (): ReactNode => null }))

// The type-pick groups come from the live store — irrelevant to the key cell.
vi.mock('../../hooks/useAllEnvValueTypeGroups', () => ({
  useAllEnvValueTypeGroups: () => []
}))

import { RestormKeyValueTable } from './RestormKeyValueTable'
import { StringValue } from '../../../../shared/types/collections'

afterEach(() => {
  cleanup()
})

const TID = 'hdr'

function renderTable(variableAware: boolean): HTMLElement {
  const { container } = render(
    createElement(RestormKeyValueTable, {
      variables: [],
      initialRows: [{ id: 'r1', key: 'X-Trace', value: new StringValue('abc'), enabled: true }],
      'data-testid': TID,
      variableAware
    })
  )
  return container
}

describe('RestormKeyValueTable — key cell editor', () => {
  it('renders the variable-aware editor in the KEY cell when `variableAware` is set', () => {
    const container = renderTable(true)

    const cell = container.querySelector(`[data-testid="${TID}-key-input"]`)
    expect(cell, 'the key cell renders').toBeTruthy()
    expect(cell?.getAttribute('data-variable-aware')).toBe('true')
    // …and specifically NOT the plain input.
    expect(container.querySelector(`input[data-testid="${TID}-key-input"]`)).toBeNull()
  })

  it('renders a plain InputBox in the KEY cell when `variableAware` is not set', () => {
    const container = renderTable(false)

    const cell = container.querySelector(`[data-testid="${TID}-key-input"]`)
    expect(cell, 'the key cell renders').toBeTruthy()
    expect(cell?.tagName).toBe('INPUT')
    expect(cell?.getAttribute('data-variable-aware')).toBe('false')
  })
})
