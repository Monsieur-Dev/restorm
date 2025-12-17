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
  activeForeground: 'var(--radio-activeForeground)',
  activeBackground: 'var(--radio-activeBackground)',
  activeBorder: 'var(--radio-activeBorder)',
  inactiveForeground: 'var(--radio-inactiveForeground)',
  inactiveBackground: 'var(--radio-inactiveBackground)',
  inactiveHoverBackground: 'var(--radio-inactiveHoverBackground)',
  inactiveBorder: 'var(--radio-inactiveBorder)'
};
