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

export interface ToggleProps {
  isChecked: boolean;
  onChange?: (checked: boolean, viaKeyboard: boolean) => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  styles?: IToggleStyles;
  icon?: string;
  actionClassName?: string;
  notFocusable?: boolean;
  children?: React.ReactNode;
}

export const defaultToggleStyles: IToggleStyles = {
  inputActiveOptionBorder: 'var(--vscode-inputOption-activeBorder)',
  inputActiveOptionForeground: 'var(--vscode-inputOption-activeForeground)',
  inputActiveOptionBackground: 'var(--vscode-inputOption-activeBackground)'
};
