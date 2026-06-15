import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'

// react-i18next is not initialized in unit tests; `useTranslation` then echoes
// the supplied default value. We query the menu/config by `data-testid` (stable
// regardless of locale) and only rely on labels via those defaults.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key
  })
}))

// ECUI resolves to its built dist in vitest, whose CSS side-imports don't
// resolve. Stub the module with minimal DOM-rendering components that preserve
// the props this test relies on (data-testid + onClick wiring). `ContextMenu`
// replicates the real inline submenu recursion so submenu children land in the
// DOM with their testids; `Button` renders a real <button> so a click fires.
interface MenuItemLike {
  id?: string
  isSeparator?: boolean
  items?: MenuItemLike[]
  onClick?: () => void
  'data-testid'?: string
  label?: string
}
vi.mock('electron-core-ui/renderer', () => {
  const passthrough = ({ children }: { children?: ReactNode }): ReactNode =>
    createElement('div', {}, children)
  const Button = (props: {
    onClick?: (e: unknown) => void
    'data-testid'?: string
    options?: { ariaLabel?: string }
  }): ReactNode =>
    createElement('button', {
      type: 'button',
      ...(props['data-testid'] ? { 'data-testid': props['data-testid'] } : {}),
      ...(props.options?.ariaLabel ? { 'aria-label': props.options.ariaLabel } : {}),
      ...(props.onClick ? { onClick: props.onClick } : {})
    })
  const InputBox = (props: { 'data-testid'?: string }): ReactNode =>
    createElement('input', { ...(props['data-testid'] ? { 'data-testid': props['data-testid'] } : {}) })
  const SelectBox = (props: { 'data-testid'?: string }): ReactNode =>
    createElement('select', { ...(props['data-testid'] ? { 'data-testid': props['data-testid'] } : {}) })
  const renderMenu = (items: MenuItemLike[]): ReactNode =>
    items.map((item) => {
      if (item.isSeparator) return createElement('li', { key: item.id, role: 'separator' })
      const hasSub = Array.isArray(item.items) && item.items.length > 0
      return createElement(
        'li',
        {
          key: item.id,
          role: 'menuitem',
          ...(item['data-testid'] ? { 'data-testid': item['data-testid'] } : {}),
          ...(item.onClick ? { onClick: () => { item.onClick?.() } } : {})
        },
        hasSub ? renderMenu(item.items ?? []) : item.label
      )
    })
  const ContextMenu = (props: { visible?: boolean; items: MenuItemLike[]; 'data-testid'?: string }): ReactNode =>
    props.visible
      ? createElement(
          'ul',
          { role: 'menu', ...(props['data-testid'] ? { 'data-testid': props['data-testid'] } : {}) },
          renderMenu(props.items)
        )
      : null
  const Modal = (props: { isOpen?: boolean; children?: ReactNode }): ReactNode =>
    props.isOpen ? createElement('div', { role: 'dialog' }, props.children) : null
  return {
    __esModule: true,
    Button,
    InputBox,
    SelectBox,
    ContextMenu,
    Modal,
    ControlGroup: passthrough,
    Tooltip: () => null,
    ColorPicker: () => null,
    DateTimePicker: () => null,
    Toggle: () => null,
    MultiSelectCombo: () => null
  }
})

import { TypedValueField } from './TypedValueField'
import { registerRendererSources } from '../../secrets/registerRendererSources'
import { StringValue } from '../../../../shared/types/collections'
import { SecretValue } from '../../../../shared/types/valueTypes/SecretValue'
import type { ValueType } from '../../../../shared/types/collections'

// The envVar cell resolves on mount + refresh via window.restorm.secrets — stub the bridge.
beforeAll(() => {
  registerRendererSources()
  ;(window as unknown as {
    restorm: {
      secrets: {
        invalidate: () => Promise<{ success: boolean }>
        resolve: () => Promise<{ value: string }>
      }
    }
  }).restorm = {
    secrets: {
      invalidate: () => Promise.resolve({ success: true }),
      resolve: () => Promise.resolve({ value: '' })
    }
  }
})

afterEach(() => {
  cleanup()
})

const TID = 'tvf'

/** Query one element, failing the test (and narrowing the type) if it's absent. */
function must(root: ParentNode, selector: string): Element {
  const el = root.querySelector(selector)
  if (!el) throw new Error(`expected an element matching ${selector}`)
  return el
}

/** Render the field with a controlled value, returning the captured onChange. */
function renderField(initial: ValueType): { onChange: ReturnType<typeof vi.fn>; container: HTMLElement } {
  const onChange = vi.fn()
  const { container } = render(
    createElement(TypedValueField, { value: initial, onChange, dataTestId: TID })
  )
  return { onChange, container }
}

/** Open the type-pick menu by clicking the type-indicator button. */
function openMenu(container: HTMLElement): void {
  const indicator = must(container, `[data-testid="${TID}-value-type-string"]`)
  fireEvent.click(indicator)
}

describe('TypedValueField — Autres (secret sources) submenu', () => {
  it('lists every registered value source under the Autres submenu', () => {
    const { container } = renderField(new StringValue('x'))
    openMenu(container)

    // The submenu parent + one child per registered descriptor.
    expect(document.querySelector(`[data-testid="${TID}-context-menu-secret"]`)).toBeTruthy()
    expect(
      document.querySelector(`[data-testid="${TID}-context-menu-item-secret-envFileSecret"]`)
    ).toBeTruthy()
    expect(
      document.querySelector(`[data-testid="${TID}-context-menu-item-secret-envVar"]`)
    ).toBeTruthy()
  })

  it('casts to SecretValue(envVar, {}) when the Env var child is selected', () => {
    const { container, onChange } = renderField(new StringValue('x'))
    openMenu(container)

    const envVarItem = must(document, `[data-testid="${TID}-context-menu-item-secret-envVar"]`)
    fireEvent.click(envVarItem)

    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0]?.[0] as SecretValue
    expect(next).toBeDefined()
    expect(next).toBeInstanceOf(SecretValue)
    expect(next.source).toBe('envVar')
    expect(next.params).toEqual({})
  })

  // The refresh slot is a button when idle, or a spinner while a resolution is
  // in flight — on mount the cell kicks off a resolve, so either may be present.
  const hasRefreshAffordance = (container: HTMLElement): boolean =>
    Boolean(
      container.querySelector(`[data-testid="${TID}-secret-refresh"]`) ??
        container.querySelector(`[data-testid="${TID}-secret-refreshing"]`)
    )

  it('renders the unified read-only preview + refresh/edit actions for a SecretValue(envVar)', () => {
    const { container } = renderField(new SecretValue('envVar', { name: 'PATH' }))
    // Every source shows the same default chrome: a read-only resolved-value
    // preview + refresh + an always-present pencil. Configuring the retrieval
    // (the env-var name) lives in the pencil modal, not inline in the cell.
    expect(container.querySelector(`[data-testid="${TID}-secret-preview"]`)).toBeTruthy()
    expect(hasRefreshAffordance(container)).toBe(true)
    expect(container.querySelector(`[data-testid="${TID}-secret-edit"]`)).toBeTruthy()
    expect(container.querySelector(`[data-testid="${TID}-config-param-name"]`)).toBeNull()
  })

  it('uses the same default chrome for a custom-config source (envFileSecret) — config moved to the modal', () => {
    const { container } = renderField(new SecretValue('envFileSecret', {}))
    expect(container.querySelector(`[data-testid="${TID}-secret-preview"]`)).toBeTruthy()
    expect(hasRefreshAffordance(container)).toBe(true)
    expect(container.querySelector(`[data-testid="${TID}-secret-edit"]`)).toBeTruthy()
    // The masked write-field is no longer inline; it lives in the (closed) modal.
    expect(container.querySelector(`[data-testid="${TID}-config-envfilesecret"]`)).toBeNull()
  })
})
