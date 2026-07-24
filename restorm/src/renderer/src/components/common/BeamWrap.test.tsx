// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'

// The real 'electron-core-ui/renderer' barrel drags Monaco into jsdom; the
// wrapper only needs a marker element standing in for the beam overlay.
vi.mock('electron-core-ui/renderer', () => ({
  BorderBeam: () => <div data-testid="beam-overlay" />
}))

import { BeamWrap } from './BeamWrap'

/** Pin `prefers-reduced-motion` for the duration of a test. */
function setReducedMotion(reduce: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false)
  })) as unknown as typeof window.matchMedia
}

afterEach(() => { cleanup() })

describe('BeamWrap', () => {
  it('keeps the beam until the current lap ends when motion is allowed', () => {
    // The graceful stop must survive: with a live travel animation the
    // overlay stays put after `active` drops and only leaves on the next
    // lap boundary (which only a real animation can emit).
    setReducedMotion(false)
    const { rerender, queryByTestId } = render(<BeamWrap active={true} />)
    expect(queryByTestId('beam-overlay')).not.toBeNull()

    rerender(<BeamWrap active={false} />)
    expect(queryByTestId('beam-overlay')).not.toBeNull()
  })

  it('drops the beam at once under reduced motion, where no lap ever completes', () => {
    // The trail's travel animation is disabled by the reduced-motion media
    // query, so no `animationiteration` is ever emitted — waiting for one
    // would leave the overlay on the badge for good.
    setReducedMotion(true)
    const { rerender, queryByTestId } = render(<BeamWrap active={true} />)
    expect(queryByTestId('beam-overlay')).not.toBeNull()

    rerender(<BeamWrap active={false} />)
    expect(queryByTestId('beam-overlay')).toBeNull()
  })

  it('restarts cleanly after a reduced-motion stop', () => {
    setReducedMotion(true)
    const { rerender, queryByTestId } = render(<BeamWrap active={true} />)
    rerender(<BeamWrap active={false} />)
    expect(queryByTestId('beam-overlay')).toBeNull()

    rerender(<BeamWrap active={true} />)
    expect(queryByTestId('beam-overlay')).not.toBeNull()
  })
})
