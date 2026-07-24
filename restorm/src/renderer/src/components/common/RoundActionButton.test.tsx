// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'

// The ECUI barrel transitively loads Monaco, which probes an editing command
// jsdom does not implement — at import time, so it has to be stubbed first.
// The real barrel is used on purpose: this component is a composition around
// the library's round button, and a mocked Button would prove nothing.
vi.hoisted(() => {
  Object.defineProperty(globalThis.document, 'queryCommandSupported', { value: () => false, configurable: true })
})

import { RoundActionButton } from './RoundActionButton'

afterEach(() => { cleanup() })

describe('RoundActionButton', () => {
  it('renders the library round shape, icon-only, with an accessible name', () => {
    const { getByTestId } = render(
      <RoundActionButton icon="send" ariaLabel="Send" data-testid="round-send" />
    )
    const disc = getByTestId('round-send')
    expect(disc.className).toContain('appearance-round')
    expect(disc.querySelector('.codicon-send')).not.toBeNull()
    expect(disc.getAttribute('aria-label')).toBe('Send')
    expect(disc.textContent).toBe('')
    // The hover label is deliberately absent on these discs, so the
    // aria-label is the only name they expose.
    expect(disc.getAttribute('title')).toBeNull()
  })

  it('carries no hover tooltip', () => {
    const { container } = render(
      <RoundActionButton icon="send" ariaLabel="Send" data-testid="round-send" />
    )
    expect(container.querySelector('.header-hover-tooltip')).toBeNull()
  })

  it('hands a caller colour to the shape rather than painting it here', () => {
    // The disc's colour is data, so it travels as the button's background and
    // the shape derives its own glyph contrast from it.
    const { getByTestId } = render(
      <RoundActionButton icon="send" ariaLabel="Send" color="#0b3d91" data-testid="round-send" />
    )
    const disc = getByTestId('round-send')
    expect(disc.style.background).toBe('rgb(11, 61, 145)')
    expect(disc.className).not.toContain('restorm-round-action-tone-')
  })

  it('falls back to a tone class when the caller has no colour', () => {
    const { getByTestId } = render(
      <RoundActionButton icon="close" ariaLabel="Cancel" tone="stop" data-testid="round-cancel" />
    )
    const disc = getByTestId('round-cancel')
    expect(disc.className).toContain('restorm-round-action-tone-stop')
    expect(disc.style.background).toBe('')
  })

  it('passes the environment icon to the shape as a corner badge', () => {
    const { container, rerender } = render(
      <RoundActionButton icon="send" ariaLabel="Send" data-testid="round-send" />
    )
    expect(container.querySelector('.ecui-round-corner-badge')).toBeNull()

    rerender(
      <RoundActionButton
        icon="send"
        ariaLabel="Send"
        envIcon={{ type: 'codicon', value: 'cloud' }}
        data-testid="round-send"
      />
    )
    const badge = container.querySelector('.ecui-round-corner-badge')
    expect(badge).not.toBeNull()
    expect(badge?.querySelector('.codicon-cloud')).not.toBeNull()

    // An environment that defines no icon draws nothing.
    rerender(
      <RoundActionButton
        icon="send"
        ariaLabel="Send"
        envIcon={{ type: 'none', value: '' }}
        data-testid="round-send"
      />
    )
    expect(container.querySelector('.ecui-round-corner-badge')).toBeNull()
  })

  it('selects the shape size, and scales the badge with it', () => {
    const { container, getByTestId } = render(
      <>
        <RoundActionButton icon="send" ariaLabel="Send" envIcon={{ type: 'codicon', value: 'cloud' }} data-testid="round-primary" />
        <RoundActionButton icon="plug" ariaLabel="Connect" size="secondary" envIcon={{ type: 'codicon', value: 'cloud' }} data-testid="round-secondary" />
      </>
    )
    // `small` is how the shape's smaller diameter is selected.
    expect(getByTestId('round-primary').className).not.toContain('small-button')
    expect(getByTestId('round-secondary').className).toContain('small-button')

    const glyphs = container.querySelectorAll<HTMLElement>('.ecui-round-corner-badge .codicon-cloud')
    expect(glyphs).toHaveLength(2)
    expect(glyphs[0]?.style.fontSize).toBe('15px')
    expect(glyphs[1]?.style.fontSize).toBe('12px')
  })

  it('fires onClick, and stays inert once disabled', () => {
    const onClick = vi.fn()
    const { getByTestId, rerender } = render(
      <RoundActionButton icon="send" ariaLabel="Send" onClick={onClick} data-testid="round-send" />
    )
    fireEvent.click(getByTestId('round-send'))
    expect(onClick).toHaveBeenCalledTimes(1)

    rerender(
      <RoundActionButton icon="send" ariaLabel="Send" onClick={onClick} disabled data-testid="round-send" />
    )
    const disc = getByTestId('round-send')
    expect(disc.className).toContain('disabled')
    fireEvent.click(disc)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('keeps the beam host and the picker OUTSIDE anything a caller swaps', () => {
    // Both must survive a state flip untouched, or a running beam is cut
    // mid-lap when send becomes cancel.
    const { container } = render(
      <RoundActionButton icon="send" ariaLabel="Send" beamActive envSwitch data-testid="round-send" />
    )
    const beam = container.querySelector('.scn-running-badge.restorm-round-action-beam')
    expect(beam).not.toBeNull()
    const picker = beam?.querySelector('[data-testid="send-button-env-switcher-anchor"]')
    expect(picker).not.toBeNull()
    expect(picker?.querySelector('[data-testid="round-send"]')).not.toBeNull()
  })

  it('keeps the picker mounted but inert when the state has no env switch', () => {
    const { container } = render(
      <RoundActionButton icon="close" ariaLabel="Cancel" tone="stop" data-testid="round-cancel" />
    )
    const picker = container.querySelector('[data-testid="send-button-env-switcher-anchor"]')
    expect(picker).not.toBeNull()
    expect(picker?.className).toContain('restorm-send-button-env-switcher-inert')
  })
})
