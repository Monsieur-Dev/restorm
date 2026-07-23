// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
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

  it('blocks clicks on arbitrary controls (a button never sees the click)', () => {
    const onClick = vi.fn()
    render(
      <ReadOnlyOverlay>
        <button data-testid="the-button" type="button" onClick={onClick}>Click me</button>
      </ReadOnlyOverlay>
    )
    fireEvent.click(screen.getByTestId('the-button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('lets navigation clicks through: a [role=tab] target still receives its click', () => {
    const onClick = vi.fn()
    render(
      <ReadOnlyOverlay>
        <div role="tablist">
          <div role="tab" data-testid="the-tab" onClick={onClick}>Docs</div>
        </div>
      </ReadOnlyOverlay>
    )
    fireEvent.click(screen.getByTestId('the-tab'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('lets a SplitView pane header toggle through, but NOT its header-actions cluster', () => {
    const onHeaderClick = vi.fn()
    const onActionClick = vi.fn()
    render(
      <ReadOnlyOverlay>
        <div className="split-view-view-header" data-testid="the-header" onClick={onHeaderClick}>
          <span className="split-view-view-header-title">En-têtes</span>
          <div className="split-view-view-header-actions">
            <span data-testid="the-action" onClick={onActionClick}>+</span>
          </div>
        </div>
      </ReadOnlyOverlay>
    )
    fireEvent.click(screen.getByTestId('the-header'))
    expect(onHeaderClick).toHaveBeenCalledTimes(1)
    onHeaderClick.mockClear()
    fireEvent.click(screen.getByTestId('the-action'))
    expect(onActionClick).not.toHaveBeenCalled()
    expect(onHeaderClick).not.toHaveBeenCalled()
  })

  it('blocks text input: beforeinput and paste never reach a field', () => {
    const onBeforeInput = vi.fn()
    const onPaste = vi.fn()
    render(
      <ReadOnlyOverlay>
        <input data-testid="the-input" onBeforeInput={onBeforeInput} onPaste={onPaste} defaultValue="hello" />
      </ReadOnlyOverlay>
    )
    const input = screen.getByTestId('the-input')
    fireEvent(input, new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: 'x' }))
    fireEvent.paste(input)
    expect(onBeforeInput).not.toHaveBeenCalled()
    expect(onPaste).not.toHaveBeenCalled()
  })

  it('blocks mutating keys but allows navigation keys and copy', () => {
    const onKeyDown = vi.fn()
    render(
      <ReadOnlyOverlay>
        <input data-testid="the-input" onKeyDown={onKeyDown} defaultValue="hello" />
      </ReadOnlyOverlay>
    )
    const input = screen.getByTestId('the-input')
    fireEvent.keyDown(input, { key: 'x' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onKeyDown).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'c', ctrlKey: true })
    expect(onKeyDown).toHaveBeenCalledTimes(2)
  })

  it('allows every key on a navigation surface (tabs activate with Enter/Space)', () => {
    const onKeyDown = vi.fn()
    render(
      <ReadOnlyOverlay>
        <div role="tab" data-testid="the-tab" onKeyDown={onKeyDown}>Docs</div>
      </ReadOnlyOverlay>
    )
    fireEvent.keyDown(screen.getByTestId('the-tab'), { key: 'Enter' })
    expect(onKeyDown).toHaveBeenCalledTimes(1)
  })

  it('keeps the scoped pointer-events fallback class on the wrapper', () => {
    render(
      <ReadOnlyOverlay>
        <input data-testid="the-input" defaultValue="hello" />
      </ReadOnlyOverlay>
    )
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
