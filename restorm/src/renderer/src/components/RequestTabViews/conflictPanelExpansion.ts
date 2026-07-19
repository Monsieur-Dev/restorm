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
 * Conflict override: in the conflict-resolution view a section that DIFFERS
 * between the two sides (`conflictFields[name] === true`) starts EXPANDED,
 * overriding both the persisted value and the heuristic. The read-only
 * ours/server panels are `inert`, so the user can't click a collapsed section
 * open — a differing section left collapsed would hide exactly the
 * line-by-line differences the conflict screen exists to show.
 */
export function computeInitialPanelCollapsed(
  seed: Record<string, unknown>,
  emptyDefaults: Record<RequestPanelSection, boolean>,
  conflictFields: Record<string, boolean> | undefined
): Record<RequestPanelSection, boolean> {
  const result = {} as Record<RequestPanelSection, boolean>
  for (const name of SECTIONS) {
    if (conflictFields?.[name] === true) {
      result[name] = false
      continue
    }
    const seeded = seed[name]
    result[name] = typeof seeded === 'boolean' ? seeded : emptyDefaults[name]
  }
  return result
}
