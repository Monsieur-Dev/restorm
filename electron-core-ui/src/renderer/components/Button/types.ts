import type { Icon } from '../../../types/icon';

export interface IButtonOptions extends Partial<IButtonStyles> {
  readonly title?: boolean | string;
  readonly ariaLabel?: string;
  readonly supportIcons?: boolean;
  readonly supportShortLabel?: boolean;
  readonly secondary?: boolean;
  readonly disabled?: boolean;
}

export interface IButtonStyles {
  readonly buttonBackground: string | undefined;
  readonly buttonHoverBackground: string | undefined;
  readonly buttonForeground: string | undefined;
  readonly buttonSeparator: string | undefined;
  readonly buttonSecondaryBackground: string | undefined;
  readonly buttonSecondaryHoverBackground: string | undefined;
  readonly buttonSecondaryForeground: string | undefined;
  readonly buttonBorder: string | undefined;
}

export interface IButtonWithDropdownOptions extends IButtonOptions {
  readonly actions: { label: string; onClick: () => void }[];
  readonly addPrimaryActionToDropdown?: boolean;
}

/**
 * Visual appearance of a Button. The behavior (click, keyboard
 * activation, `onClick` contract) is identical across appearances —
 * only the rendered surface + animation change.
 *
 * - `'default'`: the standard codicon-friendly button (theme tokens,
 *   `secondary` / `emphasis` modifiers, codicon support, etc.).
 *   Existing call sites that don't pass `appearance` keep this look.
 * - `'rainbow'`: hero CTA with an animated rainbow gradient border
 *   pinned to the bottom edge and a soft glow underneath, revealed on
 *   hover / focus-visible. Solid dark surface (`#121213`) regardless
 *   of theme. The codicon / `secondary` / `emphasis` modifiers have
 *   no effect on this appearance.
 */
export type ButtonAppearance = 'default' | 'rainbow';

/**
 * Size variant.
 *
 * For the `'default'` appearance the `'sm'` variant renders as a
 * compact 20×20 toolbar/icon button (transparent background, no
 * border, codicon-friendly) — the historical `small` boolean
 * behavior. `'lg'` and `'xl'` enlarge the standard text-button
 * surface (16px / 14×28 and 20px / 20×40, respectively).
 *
 * For the `'rainbow'` appearance the size only affects padding /
 * font-size / radius — the toolbar reset does not apply.
 *
 * - `'sm'` — small (toolbar icon for default appearance).
 * - `'default'` — standard call-to-action.
 * - `'lg'` — section CTA (16px / 14×28).
 * - `'xl'` — hero CTA on welcome / landing surfaces (20px / 20×40).
 */
export type ButtonSize = 'sm' | 'default' | 'lg' | 'xl';

export interface ButtonProps {
  options?: IButtonOptions;
  /**
   * Leading icon. Pass a string for the codicon shorthand
   * (`icon="save"`) or a full `Icon` object for any library
   * supported by `IconView` (codicon, emoji, iconoir, phosphor,
   * material, simpleicons, feather, fontawesome).
   */
  icon?: string | Icon | undefined;
  disabled?: boolean;
  secondary?: boolean;
  /**
   * Visual appearance. Defaults to `'default'`.
   */
  appearance?: ButtonAppearance;
  /**
   * Size variant. Defaults to `'default'`.
   */
  size?: ButtonSize;
  /**
   * Shorthand for `size="sm"` — kept as a convenience boolean for the
   * most common case (compact toolbar / icon buttons). When both are
   * set, `size` wins.
   */
  small?: boolean;
  line?: boolean;
  /**
   * Emphasis level (0 = default, 1+ = emphasized).
   * When > 0, uses CSS variables --button-background-emphasis-N, --button-border-emphasis-N,
   * --button-hoverBackground-emphasis-N for styling.
   */
  emphasis?: number;
  /**
   * When true, the button container expands to its parent's full
   * width and the inner anchor's `max-width: 200px` cap is removed.
   * Use for list rows / popover entries that should stretch.
   */
  fullWidth?: boolean;
  /**
   * Inline background applied to the button surface. Takes priority
   * over the variant's CSS background. Use for swatches / tinted
   * list rows where the row's color is part of the data (env color,
   * tag color, status pill, …) rather than a theme variant.
   */
  backgroundColor?: string;
  /**
   * Horizontal alignment of the button label.
   * Defaults to `'center'` (the historical CTA-style behavior).
   * `'left'` is the natural pick for list rows / popover entries
   * where the label should hug the leading edge.
   */
  align?: 'left' | 'center' | 'right';
  onClick?: ((event: React.MouseEvent<HTMLAnchorElement>) => void) | undefined;
  onMouseEnter?: ((event: React.MouseEvent<HTMLAnchorElement>) => void) | undefined;
  onMouseLeave?: ((event: React.MouseEvent<HTMLAnchorElement>) => void) | undefined;
  className?: string;
  /** Inline style overrides (e.g. for custom backgroundColor on color swatches) */
  style?: React.CSSProperties;
  id?: string;
  /**
   * ARIA role of the rendered surface. Defaults to `'button'`. Set
   * `'checkbox'` (paired with `aria-checked`) to reuse the Button surface
   * as a toggle — e.g. a small toolbar toggle button — without re-styling
   * a bare anchor.
   */
  role?: React.AriaRole;
  /**
   * Checked state for a toggle/checkbox-role Button. Rendered as the
   * `aria-checked` attribute (`true` / `false` / `'mixed'`).
   */
  'aria-checked'?: boolean | 'false' | 'true' | 'mixed';
  /** Tab order override. Defaults to `0` (focusable), `-1` when disabled. */
  tabIndex?: number;
  'data-testid'?: string;
  children?: React.ReactNode;
}

export interface ButtonWithDescriptionProps {
  options?: IButtonOptions;
  description: string;
  icon?: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  className?: string;
  id?: string;
  'data-testid'?: string;
  children?: React.ReactNode;
}

export interface ButtonWithDropdownProps {
  options: IButtonWithDropdownOptions;
  label: string;
  icon?: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  className?: string;
  id?: string;
  'data-testid'?: string;
}

export interface ButtonWithIconProps {
  options: IButtonOptions;
  icon: string;
  label: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  className?: string;
  id?: string;
  'data-testid'?: string;
}

// Default styles for buttons
export const defaultButtonStyles: IButtonStyles = {
  buttonBackground: '#0E639C',
  buttonHoverBackground: '#006BB3',
  buttonSeparator: '#FFFFFF',
  buttonForeground: '#FFFFFF',
  buttonBorder: undefined,
  buttonSecondaryBackground: undefined,
  buttonSecondaryForeground: undefined,
  buttonSecondaryHoverBackground: undefined
};
