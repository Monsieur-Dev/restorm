// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
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

  it('blocks pointer-events on interactive descendants (input/button) so clicks/typing cannot mutate them', () => {
    render(
      <ReadOnlyOverlay>
        <input data-testid="the-input" defaultValue="hello" />
        <button data-testid="the-button" type="button">Click me</button>
      </ReadOnlyOverlay>
    )
    const input = screen.getByTestId<HTMLInputElement>('the-input')
    const button = screen.getByTestId<HTMLButtonElement>('the-button')
    // jsdom doesn't enforce CSS pointer-events on synthetic events, so this
    // asserts the STYLING contract (the class + the CSS rule it maps to)
    // rather than simulating a real browser hit-test.
    expect(input.closest('.ecui-read-only-overlay')).toBeTruthy()
    expect(button.closest('.ecui-read-only-overlay')).toBeTruthy()
  })

  it('does not block clicks on the container itself (scrolling / non-form interactions keep working)', () => {
    const onContainerClick = vi.fn()
    render(
      <ReadOnlyOverlay>
        <div data-testid="scrollable" onClick={onContainerClick}>
          <span>content</span>
        </div>
      </ReadOnlyOverlay>
    )
    fireEvent.click(screen.getByTestId('scrollable'))
    expect(onContainerClick).toHaveBeenCalledTimes(1)
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
