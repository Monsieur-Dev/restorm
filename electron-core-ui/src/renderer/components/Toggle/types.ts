export interface IToggleStyles {
  readonly inputActiveOptionBorder: string | undefined;
  readonly inputActiveOptionForeground: string | undefined;
  readonly inputActiveOptionBackground: string | undefined;
}

export interface ICheckboxStyles {
  readonly checkboxBackground: string | undefined;
  readonly checkboxBorder: string | undefined;
  readonly checkboxForeground: string | undefined;
  readonly checkboxDisabledBackground: string | undefined;
  readonly checkboxDisabledForeground: string | undefined;
  readonly size?: number;
}

/**
 * Tri-state value for a Toggle: a binary checked / unchecked plus
 * `'indeterminate'` for "some descendants checked, some not"
 * patterns (e.g. tri-state checkbox trees during selective import).
 * `'indeterminate'` renders with `aria-checked="mixed"` and a dash
 * visual; a click on an indeterminate Toggle transitions to checked
 * — the user is "completing" the partial state, which is the most
 * useful default for tree-style cascades.
 */
export type ToggleState = 'checked' | 'unchecked' | 'indeterminate';

/**
 * Polymorphic value prop accepted by `Toggle`. A boolean covers the
 * binary case (`true` ↔ `false`); the literal `'indeterminate'`
 * carries the tri-state value. Most callers pass a boolean from
 * their own state and only reach for `'indeterminate'` when modelling
 * a tri-state tree.
 */
export type ToggleValue = boolean | 'indeterminate';

/**
 * Visual appearance of a Toggle. The behavior (binary on / off,
 * keyboard activation, `onChange` contract) is identical across
 * appearances — only the rendered glyph + animation change.
 *
 * - `'switch'` (default): the existing checkbox-like square with a
 *   centered codicon. Supports indeterminate / icons / styles tokens.
 * - `'star'`: a Lottie-driven favorite star that bursts on off→on
 *   and reverses on on→off (Twitter-style). The `icon`,
 *   `indeterminateIcon` and `styles` props have no effect — the
 *   `'indeterminate'` value is treated as `'unchecked'`.
 * - `'button'`: a small toolbar-style button that renders **pressed**
 *   (active/depressed) when checked and **normal** when unchecked — for
 *   a row of filter toggles. The `children` are the button content (an
 *   icon or colored dot); `icon` / `indeterminateIcon` / `styles` have
 *   no effect and `'indeterminate'` reads as unchecked.
 */
export type ToggleAppearance = 'switch' | 'star' | 'button';

export interface ToggleProps {
  /**
   * Current value. Pass a boolean for the standard checked /
   * unchecked case, or the literal `'indeterminate'` when the
   * Toggle should render the tri-state dash visual.
   */
  checked: ToggleValue;
  /**
   * Called when the user toggles the value. `checked` is `true` after
   * clicking on an unchecked / indeterminate Toggle (the latter
   * "completes" the partial state by switching to fully-checked) and
   * `false` after clicking on a checked Toggle.
   */
  onChange?: (checked: boolean, viaKeyboard: boolean) => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** Optional test id applied to the Toggle root element. */
  'data-testid'?: string;
  /**
   * Optional accessible name for the action element. When omitted,
   * Toggle falls back to the string children if any (or a generic
   * `'Toggle'` label). Pass this when the Toggle has no visible label
   * but still needs a meaningful screen-reader announcement — e.g.
   * a star toggle in a list where the row already shows the name.
   */
  'aria-label'?: string;
  styles?: IToggleStyles;
  /** Codicon name for the checked state. Defaults to `'check'`. */
  icon?: string;
  /**
   * Codicon name for the indeterminate state. Defaults to `'dash'`,
   * which matches the native `<input type="checkbox" indeterminate>`
   * look. Override only if a domain needs a different glyph.
   */
  indeterminateIcon?: string;
  actionClassName?: string;
  notFocusable?: boolean;
  children?: React.ReactNode;
  /**
   * Optional visual appearance override. Defaults to `'switch'`
   * (the standard codicon-driven checkbox look). Pass `'star'` to
   * render a Lottie-driven favorite star that animates on toggle.
   * See `ToggleAppearance` for the contract per appearance.
   */
  appearance?: ToggleAppearance;
}

export const defaultToggleStyles: IToggleStyles = {
  inputActiveOptionBorder: 'var(--inputOption-activeBorder)',
  inputActiveOptionForeground: 'var(--inputOption-activeForeground)',
  inputActiveOptionBackground: 'var(--inputOption-activeBackground)'
};
