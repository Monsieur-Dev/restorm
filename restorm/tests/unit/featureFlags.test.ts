/**
 * Unit tests for the restorm feature-flag accessors used by the main
 * process at IPC entry points.
 */

import { describe, it, expect, vi } from 'vitest'
import { isTabDetachEnabled, TAB_DETACH_FEATURE } from '../../src/main/featureFlags'

describe('isTabDetachEnabled', () => {
  it('returns true when the feature service reports the flag enabled', () => {
    const isEnabled = vi.fn().mockReturnValue(true)
    expect(isTabDetachEnabled({ isEnabled })).toBe(true)
    expect(isEnabled).toHaveBeenCalledExactlyOnceWith(TAB_DETACH_FEATURE)
  })

  it('returns false when the feature service reports the flag disabled', () => {
    const isEnabled = vi.fn().mockReturnValue(false)
    expect(isTabDetachEnabled({ isEnabled })).toBe(false)
    expect(isEnabled).toHaveBeenCalledExactlyOnceWith(TAB_DETACH_FEATURE)
  })

  it('uses the canonical flag name', () => {
    // The flag name is shared between the renderer (`useFeature`),
    // the main IPC gate, and the YAML config — guard against a
    // typo introducing two parallel "flags" silently.
    expect(TAB_DETACH_FEATURE).toBe('workbench.tabDetach')
  })
})
