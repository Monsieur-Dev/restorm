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
  activeForeground: 'var(--ecui-radio-activeForeground)',
  activeBackground: 'var(--ecui-radio-activeBackground)',
  activeBorder: 'var(--ecui-radio-activeBorder)',
  inactiveForeground: 'var(--ecui-radio-inactiveForeground)',
  inactiveBackground: 'var(--ecui-radio-inactiveBackground)',
  inactiveHoverBackground: 'var(--ecui-radio-inactiveHoverBackground)',
  inactiveBorder: 'var(--ecui-radio-inactiveBorder)'
};


