import React from 'react'
import { useTranslation } from 'react-i18next'
import { InputBox } from '../InputBox'

/** Parse an ECUI InputBox number string, clamping into `[min, max]`. An empty /
 * non-numeric draft falls back to `min` so the field can never hold an
 * out-of-range time (e.g. `28:85`). */
function clampTimePart(raw: string, min: number, max: number): number {
  const n = Number(raw)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min
}

export interface TimePickerProps {
  /** Current hours value (0-23). */
  hours: number
  /** Current minutes value (0-59). */
  minutes: number
  /** Called with clamped (hours, minutes) when either field changes. */
  onTimeChange: (hours: number, minutes: number) => void
  /** Whether interaction is disabled. */
  disabled: boolean
  /** Test-id prefix. */
  testId: string
}

const TimePickerInner: React.FC<TimePickerProps> = ({
  hours,
  minutes,
  onTimeChange,
  disabled,
  testId
}) => {
  const { t } = useTranslation()

  return (
    <div className="ecu-date-time-picker-time">
      <InputBox
        className="ecu-date-time-picker-time-input"
        data-testid={`${testId}-hours`}
        options={{ type: 'number', min: 0, max: 23, ariaLabel: t('dateTimePicker.hours') }}
        value={String(hours)}
        changeDebounceMs={0}
        disabled={disabled}
        onChange={(v) => {
          onTimeChange(clampTimePart(v, 0, 23), minutes)
        }}
      />
      <span className="ecu-date-time-picker-time-sep">:</span>
      <InputBox
        className="ecu-date-time-picker-time-input"
        data-testid={`${testId}-minutes`}
        options={{ type: 'number', min: 0, max: 59, ariaLabel: t('dateTimePicker.minutes') }}
        value={String(minutes)}
        changeDebounceMs={0}
        disabled={disabled}
        onChange={(v) => {
          onTimeChange(hours, clampTimePart(v, 0, 59))
        }}
      />
    </div>
  )
}

export const TimePicker = React.memo(TimePickerInner)
