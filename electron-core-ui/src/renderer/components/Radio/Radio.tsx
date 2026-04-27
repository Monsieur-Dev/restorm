import React, { useCallback } from 'react'
import './radio.css'
import type { RadioGroupProps } from './types'

const RadioGroup: React.FC<RadioGroupProps> = ({
  options,
  onSelect,
  className = '',
  id,
  'data-testid': dataTestId
}) => {
  // Fully controlled: the caller owns active state via the `isActive`
  // flag on each item, propagating user clicks through `onSelect`.
  // RadioGroup is a thin renderer over that contract — no internal
  // mirror. (Earlier the component held its own `activeIndex` state
  // initialized from `isActive`, but never re-synced when the prop
  // flipped externally — causing stale highlights on parent-driven
  // mode switches.)
  const propActive = options.items.findIndex((item) => item.isActive);
  const activeIndex = propActive >= 0 ? propActive : 0;

  const handleSelect = useCallback((index: number) => {
    if (options.items[index]?.disabled) return;
    onSelect?.(index);
  }, [options.items, onSelect]);

  // Note: Styles are handled by CSS variables in radio.css

  // Build CSS classes for container
  const containerClasses = [
    'custom-radio',
    className
  ].filter(Boolean).join(' ');

  return (
    <div
      id={id}
      className={containerClasses}
      role="radiogroup"
      {...(dataTestId && {
        'data-testid': dataTestId,
        'data-active-index': String(activeIndex),
        'data-items-count': String(options.items.length)
      })}
    >
      {options.items.map((item, index) => {
        const isActive = index === activeIndex;
        const isPreviousActive = index === activeIndex - 1;
        
        // Build CSS classes for button
        const buttonClasses = [
          'button',
          isActive ? 'active' : '',
          isPreviousActive ? 'previous-active' : ''
        ].filter(Boolean).join(' ');

        return (
          <button
            key={index}
            className={buttonClasses}
            {...(dataTestId && { 'data-testid': `${dataTestId}-item-${index}` })}
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
