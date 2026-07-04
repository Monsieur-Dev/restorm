// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { ReadOnlyOverlay } from './ReadOnlyOverlay'

afterEach(() => { cleanup() })

describe('ReadOnlyOverlay', () => {
  it('renders its children unmodified (same DOM, same text)', () => {
    render(
      <ReadOnlyOverlay>
        <div data-testid="inner">
          <input data-testid="the-input" defaultValue="hello" />
        </div>
      </ReadOnlyOverlay>
    )
    expect(screen.getByTestId('inner')).toBeTruthy()
    expect(screen.getByTestId<HTMLInputElement>('the-input').value).toBe('hello')
  })

  it('marks the wrapper `inert` so the whole subtree is keyboard- and pointer-inert', () => {
    render(
      <ReadOnlyOverlay data-testid="overlay">
        <input data-testid="the-input" defaultValue="hello" />
        <button data-testid="the-button" type="button">Click me</button>
      </ReadOnlyOverlay>
    )
    // `inert` on the wrapper takes the whole subtree out of the tab order and
    // blocks focus/typing/clicks — the keyboard gap that pointer-events alone
    // left open. jsdom reflects the attribute even though it doesn't simulate
    // the hit-test, so assert the attribute is present on the wrapper.
    const overlay = screen.getByTestId('overlay')
    expect(overlay.hasAttribute('inert')).toBe(true)
  })

  it('keeps the scoped pointer-events fallback class on the wrapper', () => {
    render(
      <ReadOnlyOverlay>
        <input data-testid="the-input" defaultValue="hello" />
      </ReadOnlyOverlay>
    )
    // The CSS `pointer-events: none` rule is retained as a fallback for any
    // environment that doesn't honour `inert`; it hangs off this class.
    expect(screen.getByTestId<HTMLInputElement>('the-input').closest('.ecui-read-only-overlay')).toBeTruthy()
  })

  it('supports a data-testid on the overlay wrapper', () => {
    render(
      <ReadOnlyOverlay data-testid="my-overlay">
        <div />
      </ReadOnlyOverlay>
    )
    expect(screen.getByTestId('my-overlay')).toBeTruthy()
  })
})
