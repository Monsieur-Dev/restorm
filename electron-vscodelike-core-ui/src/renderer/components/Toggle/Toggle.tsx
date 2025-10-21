import React, { useState, useCallback } from 'react'
import './toggle.css'

export interface IToggleOpts extends IToggleStyles {
  readonly actionClassName?: string;
  readonly icon?: string; // Codicon icon name (e.g. 'check')
  readonly title: string;
  readonly isChecked: boolean;
  readonly notFocusable?: boolean;
}

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
  opts: IToggleOpts;
  onChange?: (checked: boolean, viaKeyboard: boolean) => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  styles?: IToggleStyles;
  label?: string;
}

// Default styles based on VSCode defaultStyles.ts
export const defaultToggleStyles: IToggleStyles = {
  inputActiveOptionBorder: 'var(--vscode-inputOption-activeBorder)',
  inputActiveOptionForeground: 'var(--vscode-inputOption-activeForeground)',
  inputActiveOptionBackground: 'var(--vscode-inputOption-activeBackground)'
};

const Toggle: React.FC<ToggleProps> = ({
  opts,
  onChange,
  onKeyDown,
  disabled = false,
  className = '',
  id,
  styles,
  label
}) => {
  const [checked, setChecked] = useState(opts.isChecked);
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
    'monaco-custom-toggle',
    checked ? 'codicon' : '',
    checked && opts.icon ? `codicon-${opts.icon}` : '',
    checked && !opts.icon ? 'codicon-check' : '',
    checked ? 'checked' : '',
    !enabled ? 'disabled' : '',
    opts.actionClassName || '',
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
      ? 'var(--vscode-checkbox-disabled-foreground)' 
      : checked 
        ? mergedStyles.inputActiveOptionForeground 
        : 'var(--vscode-checkbox-foreground)',
    backgroundColor: !enabled 
      ? 'var(--vscode-checkbox-disabled-background)' 
      : checked 
        ? 'var(--vscode-checkbox-background)' 
        : 'transparent',
    borderColor: !enabled 
      ? 'var(--vscode-checkbox-disabled-background)' 
      : checked 
        ? mergedStyles.inputActiveOptionBorder 
        : 'var(--vscode-checkbox-border)'
  };

  return (
    <div className="toggle-container" style={{ display: 'flex', alignItems: 'center', gap: '8px' }} >
      <div
        id={id}
        className={classes}
        tabIndex={opts.notFocusable ? -1 : 0}
        role="checkbox"
        aria-checked={checked}
        aria-label={opts.title}
        aria-disabled={!enabled}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        style={inlineStyles}
      >
        {checked && (
          <span className={`codicon codicon-${opts.icon || 'check'}`} />
        )}
      </div>
      {label && (
        <span 
          onClick={handleClick}
          style={{ 
            cursor: enabled ? 'pointer' : 'default',
            color: enabled ? 'var(--vscode-foreground)' : 'var(--vscode-disabledForeground)',
            fontSize: '13px',
            userSelect: 'none'
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
};

export { Toggle };
export default Toggle;
