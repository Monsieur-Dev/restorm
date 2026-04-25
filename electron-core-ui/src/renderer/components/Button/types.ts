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
   * When true, renders a compact 20x20 toolbar-style button.
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
