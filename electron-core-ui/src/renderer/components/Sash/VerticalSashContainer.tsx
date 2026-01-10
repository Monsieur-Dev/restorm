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
  minLeftWidth = 50,
  minRightWidth = 240,
  storageKey,
  className = '',
  sashConfig
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
        >
          {leftContent}
        </div>
      )}
      <Sash
        orientation="vertical"
        layoutProvider={layoutProvider}
        state={sashState}
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
        >
          {rightContent}
        </div>
      )}
    </div>
  )
}

export default VerticalSashContainer
