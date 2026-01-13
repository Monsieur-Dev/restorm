import type React from 'react'
import type { IInputOptions } from '../InputBox'

export interface DateTimePickerProps {
  /** Selected value */
  value: Date | null
  /** Called when the user selects a date */
  onChange: (next: Date) => void
  /** Disable interaction */
  disabled?: boolean
  /** Optional wrapper className */
  className?: string
  /** Optional wrapper styles */
  style?: React.CSSProperties
  /** Optional overrides for the underlying InputBox options */
  inputOptions?: Partial<IInputOptions>
}
