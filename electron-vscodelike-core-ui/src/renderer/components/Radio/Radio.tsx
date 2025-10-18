/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useState, useCallback } from 'react'
import './radio.css'

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
  readonly items: ReadonlyArray<IRadioOptionItem>;
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

const RadioGroup: React.FC<RadioGroupProps> = ({
  options,
  onSelect,
  className = '',
  id
}) => {
  const [activeIndex, setActiveIndex] = useState(() => {
    return options.items.findIndex(item => item.isActive) ?? 0;
  });

  const handleSelect = useCallback((index: number) => {
    if (options.items[index]?.disabled) return;
    
    setActiveIndex(index);
    onSelect?.(index);
  }, [options.items, onSelect]);

  // Note: Styles are handled by CSS variables in radio.css

  // Build CSS classes for container
  const containerClasses = [
    'monaco-custom-radio',
    className
  ].filter(Boolean).join(' ');

  return (
    <div
      id={id}
      className={containerClasses}
      role="radiogroup"
    >
      {options.items.map((item, index) => {
        const isActive = index === activeIndex;
        const isPreviousActive = index === activeIndex - 1;
        
        // Build CSS classes for button
        const buttonClasses = [
          'monaco-button',
          isActive ? 'active' : '',
          isPreviousActive ? 'previous-active' : ''
        ].filter(Boolean).join(' ');

        return (
          <button
            key={index}
            className={buttonClasses}
            onClick={() => handleSelect(index)}
            disabled={item.disabled}
            title={item.tooltip}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={item.text}
          >
            {item.text}
          </button>
        );
      })}
    </div>
  );
};

export default RadioGroup;
