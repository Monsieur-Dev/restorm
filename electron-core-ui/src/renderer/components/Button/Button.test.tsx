// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { Button } from './Button'

afterEach(() => { cleanup() })

describe('Button link / externalLink appearances', () => {
  it('link: underlined label, leading icon, NO trailing external glyph', () => {
    const { container } = render(<Button link icon="home">Open</Button>)
    const anchor = container.querySelector('a.button')
    expect(anchor?.classList.contains('link-button')).toBe(true)
    expect(anchor?.classList.contains('external-link-button')).toBe(false)
    // Leading codicon icon present, label wrapped for the underline.
    expect(anchor?.querySelector('.codicon-home')).not.toBeNull()
    expect(anchor?.querySelector('.button-link-label')?.textContent).toBe('Open')
    // No trailing external-link glyph on a plain link.
    expect(anchor?.querySelector('.button-link-trailing-icon')).toBeNull()
  })

  it('externalLink: same link look PLUS the trailing codicon-link-external', () => {
    const { container } = render(<Button externalLink icon="home">Open</Button>)
    const anchor = container.querySelector('a.button')
    expect(anchor?.classList.contains('link-button')).toBe(true)
    expect(anchor?.classList.contains('external-link-button')).toBe(true)
    expect(anchor?.querySelector('.button-link-label')?.textContent).toBe('Open')
    const trailing = anchor?.querySelector('.button-link-trailing-icon')
    expect(trailing).not.toBeNull()
    expect(trailing?.classList.contains('codicon-link-external')).toBe(true)
  })

  it('a non-link button wraps neither the label nor a trailing glyph', () => {
    const { container } = render(<Button icon="home">Open</Button>)
    const anchor = container.querySelector('a.button')
    expect(anchor?.classList.contains('link-button')).toBe(false)
    expect(anchor?.querySelector('.button-link-label')).toBeNull()
    expect(anchor?.querySelector('.button-link-trailing-icon')).toBeNull()
  })

  it('link accepts a ready-made element (e.g. a Badge) as the leading icon, un-wrapped', () => {
    const badge = <span data-testid="badge">B</span>
    const { container, getByTestId } = render(<Button externalLink icon={badge}>Health</Button>)
    const anchor = container.querySelector('a.button')
    // The element renders verbatim in the leading slot (not inside the underlined label).
    const badgeEl = getByTestId('badge')
    expect(anchor?.contains(badgeEl)).toBe(true)
    expect(anchor?.querySelector('.button-link-label')?.contains(badgeEl)).toBeFalsy()
  })
})

describe('Button automation contract', () => {
  // An automation driver (MCP, an e2e step) finds the button by its test id and
  // calls `.click()` on THAT node. If the test id and the handler ever land on
  // different elements — the handler on an inner codicon span, say — every such
  // driver silently no-ops while the button still works under a real pointer.
  it('puts the test id, the click handler and the focusable role on one element', () => {
    let clicks = 0
    const { getByTestId } = render(
      <Button small icon="history" data-testid="history-button" onClick={() => { clicks += 1 }} />
    )

    const button = getByTestId('history-button')
    expect(button.tagName).toBe('A')
    expect(button.getAttribute('role')).toBe('button')
    expect(button.getAttribute('tabindex')).toBe('0')
    // The icon is a CHILD; driving the child must not be necessary.
    expect(button.querySelector('.codicon-history')).not.toBeNull()

    button.click()
    expect(clicks).toBe(1)
  })

  it('activates from the keyboard on Enter and Space', () => {
    let clicks = 0
    const { getByTestId } = render(
      <Button small icon="history" data-testid="history-button" onClick={() => { clicks += 1 }} />
    )
    const button = getByTestId('history-button')

    fireEvent.keyDown(button, { key: 'Enter' })
    expect(clicks).toBe(1)
    fireEvent.keyDown(button, { key: ' ' })
    expect(clicks).toBe(2)
  })

  it('does not fire when disabled', () => {
    let clicks = 0
    const { getByTestId } = render(
      <Button small icon="history" disabled data-testid="history-button" onClick={() => { clicks += 1 }} />
    )
    const button = getByTestId('history-button')

    button.click()
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(clicks).toBe(0)
    expect(button.getAttribute('tabindex')).toBe('-1')
  })
})
