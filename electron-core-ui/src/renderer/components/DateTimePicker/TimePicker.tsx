import React from 'react'
import { useTranslation } from 'react-i18next'

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
      <input
        className="ecu-date-time-picker-time-input"
        data-testid={`${testId}-hours`}
        type="number"
        min={0}
        max={23}
        value={hours}
        onChange={(e) => {
          const h = Number(e.target.value)
          const clamped = Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 0
          onTimeChange(clamped, minutes)
        }}
        disabled={disabled}
        aria-label={t('dateTimePicker.hours')}
      />
      <span className="ecu-date-time-picker-time-sep">:</span>
      <input
        className="ecu-date-time-picker-time-input"
        data-testid={`${testId}-minutes`}
        type="number"
        min={0}
        max={59}
        value={minutes}
        onChange={(e) => {
          const m = Number(e.target.value)
          const clamped = Number.isFinite(m) ? Math.min(59, Math.max(0, m)) : 0
          onTimeChange(hours, clamped)
        }}
        disabled={disabled}
        aria-label={t('dateTimePicker.minutes')}
      />
    </div>
  )
}

export const TimePicker = React.memo(TimePickerInner)
