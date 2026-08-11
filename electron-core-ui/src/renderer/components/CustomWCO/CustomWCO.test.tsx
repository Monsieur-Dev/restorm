// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import { CustomWCO } from './CustomWCO'

// react-i18next is not initialised in unit tests; echo the fallback label so
// `t('customWco.minimize', 'Minimize')` resolves to 'Minimize'.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key })
}))

afterEach(() => { cleanup() })

// CustomWCO portals its Linux button row to document.body; query the whole
// document, not just the render container.
const wcoButton = (name: 'minimize' | 'maximize' | 'close'): HTMLElement => {
  const el = document.querySelector(`[data-testid="wco-${name}"]`)
  if (!el) throw new Error(`WCO ${name} button not found`)
  return el as HTMLElement
}

describe('CustomWCO — window-control hover tooltip', () => {
  it('shows the hover tooltip by default and keeps the aria-label', () => {
    render(<CustomWCO platform="linux" data-testid="wco" />)
    const minimize = wcoButton('minimize')
    // a11y label is always present.
    expect(minimize.getAttribute('aria-label')).toBe('Minimize')
    // No native title attribute (styled tooltip only).
    expect(minimize.getAttribute('title')).toBeNull()

    act(() => { fireEvent.mouseEnter(minimize) })
    const tip = document.querySelector('.tooltip-content')
    expect(tip?.textContent).toBe('Minimize')
  })

  it('suppresses the hover tooltip when hoverTooltips=false but keeps the aria-label (no native title)', () => {
    render(<CustomWCO platform="linux" data-testid="wco" hoverTooltips={false} />)
    const minimize = wcoButton('minimize')
    expect(minimize.getAttribute('aria-label')).toBe('Minimize')
    expect(minimize.getAttribute('title')).toBeNull()

    act(() => { fireEvent.mouseEnter(minimize) })
    // No styled tooltip is rendered on hover.
    expect(document.querySelector('.tooltip-content')).toBeNull()
  })
})

describe('CustomWCO — per-platform rendering', () => {
  afterEach(() => { document.body.style.removeProperty('--wco-width') })

  it('win32: renders a right-hand spacer and reserves width', () => {
    const { container } = render(<CustomWCO platform="win32" data-testid="wco" />)
    expect(container.querySelector('.custom-wco-spacer')).not.toBeNull()
    // No custom buttons on Windows (native controls draw the min/max/close).
    expect(document.querySelector('[data-testid="wco-minimize"]')).toBeNull()
    // A non-zero reserved width is written for the layout.
    expect(document.body.style.getPropertyValue('--wco-width')).not.toBe('0px')
    expect(document.body.style.getPropertyValue('--wco-width')).not.toBe('')
  })

  it('darwin: renders nothing and reserves no width (controls are top-left)', () => {
    const { container } = render(<CustomWCO platform="darwin" data-testid="wco" />)
    // No spacer and no custom buttons — the title bar insets its left zone instead.
    expect(container.querySelector('.custom-wco-spacer')).toBeNull()
    expect(document.querySelector('[data-testid="wco-minimize"]')).toBeNull()
    expect(container.firstChild).toBeNull()
    expect(document.body.style.getPropertyValue('--wco-width')).toBe('0px')
  })
})
