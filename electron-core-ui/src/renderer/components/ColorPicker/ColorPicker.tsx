import React, { useCallback, useRef, useState, useEffect } from 'react'
import { Sketch } from '@uiw/react-color'
import type { ColorPickerProps } from './types'
import './colorPicker.css'

interface UiwColorResult {
  hex: string
}

const ColorPicker: React.FC<ColorPickerProps> = ({
  value,
  onChange,
  'data-testid': dataTestId,
  disableAlpha = true,
  className = '',
  style
}) => {
  // Local color for real-time visual feedback during drag.
  // onChange is only called on mouseup to avoid excessive events.
  const [localColor, setLocalColor] = useState(value)
  const isDraggingRef = useRef(false)
  const pendingColorRef = useRef<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleChange = useCallback(
    (color: UiwColorResult): void => {
      setLocalColor(color.hex)
      if (isDraggingRef.current) {
        pendingColorRef.current = color.hex
      } else {
        onChange(color.hex)
      }
    },
    [onChange]
  )

  // Detect drag via mousedown/mouseup on the picker container
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleMouseDown = (): void => {
      isDraggingRef.current = true
      pendingColorRef.current = null
    }

    const handleMouseUp = (): void => {
      if (isDraggingRef.current && pendingColorRef.current !== null) {
        onChange(pendingColorRef.current)
        pendingColorRef.current = null
      }
      isDraggingRef.current = false
    }

    container.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      container.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [onChange])

  return (
    <div
      ref={containerRef}
      className={['ecu-color-picker', className].filter(Boolean).join(' ')}
      style={style}
      data-disable-alpha={String(disableAlpha)}
      {...(dataTestId && { 'data-testid': dataTestId })}
    >
      <Sketch color={localColor} onChange={handleChange} disableAlpha={disableAlpha} />
    </div>
  )
}

const MemoizedColorPicker = React.memo(ColorPicker)
export { MemoizedColorPicker as ColorPicker }
