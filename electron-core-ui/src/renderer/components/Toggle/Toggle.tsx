import React, { useCallback } from 'react'
import './toggle.css'
import type { ToggleProps } from './types'
import { defaultToggleStyles } from './types'
import {
  ariaCheckedForToggleState,
  iconForToggleState,
  nextToggleStateOnClick,
  resolveToggleState
} from './toggleLogic'

const ToggleInner: React.FC<ToggleProps> = ({
  state: stateProp,
  isChecked,
  onChange,
  onKeyDown,
  disabled = false,
  className = '',
  id,
  'data-testid': dataTestId,
  styles,
  icon,
  indeterminateIcon = 'dash',
  actionClassName,
  notFocusable,
  children
}) => {
  // Fully prop-controlled: derive the effective state from props on
  // every render. The previous implementation kept a `useState` mirror
  // of `isChecked` and never re-synced from props, so external state
  // changes were silently ignored — the same bug class as the older
  // RadioGroup mirror. With the tri-state addition we cannot afford
  // that drift (cascading parent updates from a tree wouldn't reach
  // their leaf Toggles), so the state lives in the parent.
  const effectiveState = resolveToggleState(stateProp, isChecked);
  const enabled = !disabled;

  const emit = useCallback(
    (viaKeyboard: boolean) => {
      if (!enabled) return;
      const next = nextToggleStateOnClick(effectiveState);
      onChange?.(next === 'checked', viaKeyboard);
    },
    [effectiveState, enabled, onChange]
  );

  const handleClick = useCallback((): void => { emit(false); }, [emit]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!enabled) {
        onKeyDown?.(event);
        return;
      }
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        emit(true);
      }
      onKeyDown?.(event);
    },
    [enabled, emit, onKeyDown]
  );

  // Build CSS classes. The `checked` class drives the existing
  // active-state visual; `indeterminate` is the new variant that
  // shows a dash glyph on a still-active background.
  const classes = [
    'custom-toggle',
    effectiveState === 'checked' ? 'checked' : '',
    effectiveState === 'indeterminate' ? 'indeterminate' : '',
    !enabled ? 'disabled' : '',
    actionClassName ?? '',
    className
  ].filter(Boolean).join(' ');

  // Merge default styles with provided styles
  const mergedStyles = {
    ...defaultToggleStyles,
    ...styles
  };

  // Indeterminate shares the active-option foreground / border with
  // `checked` (so the icon stays readable on the active background)
  // but draws a transparent fill underneath the dash, matching the
  // browser-native `<input type="checkbox" indeterminate>` look that
  // users already recognise.
  const isActiveLike = effectiveState === 'checked' || effectiveState === 'indeterminate';
  const inlineStyles: React.CSSProperties = {
    color: !enabled
      ? 'var(--checkbox-disabled-foreground)'
      : isActiveLike
        ? mergedStyles.inputActiveOptionForeground
        : 'var(--checkbox-foreground)',
    backgroundColor: !enabled
      ? 'var(--checkbox-disabled-background)'
      : effectiveState === 'checked'
        ? 'var(--checkbox-background)'
        : 'transparent',
    borderColor: !enabled
      ? 'var(--checkbox-disabled-background)'
      : isActiveLike
        ? mergedStyles.inputActiveOptionBorder
        : 'var(--checkbox-border)'
  };

  const ariaChecked = ariaCheckedForToggleState(effectiveState);
  const codiconName = iconForToggleState(effectiveState, icon, indeterminateIcon);
  const showIcon = codiconName !== null;

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
          'data-state': effectiveState,
          'data-is-checked': effectiveState === 'checked' ? 'true' : 'false',
          'data-is-indeterminate': effectiveState === 'indeterminate' ? 'true' : 'false',
          'data-is-disabled': enabled ? 'false' : 'true'
        })}
        tabIndex={notFocusable ? -1 : 0}
        role="checkbox"
        aria-checked={ariaChecked}
        aria-label={typeof children === 'string' ? children : 'Toggle'}
        aria-disabled={!enabled}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        style={inlineStyles}
      >
        {showIcon && (
          <span
            className={`codicon codicon-${codiconName}`}
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

const Toggle = React.memo(ToggleInner);
export { Toggle };
export default Toggle;
