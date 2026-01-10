import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Sash } from './Sash'
import { useHorizontalSash } from '../../hooks/useHorizontalSash'
import type { SashEvent } from './types'
import './sash.css'

import type { HorizontalSashContainerProps as HorizontalSashContainerPropsType } from './types'

export type HorizontalSashContainerProps = HorizontalSashContainerPropsType

export const HorizontalSashContainer: React.FC<HorizontalSashContainerProps> = ({
  Top,
  Bottom,
  TopWhenResizing,
  BottomWhenResizing,
  initialHeight = 200,
  minTopHeight = 50,
  minBottomHeight = 100,
  storageKey,
  className = '',
  sashConfig
}) => {
  const [isResizing, setIsResizing] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const sashOptions = React.useMemo(() => {
    const opts: Parameters<typeof useHorizontalSash>[0] = {
      initialHeight,
      minHeight: minTopHeight,
      minBottomHeight
    }
    if (storageKey !== undefined) {
      opts.storageKey = storageKey
    }
    return opts
  }, [initialHeight, minTopHeight, minBottomHeight, storageKey])

  const {
    containerRef,
    height,
    layoutProvider,
    handleSashStart,
    handleSashChange
  } = useHorizontalSash(sashOptions)

  const [containerHeight, setContainerHeight] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(() => {
      setContainerHeight(container.clientHeight)
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
    }
  }, [containerRef])

  const [actualMinTopHeight, setActualMinTopHeight] = useState(minTopHeight)
  const [actualMinBottomHeight, setActualMinBottomHeight] = useState(minBottomHeight)

  useEffect(() => {
    const measureMinHeights = (): void => {
      if (topRef.current) {
        const computedStyle = window.getComputedStyle(topRef.current)
        const minHeight = computedStyle.minHeight
        if (minHeight && minHeight !== 'none' && minHeight !== '0px') {
          const parsed = parseFloat(minHeight)
          if (!isNaN(parsed)) {
            setActualMinTopHeight(Math.max(minTopHeight, parsed))
          }
        }
      }
      if (bottomRef.current) {
        const computedStyle = window.getComputedStyle(bottomRef.current)
        const minHeight = computedStyle.minHeight
        if (minHeight && minHeight !== 'none' && minHeight !== '0px') {
          const parsed = parseFloat(minHeight)
          if (!isNaN(parsed)) {
            setActualMinBottomHeight(Math.max(minBottomHeight, parsed))
          }
        }
      }
    }

    measureMinHeights()
    const observer = new ResizeObserver(measureMinHeights)
    if (topRef.current) observer.observe(topRef.current)
    if (bottomRef.current) observer.observe(bottomRef.current)

    return () => {
      observer.disconnect()
    }
  }, [minTopHeight, minBottomHeight])

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
    if (containerHeight === 0) return 'enabled'
    const maxTopHeight = containerHeight - actualMinBottomHeight
    if (height <= actualMinTopHeight) return 'atMinimum'
    if (height >= maxTopHeight) return 'atMaximum'
    return 'enabled'
  }, [height, actualMinTopHeight, actualMinBottomHeight, containerHeight])

  const topContent = isResizing && TopWhenResizing !== undefined ? TopWhenResizing : Top
  const bottomContent = isResizing && BottomWhenResizing !== undefined ? BottomWhenResizing : Bottom

  return (
    <div
      ref={containerRef}
      className={`horizontal-sash-container ${className}`.trim()}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {topContent !== undefined && (
        <div
          ref={topRef}
          className="horizontal-sash-container-top"
          style={{
            height: `${height}px`,
            minHeight: `${actualMinTopHeight}px`,
            width: '100%',
            minWidth: 0,
            overflow: 'hidden',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {topContent}
        </div>
      )}
      <Sash
        orientation="horizontal"
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
      {bottomContent !== undefined && (
        <div
          ref={bottomRef}
          className="horizontal-sash-container-bottom"
          style={{
            flex: 1,
            minHeight: `${actualMinBottomHeight}px`,
            width: '100%',
            minWidth: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {bottomContent}
        </div>
      )}
    </div>
  )
}

export default HorizontalSashContainer
