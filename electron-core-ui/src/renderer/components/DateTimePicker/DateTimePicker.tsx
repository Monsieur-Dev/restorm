import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../Button'
import { Tooltip } from '../Tooltip'
import { InputBox } from '../InputBox'
import type { DateTimePickerProps } from './types'
import './dateTimePicker.css'

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
  disabled = false,
  className = '',
  style,
  inputOptions
}) => {
  const targetRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  const initialView = useMemo(() => {
    const base = value ?? new Date()
    return new Date(base.getFullYear(), base.getMonth(), 1)
  }, [value])

  const [viewMonth, setViewMonth] = useState<Date>(initialView)

  const displayValue = value ? value.toString() : ''

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
          options={{ ariaLabel: 'Previous month' }}
        />
        <div className="ecu-date-time-picker-month">{monthLabel}</div>
        <Button
          small
          secondary
          icon="chevron-right"
          onClick={() => {
            setViewMonth((m) => addMonths(m, 1))
          }}
          options={{ ariaLabel: 'Next month' }}
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
            ariaLabel: inputOptions?.ariaLabel ?? 'Date time picker'
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
            options={{ ariaLabel: 'Open calendar' }}
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
