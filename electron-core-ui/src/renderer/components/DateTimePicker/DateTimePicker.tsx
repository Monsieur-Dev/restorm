import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../Button'
import { Tooltip } from '../Tooltip'
import { InputBox } from '../InputBox'
import type { DateTimePickerProps } from './types'
import './dateTimePicker.css'

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function formatDateWithPattern(date: Date, pattern: string): string {
  return pattern
    .replace(/YYYY/g, date.getFullYear().toString())
    .replace(/MM/g, pad2(date.getMonth() + 1))
    .replace(/DD/g, pad2(date.getDate()))
    .replace(/HH/g, pad2(date.getHours()))
    .replace(/mm/g, pad2(date.getMinutes()))
    .replace(/ss/g, pad2(date.getSeconds()))
}

function formatOutput(date: Date, outputMode: 'pattern' | 'unix' | 'epoch' | 'iso', pattern: string): string {
  switch (outputMode) {
    case 'unix':
      return String(Math.floor(date.getTime() / 1000))
    case 'epoch':
      return String(date.getTime())
    case 'iso':
      return date.toISOString()
    default:
      return formatDateWithPattern(date, pattern)
  }
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
}

function buildCalendarGrid(viewMonth: Date): Date[] {
  const year = viewMonth.getFullYear()
  const month = viewMonth.getMonth()
  const firstOfMonth = new Date(year, month, 1)
  // Monday-first
  const mondayFirstOffset = (firstOfMonth.getDay() + 6) % 7
  const gridStart = new Date(year, month, 1 - mondayFirstOffset)

  const days: Date[] = []
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    days.push(d)
  }
  return days
}

const DateTimePicker: React.FC<DateTimePickerProps> = ({
  value,
  onChange,
  outputMode,
  format,
  onOutputModeChange,
  onFormatChange,
  includeTime,
  onIncludeTimeChange,
  disabled = false,
  className = '',
  style,
  inputOptions
}) => {
  const { t } = useTranslation()
  const targetRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  const [uncontrolledOutputMode, setUncontrolledOutputMode] = useState<'pattern' | 'unix' | 'epoch' | 'iso'>(
    outputMode ?? 'pattern'
  )

  const effectiveOutputMode = outputMode ?? uncontrolledOutputMode

  const defaultPattern = 'YYYY-MM-DD'
  const [uncontrolledPattern, setUncontrolledPattern] = useState<string>(format ?? defaultPattern)
  const effectivePattern = format ?? uncontrolledPattern

  const [uncontrolledIncludeTime, setUncontrolledIncludeTime] = useState<boolean>(includeTime ?? false)
  const effectiveIncludeTime = includeTime ?? uncontrolledIncludeTime

  const initialView = useMemo(() => {
    const base = value ?? new Date()
    return new Date(base.getFullYear(), base.getMonth(), 1)
  }, [value])

  const [viewMonth, setViewMonth] = useState<Date>(initialView)

  const displayValue = useMemo(() => {
    if (!value) return ''
    return formatOutput(value, effectiveOutputMode, effectivePattern)
  }, [effectiveOutputMode, effectivePattern, value])

  const monthLabel = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
    return formatter.format(viewMonth)
  }, [viewMonth])

  const weekdayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
    // Monday 2024-01-01 is a Monday
    const monday = new Date(2024, 0, 1)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      return formatter.format(d)
    })
  }, [])

  const gridDays = useMemo(() => buildCalendarGrid(viewMonth), [viewMonth])

  const handleToggle = useCallback((): void => {
    if (disabled) return
    setIsOpen((prev) => !prev)
  }, [disabled])

  useEffect(() => {
    if (!isOpen) return

    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (!target) return

      // Click on the trigger button should not close.
      if (targetRef.current?.contains(target)) return

      // Click inside the tooltip should not close.
      const tooltipEl = document.querySelector('.ecu-date-time-picker-tooltip')
      if (tooltipEl?.contains(target)) return

      setIsOpen(false)
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [isOpen])

  const handleSelectDay = useCallback(
    (day: Date): void => {
      if (disabled) return
      const prev = value ?? new Date()
      const next = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        prev.getHours(),
        prev.getMinutes(),
        prev.getSeconds(),
        prev.getMilliseconds()
      )
      onChange(next)
      setIsOpen(false)
    },
    [disabled, onChange, value]
  )

  const handleSetOutputMode = useCallback(
    (nextMode: 'pattern' | 'unix' | 'epoch' | 'iso'): void => {
      if (disabled) return
      if (onOutputModeChange) {
        onOutputModeChange(nextMode)
        return
      }
      setUncontrolledOutputMode(nextMode)
    },
    [disabled, onOutputModeChange]
  )

  const handleSetPattern = useCallback(
    (nextPattern: string): void => {
      if (disabled) return
      if (onFormatChange) {
        onFormatChange(nextPattern)
        return
      }
      setUncontrolledPattern(nextPattern)
    },
    [disabled, onFormatChange]
  )

  const setTimeParts = useCallback(
    (hours: number, minutes: number): void => {
      if (disabled) return
      const base = value ?? new Date()
      const next = new Date(base)
      next.setHours(hours)
      next.setMinutes(minutes)
      next.setSeconds(0)
      next.setMilliseconds(0)
      onChange(next)
    },
    [disabled, onChange, value]
  )

  const handleToggleIncludeTime = useCallback((): void => {
    if (disabled) return
    const nextIncludeTime = !effectiveIncludeTime

    if (onIncludeTimeChange) {
      onIncludeTimeChange(nextIncludeTime)
    } else {
      setUncontrolledIncludeTime(nextIncludeTime)
    }

    const base = value ?? new Date()
    const nextDate = new Date(base)
    if (!nextIncludeTime) {
      nextDate.setHours(0, 0, 0, 0)
      onChange(nextDate)
    }

    if (effectiveOutputMode === 'pattern') {
      const hasTimeTokens = /HH|mm|ss/.test(effectivePattern)
      if (nextIncludeTime && !hasTimeTokens) {
        handleSetPattern('YYYY-MM-DD HH:mm:ss')
      }
      if (!nextIncludeTime && hasTimeTokens) {
        handleSetPattern('YYYY-MM-DD')
      }
    }
  }, [
    disabled,
    effectiveIncludeTime,
    effectiveOutputMode,
    effectivePattern,
    handleSetPattern,
    onChange,
    onIncludeTimeChange,
    value
  ])

  const calendarContent = (
    <div
      className="ecu-date-time-picker-popover"
      onMouseDown={(e) => {
        e.stopPropagation()
      }}
    >
      <div className="ecu-date-time-picker-header">
        <Button
          small
          secondary
          icon="chevron-left"
          onClick={() => {
            setViewMonth((m) => addMonths(m, -1))
          }}
          options={{ ariaLabel: t('dateTimePicker.previousMonth') }}
        />
        <div className="ecu-date-time-picker-month">{monthLabel}</div>
        <Button
          small
          secondary
          icon="chevron-right"
          onClick={() => {
            setViewMonth((m) => addMonths(m, 1))
          }}
          options={{ ariaLabel: t('dateTimePicker.nextMonth') }}
        />
      </div>

      <div className="ecu-date-time-picker-weekdays">
        {weekdayLabels.map((l) => (
          <div key={l} className="ecu-date-time-picker-weekday">
            {l}
          </div>
        ))}
      </div>

      <div className="ecu-date-time-picker-grid">
        {gridDays.map((d) => {
          const isInMonth = d.getMonth() === viewMonth.getMonth()
          const isSelected = value ? isSameDay(d, value) : false
          return (
            <button
              key={`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`}
              type="button"
              className={['ecu-date-time-picker-day', !isInMonth && 'is-outside', isSelected && 'is-selected']
                .filter(Boolean)
                .join(' ')}
              onClick={() => {
                handleSelectDay(d)
              }}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>

      <div className="ecu-date-time-picker-controls">
        <label className="ecu-date-time-picker-control">
          <input
            type="checkbox"
            checked={effectiveIncludeTime}
            onChange={() => {
              handleToggleIncludeTime()
            }}
            disabled={disabled}
          />
          <span>{t('dateTimePicker.includeTime')}</span>
        </label>

        {effectiveIncludeTime ? (
          <div className="ecu-date-time-picker-time">
            <input
              className="ecu-date-time-picker-time-input"
              type="number"
              min={0}
              max={23}
              value={value ? value.getHours() : 0}
              onChange={(e) => {
                const hours = Number(e.target.value)
                const clamped = Number.isFinite(hours) ? Math.min(23, Math.max(0, hours)) : 0
                setTimeParts(clamped, value ? value.getMinutes() : 0)
              }}
              disabled={disabled}
              aria-label={t('dateTimePicker.hours')}
            />
            <span className="ecu-date-time-picker-time-sep">:</span>
            <input
              className="ecu-date-time-picker-time-input"
              type="number"
              min={0}
              max={59}
              value={value ? value.getMinutes() : 0}
              onChange={(e) => {
                const minutes = Number(e.target.value)
                const clamped = Number.isFinite(minutes) ? Math.min(59, Math.max(0, minutes)) : 0
                setTimeParts(value ? value.getHours() : 0, clamped)
              }}
              disabled={disabled}
              aria-label={t('dateTimePicker.minutes')}
            />
          </div>
        ) : null}

        <div className="ecu-date-time-picker-output">
          <label className="ecu-date-time-picker-output-label">{t('dateTimePicker.output')}</label>
          <select
            className="ecu-date-time-picker-select"
            value={effectiveOutputMode}
            onChange={(e) => {
              handleSetOutputMode(e.target.value as 'pattern' | 'unix' | 'epoch' | 'iso')
            }}
            disabled={disabled}
          >
            <option value="pattern">{t('dateTimePicker.outputModes.pattern')}</option>
            <option value="unix">{t('dateTimePicker.outputModes.unix')}</option>
            <option value="epoch">{t('dateTimePicker.outputModes.epoch')}</option>
            <option value="iso">{t('dateTimePicker.outputModes.iso')}</option>
          </select>
        </div>

        {effectiveOutputMode === 'pattern' ? (
          <div className="ecu-date-time-picker-pattern">
            <input
              className="ecu-date-time-picker-pattern-input"
              type="text"
              value={effectivePattern}
              onChange={(e) => {
                handleSetPattern(e.target.value)
              }}
              disabled={disabled}
              aria-label={t('dateTimePicker.pattern')}
              placeholder="YYYY-MM-DD HH:mm:ss"
            />
          </div>
        ) : null}
      </div>
    </div>
  )

  return (
    <div className={['ecu-date-time-picker', className].filter(Boolean).join(' ')} style={style}>
      <div className="ecu-date-time-picker-input">
        <InputBox
          options={{
            ...(inputOptions?.placeholder !== undefined ? { placeholder: inputOptions.placeholder } : {}),
            ...(inputOptions?.tooltip !== undefined ? { tooltip: inputOptions.tooltip } : {}),
            ...(inputOptions?.showPlaceholderOnFocus !== undefined
              ? { showPlaceholderOnFocus: inputOptions.showPlaceholderOnFocus }
              : {}),
            ariaLabel: inputOptions?.ariaLabel ?? t('dateTimePicker.ariaLabel')
          }}
          value={displayValue}
          onKeyDown={(e) => {
            // Prevent editing while keeping focus/copy shortcuts.
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleToggle()
              return
            }
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
              e.preventDefault()
            }
          }}
          disabled={disabled}
        />
      </div>

      <div className="ecu-date-time-picker-button">
        <div ref={targetRef} className="ecu-date-time-picker-button-target">
          <Button
            small
            secondary
            icon="clock"
            disabled={disabled}
            onClick={(e) => {
              e.preventDefault()
              handleToggle()
            }}
            options={{ ariaLabel: t('dateTimePicker.openCalendar') }}
          />
        </div>
      </div>

      <Tooltip
        targetRef={targetRef as unknown as React.RefObject<HTMLElement | null>}
        show={isOpen}
        content={calendarContent}
        className="ecu-date-time-picker-tooltip"
        placement="below"
        onMouseDown={(e) => {
          e.stopPropagation()
        }}
      />
    </div>
  )
}

export default DateTimePicker
