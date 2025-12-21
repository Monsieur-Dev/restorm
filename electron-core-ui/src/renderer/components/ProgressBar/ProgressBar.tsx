import React, { useState, useEffect, useRef, useCallback } from 'react'
import './progressbar.css'
import type { ProgressBarProps } from './types'
import { defaultProgressBarStyles } from './types'

const ProgressBar: React.FC<ProgressBarProps> = ({
  options,
  mode = 'infinite',
  value = 0,
  total = 100,
  className = '',
  id,
  onComplete
}) => {
  // Track async states (timers)
  const [isLongRunning, setIsLongRunning] = useState(false);
  const [hasCompletedAnimation, setHasCompletedAnimation] = useState(false);
  // Track previous mode to know if we came from discrete mode when completing
  const [wasDiscreteBeforeDone, setWasDiscreteBeforeDone] = useState(false);
  
  const longRunningTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const doneTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const prevModeRef = useRef(mode);

  // Derive states from mode
  const isInfinite = mode === 'infinite';
  const isDiscrete = mode === 'discrete';
  const isDone = mode === 'done';
  const isActive = mode !== 'done' || !hasCompletedAnimation;
  
  // Calculate current value based on mode
  const currentValue = (() => {
    if (mode === 'infinite') return 2; // 2% width for infinite mode
    if (mode === 'discrete') return Math.min(100, Math.max(0, value));
    // mode === 'done' at this point
    if (wasDiscreteBeforeDone) return 100;
    return 0;
  })();

  // Merge default styles with provided styles
  const mergedStyles = {
    ...defaultProgressBarStyles,
    ...options
  };

  // Handle mode changes - only for async operations
  useEffect(() => {
    // Reset states on mode change and track if we came from discrete
    if (mode !== prevModeRef.current) {
      const wasDiscrete = prevModeRef.current === 'discrete';
      prevModeRef.current = mode;
      // Use requestAnimationFrame to defer the setState
      const rafId = requestAnimationFrame(() => {
        setIsLongRunning(false);
        setHasCompletedAnimation(false);
        // Track if we're transitioning to done from discrete
        setWasDiscreteBeforeDone(mode === 'done' && wasDiscrete);
      });
      return () => { cancelAnimationFrame(rafId); };
    }
    prevModeRef.current = mode;

    if (mode === 'infinite') {
      // Long running mode after 10 seconds
      longRunningTimeoutRef.current = setTimeout(() => {
        setIsLongRunning(true);
      }, 10000);
    } else if (mode === 'done') {
      // Auto-hide after 200ms
      doneTimeoutRef.current = setTimeout(() => {
        setHasCompletedAnimation(true);
        onComplete?.();
      }, 200);
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
    'progress-container',
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
