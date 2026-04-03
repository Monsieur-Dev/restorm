import type React from 'react'
import type { IInputOptions } from '../InputBox'

export type DateTimePickerOutputMode = 'pattern' | 'unix' | 'epoch' | 'iso'

/**
 * First day of week, aligned with JavaScript Date.getDay():
 * 0 = Sunday ... 6 = Saturday
 */
export type DateTimePickerFirstDayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface DateTimePickerProps {
  /** Selected value */
  value: Date | null
  /** Called when the user selects a date */
  onChange: (next: Date) => void
  /**
   * First day of the week shown in the calendar header and grid.
   * Default: Monday (1).
   */
  firstDayOfWeek?: DateTimePickerFirstDayOfWeek
  /** Output mode for the displayed value */
  outputMode?: DateTimePickerOutputMode
  /** Format used when outputMode is "pattern" */
  format?: string
  /** Called when outputMode changes (if provided, component behaves as controlled for outputMode) */
  onOutputModeChange?: (next: DateTimePickerOutputMode) => void
  /** Called when format changes (if provided, component behaves as controlled for format) */
  onFormatChange?: (next: string) => void
  /** Whether the time part is enabled (hours/minutes) */
  includeTime?: boolean
  /** Called when includeTime changes (if provided, component behaves as controlled for includeTime) */
  onIncludeTimeChange?: (next: boolean) => void
  /** Disable interaction */
  disabled?: boolean
  /** Optional wrapper className */
  className?: string
  /** Optional wrapper styles */
  style?: React.CSSProperties
  /** Optional overrides for the underlying InputBox options */
  inputOptions?: Partial<IInputOptions>
  /** Optional test id applied to the root element. */
  'data-testid'?: string
}
