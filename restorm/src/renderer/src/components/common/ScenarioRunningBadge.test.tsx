// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'

// The real ECUI barrel drags Monaco into jsdom; the badge only needs a marker
// element standing in for the beam overlay.
vi.mock('electron-core-ui/renderer', () => ({
  BorderBeam: () => <div data-testid="beam-overlay" />
}))

const { isRunningMock } = vi.hoisted(() => ({ isRunningMock: vi.fn(() => false) }))
vi.mock('../../services/scenarioRunningStore', () => ({
  useIsScenarioRunning: () => isRunningMock()
}))

import { ScenarioRunningBadge } from './ScenarioRunningBadge'

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

afterEach(() => { cleanup(); isRunningMock.mockReset() })

describe('ScenarioRunningBadge', () => {
  it('drops the beam at once under reduced motion, where no lap ever completes', () => {
    // The trail's travel animation is disabled by the reduced-motion media
    // query, so no `animationiteration` is ever emitted — waiting for one
    // would leave the ring on the badge for good.
    setReducedMotion(true)
    isRunningMock.mockReturnValue(true)
    const { rerender, queryByTestId } = render(<ScenarioRunningBadge scenarioId="s1" />)
    expect(queryByTestId('beam-overlay')).not.toBeNull()

    isRunningMock.mockReturnValue(false)
    rerender(<ScenarioRunningBadge scenarioId="s1" />)
    expect(queryByTestId('beam-overlay')).toBeNull()
  })

  it('keeps the beam until the current lap ends when motion is allowed', () => {
    setReducedMotion(false)
    isRunningMock.mockReturnValue(true)
    const { rerender, queryByTestId } = render(<ScenarioRunningBadge scenarioId="s2" />)
    expect(queryByTestId('beam-overlay')).not.toBeNull()

    isRunningMock.mockReturnValue(false)
    rerender(<ScenarioRunningBadge scenarioId="s2" />)
    // Still orbiting: the graceful stop waits for the lap boundary.
    expect(queryByTestId('beam-overlay')).not.toBeNull()
  })

  it('restarts cleanly after a reduced-motion stop', () => {
    setReducedMotion(true)
    isRunningMock.mockReturnValue(true)
    const { rerender, queryByTestId } = render(<ScenarioRunningBadge scenarioId="s3" />)

    isRunningMock.mockReturnValue(false)
    rerender(<ScenarioRunningBadge scenarioId="s3" />)
    expect(queryByTestId('beam-overlay')).toBeNull()

    isRunningMock.mockReturnValue(true)
    rerender(<ScenarioRunningBadge scenarioId="s3" />)
    expect(queryByTestId('beam-overlay')).not.toBeNull()
  })
})
