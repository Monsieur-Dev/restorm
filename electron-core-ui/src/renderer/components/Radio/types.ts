export interface IRadioStyles {
  readonly activeForeground?: string;
  readonly activeBackground?: string;
  readonly activeBorder?: string;
  readonly inactiveForeground?: string;
  readonly inactiveBackground?: string;
  readonly inactiveHoverBackground?: string;
  readonly inactiveBorder?: string;
}

export interface IRadioOptionItem {
  readonly text: string;
  readonly tooltip?: string;
  readonly isActive?: boolean;
  readonly disabled?: boolean;
}

export interface IRadioOptions {
  readonly items: readonly IRadioOptionItem[];
  readonly styles?: IRadioStyles;
}

export interface RadioGroupProps {
  options: IRadioOptions;
  onSelect?: (index: number) => void;
  className?: string;
  id?: string;
}

// Default styles based on VSCode inputColors.ts
export const defaultRadioStyles: IRadioStyles = {
  activeForeground: 'var(--vscode-radio-activeForeground)',
  activeBackground: 'var(--vscode-radio-activeBackground)',
  activeBorder: 'var(--vscode-radio-activeBorder)',
  inactiveForeground: 'var(--vscode-radio-inactiveForeground)',
  inactiveBackground: 'var(--vscode-radio-inactiveBackground)',
  inactiveHoverBackground: 'var(--vscode-radio-inactiveHoverBackground)',
  inactiveBorder: 'var(--vscode-radio-inactiveBorder)'
};
