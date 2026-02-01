import React, { useState, useCallback } from 'react'
import './toggle.css'
import type { ToggleProps } from './types'
import { defaultToggleStyles } from './types'

const Toggle: React.FC<ToggleProps> = ({
  isChecked,
  onChange,
  onKeyDown,
  disabled = false,
  className = '',
  id,
  'data-testid': dataTestId,
  styles,
  icon,
  actionClassName,
  notFocusable,
  children
}) => {
  const [checked, setChecked] = useState(isChecked);
  const [enabled] = useState(!disabled);

  const handleClick = useCallback(() => {
    if (!enabled) return;
    
    const newChecked = !checked;
    setChecked(newChecked);
    onChange?.(newChecked, false);
  }, [checked, enabled, onChange]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!enabled) return;

    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      const newChecked = !checked;
      setChecked(newChecked);
      onChange?.(newChecked, true);
    }

    onKeyDown?.(event);
  }, [checked, enabled, onChange, onKeyDown]);

  // Build CSS classes
  const classes = [
    'custom-toggle',
    checked ? 'checked' : '',
    !enabled ? 'disabled' : '',
    actionClassName ?? '',
    className
  ].filter(Boolean).join(' ');

  // Merge default styles with provided styles
  const mergedStyles = {
    ...defaultToggleStyles,
    ...styles
  };

  // Inline styles based on checked and disabled state
  const inlineStyles: React.CSSProperties = {
    color: !enabled 
      ? 'var(--checkbox-disabled-foreground)' 
      : checked 
        ? mergedStyles.inputActiveOptionForeground 
        : 'var(--checkbox-foreground)',
    backgroundColor: !enabled 
      ? 'var(--checkbox-disabled-background)' 
      : checked 
        ? 'var(--checkbox-background)' 
        : 'transparent',
    borderColor: !enabled 
      ? 'var(--checkbox-disabled-background)' 
      : checked 
        ? mergedStyles.inputActiveOptionBorder 
        : 'var(--checkbox-border)'
  };

  return (
    <div
      className="toggle-container"
      {...(dataTestId && { 'data-testid': dataTestId })}
      style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
    >
      <div
        id={id}
        className={classes}
        {...(dataTestId && {
          'data-testid': `${dataTestId}-action`,
          'data-is-checked': checked ? 'true' : 'false',
          'data-is-disabled': enabled ? 'false' : 'true'
        })}
        tabIndex={notFocusable ? -1 : 0}
        role="checkbox"
        aria-checked={checked}
        aria-label={typeof children === 'string' ? children : 'Toggle'}
        aria-disabled={!enabled}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        style={inlineStyles}
      >
        {checked && (
          <span 
            className={`codicon codicon-${icon ?? 'check'}`}
            {...(dataTestId && { 'data-testid': `${dataTestId}-icon` })}
            style={{
              fontSize: '16px',
              color: 'var(--checkbox-foreground)',
              display: 'inline-block',
              lineHeight: '1'
            }}
          />
        )}
      </div>
             {children && (
               <span
                 onClick={handleClick}
                 {...(dataTestId && { 'data-testid': `${dataTestId}-label` })}
                 style={{
                   cursor: enabled ? 'pointer' : 'default',
                   color: enabled ? 'var(--foreground)' : 'var(--disabledForeground)',
                   userSelect: 'none'
                 }}
               >
                 {children}
               </span>
             )}
    </div>
  );
};

export { Toggle };
export default Toggle;
