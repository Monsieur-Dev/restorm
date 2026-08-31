import { describe, it, expect } from 'vitest'
import { isSaveCancellation, SAVE_CANCELLED } from './saveResult'

describe('isSaveCancellation', () => {
  it('is true only for the cancel sentinel', () => {
    expect(isSaveCancellation({ success: false, error: SAVE_CANCELLED })).toBe(true)
  })

  it('is false for a genuine save failure', () => {
    // The regression: a real failure must still be logged as an error, so it
    // must NOT be classified as a cancellation.
    expect(isSaveCancellation({ success: false, error: 'EACCES: permission denied' })).toBe(false)
    expect(isSaveCancellation({ success: false, error: 'Unknown error' })).toBe(false)
  })

  it('is false for a successful save and for missing results', () => {
    expect(isSaveCancellation({ success: true, path: '/tmp/x.restorm' } as { success: boolean })).toBe(false)
    expect(isSaveCancellation(undefined)).toBe(false)
    expect(isSaveCancellation(null)).toBe(false)
    expect(isSaveCancellation({})).toBe(false)
  })
})
