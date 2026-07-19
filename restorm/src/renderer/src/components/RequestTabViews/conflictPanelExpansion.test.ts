import { describe, it, expect } from 'vitest'
import { computeInitialPanelCollapsed } from './conflictPanelExpansion'

const EMPTY_DEFAULTS = { headers: true, pathParams: true, params: true, body: false }

describe('computeInitialPanelCollapsed', () => {
  it('falls back to the empty-section heuristic when there is no seed and no conflict', () => {
    expect(computeInitialPanelCollapsed({}, EMPTY_DEFAULTS, undefined)).toEqual({
      headers: true,
      pathParams: true,
      params: true,
      body: false
    })
  })

  it('prefers a persisted seed value over the heuristic', () => {
    expect(computeInitialPanelCollapsed({ headers: false, params: true }, EMPTY_DEFAULTS, undefined)).toEqual({
      headers: false,
      pathParams: true,
      params: true,
      body: false
    })
  })

  it('force-expands a conflicting section, overriding both the seed and the heuristic', () => {
    const collapsed = computeInitialPanelCollapsed(
      { pathParams: true },
      EMPTY_DEFAULTS,
      { pathParams: true, headers: false, params: false, body: false }
    )
    expect(collapsed.pathParams).toBe(false)
  })

  it('only force-expands sections whose conflict flag is true', () => {
    const collapsed = computeInitialPanelCollapsed(
      {},
      EMPTY_DEFAULTS,
      { headers: true, pathParams: false, params: false, body: false }
    )
    // headers conflicts → forced open; the rest keep their heuristic default.
    expect(collapsed).toEqual({ headers: false, pathParams: true, params: true, body: false })
  })

  it('ignores unrelated fields present in the conflict map (url, method, notes, …)', () => {
    const collapsed = computeInitialPanelCollapsed(
      {},
      EMPTY_DEFAULTS,
      { url: true, method: true, notes: true, headers: false, pathParams: false, params: false, body: false }
    )
    expect(collapsed).toEqual({ headers: true, pathParams: true, params: true, body: false })
  })
})
