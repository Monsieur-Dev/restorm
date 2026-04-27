import type { ToggleState, ToggleValue } from './types'

/**
 * Resolve the polymorphic `checked` prop into the internal tri-state
 * representation. Booleans map to `'checked'` / `'unchecked'`; the
 * literal `'indeterminate'` is passed through. Single source of truth
 * for the "what state is this Toggle in" decision so the visual,
 * the click handler and the ARIA attribute stay aligned.
 */
export function toToggleState(value: ToggleValue): ToggleState {
  if (value === 'indeterminate') return 'indeterminate'
  return value ? 'checked' : 'unchecked'
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
