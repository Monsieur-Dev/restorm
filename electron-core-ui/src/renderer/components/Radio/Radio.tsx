import React, { useState, useCallback } from 'react'
import './radio.css'
import type { RadioGroupProps } from './types'

const RadioGroup: React.FC<RadioGroupProps> = ({
  options,
  onSelect,
  className = '',
  id
}) => {
  const [activeIndex, setActiveIndex] = useState(() => {
    const idx = options.items.findIndex(item => item.isActive);
    return idx === -1 ? 0 : idx;
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
            onClick={() => { handleSelect(index); }}
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

export { RadioGroup };
export default RadioGroup;
