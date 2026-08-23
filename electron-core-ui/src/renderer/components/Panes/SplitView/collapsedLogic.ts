/**
 * Pure helpers behind the `SplitView` collapsed-state logic. Pulled
 * into a separate module so we can unit-test the controlled vs
 * uncontrolled branch without spinning up React.
 *
 * **Uncontrolled mode**: each `<Pane>` may pass `collapsed` /
 * `defaultCollapsed` purely as an *initial* value. After the user
 * toggles a header, the internal `collapsedState` becomes the source
 * of truth and the prop is ignored. State is lost on remount.
 *
 * **Controlled mode** (needed for the host's tab persistence):
 * every `<Pane>` provides an explicit `collapsed` boolean. The prop
 * wins on every render. Toggles fire `onCollapsedChange` and the
 * parent updates its store; the next render hydrates the SplitView
 * from the new prop. Survives remount because the truth lives outside
 * the SplitView.
 */

export interface MinimalPane {
  collapsed?: boolean | undefined
  defaultCollapsed?: boolean | undefined
}

export interface SplitViewInternalState {
  forCount: number
  values: boolean[]
}

/**
 * Detect controlled mode: every pane must provide an explicit
 * `collapsed` boolean. A single missing `collapsed` falls back to
 * uncontrolled — partial control would be ambiguous (whose value wins
 * for the unspecified pane after a re-mount?).
 */
export function isFullyControlled(panes: readonly MinimalPane[]): boolean {
  if (panes.length === 0) return false
  for (const pane of panes) {
    if (typeof pane.collapsed !== 'boolean') return false
  }
  return true
}

/**
 * Compute the rendered `collapsed` array given the current panes and
 * the SplitView's internal state. The same logic the React useMemo
 * inside SplitView uses — extracted so callers can verify the
 * controlled vs uncontrolled branch without rendering.
 */
export function computeCollapsedArray(
  panes: readonly MinimalPane[],
  internalState: SplitViewInternalState
): boolean[] {
  if (isFullyControlled(panes)) {
    // isFullyControlled has narrowed every pane.collapsed to a
    // boolean, but the compiler can't see that through the early
    // return. The `?? false` fallback never triggers — it just gives
    // TypeScript the boolean it wants without needing an assertion.
    return panes.map((p) => p.collapsed ?? false)
  }
  if (
    internalState.forCount === panes.length &&
    internalState.values.length === panes.length
  ) {
    return internalState.values
  }
  return panes.map((pane, index) => {
    const stored = internalState.values[index]
    if (typeof stored === 'boolean' && internalState.forCount >= index + 1) {
      return stored
    }
    if (typeof pane.collapsed === 'boolean') return pane.collapsed
    return Boolean(pane.defaultCollapsed)
  })
}
