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
  icon?: string | undefined;
  disabled?: boolean;
  secondary?: boolean;
  onClick?: ((event: React.MouseEvent<HTMLAnchorElement>) => void) | undefined;
  onMouseEnter?: ((event: React.MouseEvent<HTMLAnchorElement>) => void) | undefined;
  onMouseLeave?: ((event: React.MouseEvent<HTMLAnchorElement>) => void) | undefined;
  className?: string;
  id?: string;
  children?: React.ReactNode;
}

export interface ButtonWithDescriptionProps {
  options?: IButtonOptions;
  description: string;
  icon?: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  className?: string;
  id?: string;
  children?: React.ReactNode;
}

export interface ButtonWithDropdownProps {
  options: IButtonWithDropdownOptions;
  label: string;
  icon?: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  className?: string;
  id?: string;
}

export interface ButtonWithIconProps {
  options: IButtonOptions;
  icon: string;
  label: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  className?: string;
  id?: string;
}

// Default styles based on VSCode's unthemedButtonStyles
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
