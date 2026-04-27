import type { ToggleState } from './types'

/**
 * Resolve the effective tri-state value from the (state, isChecked)
 * prop pair. `state` always wins when provided; otherwise the legacy
 * binary `isChecked` flag is mapped to `'checked'` / `'unchecked'`.
 * Defaults to `'unchecked'` so a Toggle with no value props at all
 * renders empty rather than throwing.
 */
export function resolveToggleState(
  state: ToggleState | undefined,
  isChecked: boolean | undefined
): ToggleState {
  if (state !== undefined) return state
  return isChecked === true ? 'checked' : 'unchecked'
}

/**
 * The next state on a click / keyboard activation. `checked` toggles
 * back to `unchecked`, `unchecked` toggles to `checked`, and
 * `indeterminate` "completes" to `checked` — the user is
 * acknowledging the partial state by promoting it to a clean value,
 * which is the most useful default for tri-state checkbox trees.
 */
export function nextToggleStateOnClick(state: ToggleState): ToggleState {
  return state === 'checked' ? 'unchecked' : 'checked'
}

/**
 * The codicon name to render for a given state. `'dash'` matches the
 * native `<input type="checkbox" indeterminate>` look that users
 * already recognise; `'check'` is the conventional checked glyph;
 * unchecked renders no icon at all.
 */
export function iconForToggleState(
  state: ToggleState,
  checkedIcon: string | undefined,
  indeterminateIcon: string
): string | null {
  if (state === 'unchecked') return null
  if (state === 'indeterminate') return indeterminateIcon
  return checkedIcon ?? 'check'
}

/**
 * The `aria-checked` value for a given state — `'mixed'` is the
 * ARIA-spec value assistive tech reads as "indeterminate".
 */
export function ariaCheckedForToggleState(state: ToggleState): boolean | 'mixed' {
  if (state === 'indeterminate') return 'mixed'
  return state === 'checked'
}
