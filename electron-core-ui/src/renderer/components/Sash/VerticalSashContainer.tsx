import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Sash } from './Sash'
import { useVerticalSash } from '../../hooks/useVerticalSash'
import type { SashEvent } from './types'
import './sash.css'

import type { VerticalSashContainerProps as VerticalSashContainerPropsType } from './types'

export type VerticalSashContainerProps = VerticalSashContainerPropsType

export const VerticalSashContainer: React.FC<VerticalSashContainerProps> = ({
  Left,
  Right,
  LeftWhenResizing,
  RightWhenResizing,
  initialWidth = 200,
  initialLeftRatio,
  keepRatio = false,
  minLeftWidth = 50,
  minRightWidth = 240,
  storageKey,
  className = '',
  sashConfig,
  'data-testid': dataTestId
}) => {
  const [isResizing, setIsResizing] = useState(false)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)

  const sashOptions = React.useMemo(() => {
    const opts: Parameters<typeof useVerticalSash>[0] = {
      initialWidth,
      minWidth: minLeftWidth,
      minRightWidth
    }
    if (storageKey !== undefined) {
      opts.storageKey = storageKey
    }
    return opts
  }, [initialWidth, minLeftWidth, minRightWidth, storageKey])

  const {
    containerRef,
    width,
    setWidth,
    layoutProvider,
    handleSashStart,
    handleSashChange
  } = useVerticalSash(sashOptions)

  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(() => {
      setContainerWidth(container.clientWidth)
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
    }
  }, [containerRef])

  // Seed the left width from a ratio once the container has been
  // measured. Only runs once — subsequent container resizes keep the
  // absolute width the user has since dragged to. Skipped when a
  // storageKey is present (persisted value wins) or when the hook
  // already loaded a non-default starting width.
  const didInitFromRatioRef = useRef(false)
  useEffect(() => {
    if (didInitFromRatioRef.current) return
    if (initialLeftRatio === undefined) return
    if (storageKey !== undefined) return
    if (containerWidth <= 0) return
    didInitFromRatioRef.current = true
    const clampedRatio = Math.min(1, Math.max(0, initialLeftRatio))
    const target = Math.max(
      minLeftWidth,
      Math.min(containerWidth - minRightWidth, Math.round(containerWidth * clampedRatio))
    )
    setWidth(target)
  }, [containerWidth, initialLeftRatio, storageKey, minLeftWidth, minRightWidth, setWidth])

  // Proportional resize: remember the share the left panel has (updated by
  // the user's drags and by the ratio seed above), and re-derive the pixel
  // width from it whenever the container's width changes. The width this
  // effect sets itself is flagged so a clamp at a min width does not drift
  // the remembered share.
  const ratioRef = useRef<number | null>(null)
  const lastContainerWidthRef = useRef(0)
  const selfSetWidthRef = useRef<number | null>(null)
  useEffect(() => {
    if (!keepRatio || containerWidth <= 0) return
    const previous = lastContainerWidthRef.current
    lastContainerWidthRef.current = containerWidth
    if (previous === containerWidth || previous === 0) {
      // Same container: the width changed by a drag (or the seed) — unless
      // it is the value this effect just set.
      if (selfSetWidthRef.current !== width) ratioRef.current = width / containerWidth
      selfSetWidthRef.current = null
      return
    }
    const ratio = ratioRef.current ?? width / previous
    const target = Math.max(
      minLeftWidth,
      Math.min(containerWidth - minRightWidth, Math.round(containerWidth * ratio))
    )
    if (target !== width) {
      selfSetWidthRef.current = target
      setWidth(target)
    }
  }, [keepRatio, containerWidth, width, minLeftWidth, minRightWidth, setWidth])

  const [actualMinLeftWidth, setActualMinLeftWidth] = useState(minLeftWidth)
  const [actualMinRightWidth, setActualMinRightWidth] = useState(minRightWidth)

  useEffect(() => {
    const measureMinWidths = (): void => {
      if (leftRef.current) {
        const computedStyle = window.getComputedStyle(leftRef.current)
        const minWidth = computedStyle.minWidth
        if (minWidth && minWidth !== 'none' && minWidth !== '0px') {
          const parsed = parseFloat(minWidth)
          if (!isNaN(parsed)) {
            setActualMinLeftWidth(Math.max(minLeftWidth, parsed))
          }
        }
      }
      if (rightRef.current) {
        const computedStyle = window.getComputedStyle(rightRef.current)
        const minWidth = computedStyle.minWidth
        if (minWidth && minWidth !== 'none' && minWidth !== '0px') {
          const parsed = parseFloat(minWidth)
          if (!isNaN(parsed)) {
            setActualMinRightWidth(Math.max(minRightWidth, parsed))
          }
        }
      }
    }

    measureMinWidths()
    const observer = new ResizeObserver(measureMinWidths)
    if (leftRef.current) observer.observe(leftRef.current)
    if (rightRef.current) observer.observe(rightRef.current)

    return () => {
      observer.disconnect()
    }
  }, [minLeftWidth, minRightWidth])

  const handleStart = useCallback(
    (event: SashEvent): void => {
      setIsResizing(true)
      handleSashStart(event)
    },
    [handleSashStart]
  )

  const handleChange = useCallback(
    (event: SashEvent): void => {
      handleSashChange(event)
    },
    [handleSashChange]
  )

  const handleEnd = useCallback((): void => {
    setIsResizing(false)
  }, [])

  const sashState = React.useMemo(() => {
    if (containerWidth === 0) return 'enabled'
    const maxLeftWidth = containerWidth - actualMinRightWidth
    if (width <= actualMinLeftWidth) return 'atMinimum'
    if (width >= maxLeftWidth) return 'atMaximum'
    return 'enabled'
  }, [width, actualMinLeftWidth, actualMinRightWidth, containerWidth])

  const leftContent = isResizing && LeftWhenResizing !== undefined ? LeftWhenResizing : Left
  const rightContent = isResizing && RightWhenResizing !== undefined ? RightWhenResizing : Right

  return (
    <div
      ref={containerRef}
      className={`vertical-sash-container ${className}`.trim()}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        overflow: 'hidden'
      }}
      {...(dataTestId && {
        'data-testid': dataTestId,
        'data-left-width': String(Math.round(width)),
        'data-container-width': String(Math.round(containerWidth)),
        'data-min-left-width': String(Math.round(actualMinLeftWidth)),
        'data-min-right-width': String(Math.round(actualMinRightWidth)),
        'data-sash-state': sashState,
        'data-is-resizing': isResizing ? 'true' : 'false'
      })}
    >
      {leftContent !== undefined && (
        <div
          ref={leftRef}
          className="vertical-sash-container-left"
          style={{
            width: `${width}px`,
            minWidth: `${actualMinLeftWidth}px`,
            height: '100%',
            minHeight: 0,
            overflow: 'hidden',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column'
          }}
          {...(dataTestId && { 'data-testid': `${dataTestId}-left` })}
        >
          {leftContent}
        </div>
      )}
      <Sash
        orientation="vertical"
        layoutProvider={layoutProvider}
        state={sashState}
        {...(dataTestId && { 'data-testid': `${dataTestId}-sash` })}
        {...(sashConfig?.size !== undefined && { size: sashConfig.size })}
        {...(sashConfig?.hoverDelay !== undefined && { hoverDelay: sashConfig.hoverDelay })}
        onStart={handleStart}
        onChange={handleChange}
        onEnd={handleEnd}
        {...(sashConfig?.onReset !== undefined && { onReset: sashConfig.onReset })}
        {...(sashConfig?.className !== undefined && { className: sashConfig.className })}
      />
      {rightContent !== undefined && (
        <div
          ref={rightRef}
          className="vertical-sash-container-right"
          style={{
            flex: 1,
            minWidth: `${actualMinRightWidth}px`,
            height: '100%',
            minHeight: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}
          {...(dataTestId && { 'data-testid': `${dataTestId}-right` })}
        >
          {rightContent}
        </div>
      )}
    </div>
  )
}
