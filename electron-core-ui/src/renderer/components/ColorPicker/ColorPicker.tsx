import React, { useCallback } from 'react'
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
  const handleChange = useCallback(
    (color: UiwColorResult): void => {
      onChange(color.hex)
    },
    [onChange]
  )

  return (
    <div
      className={['ecu-color-picker', className].filter(Boolean).join(' ')}
      style={style}
      data-disable-alpha={String(disableAlpha)}
      {...(dataTestId && { 'data-testid': dataTestId })}
    >
      <Sketch color={value} onChange={handleChange} disableAlpha={disableAlpha} />
    </div>
  )
}

export default ColorPicker
