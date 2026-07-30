import { describe, it, expect } from 'vitest'
import { canHostReview, pickReviewWindow, type ReviewWindowState } from './crashReviewWindow'

function state(over: Partial<ReviewWindowState> = {}): ReviewWindowState {
  return { destroyed: false, visible: true, crashed: false, ...over }
}

describe('canHostReview', () => {
  it('accepts a live, visible window', () => {
    expect(canHostReview(state())).toBe(true)
  })

  it('rejects a window whose renderer process has died', () => {
    // THE case. Such a window is neither destroyed nor hidden — only its
    // renderer is gone — so every other test says it is fine to ask.
    expect(canHostReview(state({ crashed: true }))).toBe(false)
  })

  it('rejects destroyed and hidden windows', () => {
    expect(canHostReview(state({ destroyed: true }))).toBe(false)
    expect(canHostReview(state({ visible: false }))).toBe(false)
  })
})

describe('pickReviewWindow', () => {
  const read = (w: { id: string; state: ReviewWindowState }): ReviewWindowState => w.state

  it('prefers the focused window', () => {
    const a = { id: 'a', state: state() }
    const focused = { id: 'focused', state: state() }
    expect(pickReviewWindow([a, focused], focused, read)?.id).toBe('focused')
  })

  it('skips a focused window whose renderer has died', () => {
    // Focus is preferred, never privileged: the dead window is usually the
    // focused one, because it is the one the user was working in.
    const alive = { id: 'alive', state: state() }
    const dead = { id: 'dead', state: state({ crashed: true }) }
    expect(pickReviewWindow([dead, alive], dead, read)?.id).toBe('alive')
  })

  it('returns null when every window is dead', () => {
    // The whole point: no window able to ask ⇒ the report is DROPPED rather
    // than sent unreviewed, and the single review slot is never wedged by a
    // question nobody can answer.
    const dead = { id: 'dead', state: state({ crashed: true }) }
    expect(pickReviewWindow([dead], dead, read)).toBeNull()
  })

  it('returns null with no windows at all', () => {
    expect(pickReviewWindow([], null, read)).toBeNull()
  })
})
