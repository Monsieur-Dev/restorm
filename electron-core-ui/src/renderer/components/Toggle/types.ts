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
 * `indeterminate` for "some descendants checked, some not" patterns
 * (e.g. tri-state checkbox trees during selective import). Renders
 * with `aria-checked="mixed"` and a dash visual; a click on an
 * indeterminate Toggle transitions to `checked` — the user is
 * "completing" the partial state, which is the most useful default
 * for tree-style cascades.
 */
export type ToggleState = 'checked' | 'unchecked' | 'indeterminate';

export interface ToggleProps {
  /**
   * Explicit tri-state value. When provided, takes precedence over
   * `isChecked`. Use this for indeterminate-aware UIs (e.g. tri-state
   * checkbox trees). Omit it if you only need binary checked /
   * unchecked behaviour.
   */
  state?: ToggleState;
  /**
   * Binary alternative to `state`. Treated as
   * `state === 'checked'` when `state` is not provided. Kept on the
   * API surface for backwards compatibility — new code is
   * encouraged to use `state` directly.
   */
  isChecked?: boolean;
  /**
   * Called when the user toggles the value. `checked` is `true` after
   * clicking on an `unchecked` or `indeterminate` Toggle (the latter
   * "completes" the partial state by switching to fully-checked) and
   * `false` after clicking on a `checked` Toggle.
   */
  onChange?: (checked: boolean, viaKeyboard: boolean) => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** Optional test id applied to the Toggle root element. */
  'data-testid'?: string;
  styles?: IToggleStyles;
  /** Codicon name for the `checked` state. Defaults to `'check'`. */
  icon?: string;
  /**
   * Codicon name for the `indeterminate` state. Defaults to `'dash'`,
   * which matches the native `<input type="checkbox" indeterminate>`
   * look. Override only if a domain needs a different glyph.
   */
  indeterminateIcon?: string;
  actionClassName?: string;
  notFocusable?: boolean;
  children?: React.ReactNode;
}

export const defaultToggleStyles: IToggleStyles = {
  inputActiveOptionBorder: 'var(--inputOption-activeBorder)',
  inputActiveOptionForeground: 'var(--inputOption-activeForeground)',
  inputActiveOptionBackground: 'var(--inputOption-activeBackground)'
};
