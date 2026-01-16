import type React from 'react'

export interface ColorPickerProps {
  /** Current color in hex format (e.g. "#ff00aa") */
  value: string
  /** Called with the selected color in hex format */
  onChange: (nextHex: string) => void
  /** Disable alpha channel in the picker */
  disableAlpha?: boolean
  /** Optional className applied to the wrapper */
  className?: string
  /** Optional style applied to the wrapper */
  style?: React.CSSProperties
}
