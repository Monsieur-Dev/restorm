/** The collapsible request sections whose expanded/collapsed state
 * `HTTPRequestTabView` lifts and persists. */
export type RequestPanelSection = 'headers' | 'pathParams' | 'params' | 'body'

const SECTIONS: readonly RequestPanelSection[] = ['headers', 'pathParams', 'params', 'body']

/**
 * The initial collapsed state for the request's KV sections.
 *
 * Normal precedence: a per-request persisted value wins; otherwise the
 * empty-section heuristic (an empty section starts collapsed).
 *
 * Conflict override: in the conflict-resolution view (`conflictFields`
 * defined) the sections mirror the diff EXACTLY — a section that differs
 * between the two sides starts expanded, every other section starts
 * COLLAPSED, ignoring both the persisted value and the heuristic. The
 * screen exists to show differences: an identical expanded section (e.g.
 * a non-empty headers list) is pure noise pushing the real diff below the
 * fold, and a differing section left collapsed would hide it.
 */
export function computeInitialPanelCollapsed(
  seed: Record<string, unknown>,
  emptyDefaults: Record<RequestPanelSection, boolean>,
  conflictFields: Record<string, boolean> | undefined
): Record<RequestPanelSection, boolean> {
  const result = {} as Record<RequestPanelSection, boolean>
  for (const name of SECTIONS) {
    if (conflictFields !== undefined) {
      result[name] = conflictFields[name] !== true
      continue
    }
    const seeded = seed[name]
    result[name] = typeof seeded === 'boolean' ? seeded : emptyDefaults[name]
  }
  return result
}
