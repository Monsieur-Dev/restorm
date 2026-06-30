// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import CustomWCO from './CustomWCO'

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
