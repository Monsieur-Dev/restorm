import React, { useState, useEffect, useRef, useCallback } from 'react'
import './progressbar.css'

export interface IProgressBarStyles {
  readonly progressBarBackground?: string;
}

export interface IProgressBarOptions extends IProgressBarStyles {
  readonly progressBarBackground?: string;
}

export interface ProgressBarProps {
  options?: IProgressBarOptions;
  mode?: 'infinite' | 'discrete' | 'done';
  value?: number; // For discrete mode: 0-100
  total?: number; // For discrete mode: total work units
  className?: string;
  id?: string;
  onComplete?: () => void;
}

// Default styles based on VSCode
export const defaultProgressBarStyles: IProgressBarStyles = {
  progressBarBackground: 'var(--vscode-progressBar-background, #0E70C0)'
};

const ProgressBar: React.FC<ProgressBarProps> = ({
  options,
  mode = 'infinite',
  value = 0,
  total = 100,
  className = '',
  id,
  onComplete
}) => {
  const [isActive, setIsActive] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [isInfinite, setIsInfinite] = useState(false);
  const [isDiscrete, setIsDiscrete] = useState(false);
  const [isLongRunning, setIsLongRunning] = useState(false);
  const [currentValue, setCurrentValue] = useState(0);
  
  const longRunningTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const doneTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Merge default styles with provided styles
  const mergedStyles = {
    ...defaultProgressBarStyles,
    ...options
  };

  // Handle mode changes
  useEffect(() => {
    switch (mode) {
      case 'infinite':
        setIsActive(true);
        setIsInfinite(true);
        setIsDiscrete(false);
        setIsDone(false);
        setCurrentValue(2); // 2% width for infinite mode
        
        // Long running mode after 10 seconds
        longRunningTimeoutRef.current = setTimeout(() => {
          setIsLongRunning(true);
        }, 10000);
        break;
        
      case 'discrete':
        setIsActive(true);
        setIsInfinite(false);
        setIsDiscrete(true);
        setIsDone(false);
        setCurrentValue(Math.min(100, Math.max(0, value)));
        break;
        
      case 'done':
        setIsDone(true);
        if (isDiscrete) {
          setCurrentValue(100);
        }
        // Auto-hide after 200ms
        doneTimeoutRef.current = setTimeout(() => {
          setIsActive(false);
          onComplete?.();
        }, 200);
        break;
    }

    return () => {
      if (longRunningTimeoutRef.current) {
        clearTimeout(longRunningTimeoutRef.current);
      }
      if (doneTimeoutRef.current) {
        clearTimeout(doneTimeoutRef.current);
      }
    };
  }, [mode, value, isDiscrete, onComplete]);

  // Build CSS classes
  const containerClasses = [
    'monaco-progress-container',
    isActive ? 'active' : '',
    isInfinite ? 'infinite' : '',
    isDiscrete ? 'discrete' : '',
    isDone ? 'done' : '',
    isLongRunning ? 'infinite-long-running' : '',
    className
  ].filter(Boolean).join(' ');

  // Calculate width for discrete mode
  const getWidth = useCallback(() => {
    if (isInfinite) return '2%';
    if (isDiscrete) {
      const percentage = total > 0 ? (currentValue / total) * 100 : 0;
      return `${Math.min(100, Math.max(0, percentage))}%`;
    }
    return 'inherit';
  }, [isInfinite, isDiscrete, currentValue, total]);

  // Calculate opacity
  const getOpacity = useCallback(() => {
    if (isDone && isInfinite) return '0';
    return '1';
  }, [isDone, isInfinite]);

  return (
    <div
      id={id}
      className={containerClasses}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={isDiscrete ? currentValue : undefined}
    >
      <div
        className="progress-bit"
        style={{
          backgroundColor: mergedStyles.progressBarBackground,
          width: getWidth(),
          opacity: getOpacity()
        }}
      />
    </div>
  );
};

export { ProgressBar };
export default ProgressBar;
