import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'

// A plain `StringValue` is LITERAL: it is never Handlebars-resolved on the way
// to the wire — only an `ExpressionValue` opts into resolution (via the
// type-pick menu). So the text widget must stay a bare `InputBox`: giving it
// the `{{}}`-highlighting editor would advertise a substitution that never
// happens. This pins both halves — text is plain, expression stays aware.

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key
  })
}))

// ECUI resolves to its built dist in vitest, whose CSS side-imports don't
// resolve. Minimal DOM-rendering stubs, preserving the testids asserted below.
vi.mock('electron-core-ui/renderer', () => {
  const passthrough = ({ children }: { children?: ReactNode }): ReactNode =>
    createElement('div', {}, children)
  const InputBox = (props: { 'data-testid'?: string }): ReactNode =>
    createElement('input', {
      ...(props['data-testid'] ? { 'data-testid': props['data-testid'] } : {})
    })
  return {
    __esModule: true,
    InputBox,
    Button: () => null,
    SelectBox: () => null,
    ContextMenu: () => null,
    Modal: () => null,
    ControlGroup: passthrough,
    Tooltip: () => null,
    ColorPicker: () => null,
    DateTimePicker: () => null,
    Toggle: () => null,
    MultiSelectCombo: () => null
  }
})

// The variable-aware editor is Monaco-backed and unrenderable in jsdom — stand
// it in with a marker so its presence/absence is directly assertable.
vi.mock('../RestormVariableInputBox', () => ({
  RestormVariableInputBox: (props: { 'data-testid'?: string }): ReactNode =>
    createElement('div', {
      'data-variable-aware': 'true',
      ...(props['data-testid'] ? { 'data-testid': props['data-testid'] } : {})
    })
}))

import { TypedValueField } from './TypedValueField'
import { StringValue, ExpressionValue } from '../../../../shared/types/collections'
import type { ValueType } from '../../../../shared/types/collections'

afterEach(() => {
  cleanup()
})

const TID = 'tvf'

function renderField(initial: ValueType): HTMLElement {
  const { container } = render(
    createElement(TypedValueField, { value: initial, onChange: vi.fn(), dataTestId: TID })
  )
  return container
}

describe('TypedValueField — a text value is literal, an expression is variable-aware', () => {
  it('renders a plain InputBox (no {{}} highlighting) for a StringValue', () => {
    const container = renderField(new StringValue('{{token}}'))

    const widget = container.querySelector(`[data-testid="${TID}-value-input-string"]`)
    expect(widget, 'the string widget renders').toBeTruthy()
    expect(widget?.tagName).toBe('INPUT')
    // No variable-aware editor anywhere in the cell, even though the literal
    // text happens to look like a template.
    expect(container.querySelector('[data-variable-aware="true"]')).toBeNull()
  })

  it('keeps the variable-aware editor for an ExpressionValue', () => {
    const container = renderField(new ExpressionValue('{{token}}'))

    const widget = container.querySelector(`[data-testid="${TID}-value-input-expression"]`)
    expect(widget, 'the expression widget renders').toBeTruthy()
    expect(widget?.getAttribute('data-variable-aware')).toBe('true')
  })
})
