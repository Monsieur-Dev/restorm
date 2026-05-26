import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DateTime } from 'luxon'
import { Button } from '../Button'
import { Tooltip } from '../Tooltip'
import { InputBox } from '../InputBox'
import { ControlGroup } from '../ControlGroup'
import { CalendarGrid } from './CalendarGrid'
import { TimePicker } from './TimePicker'
import { OutputSettings } from './OutputSettings'
import type { DateTimePickerProps } from './types'
import './dateTimePicker.css'

function formatOutput(date: Date, outputMode: 'pattern' | 'unix' | 'epoch' | 'iso', pattern: string): string {
  switch (outputMode) {
    case 'unix':
      return String(Math.floor(date.getTime() / 1000))
    case 'epoch':
      return String(date.getTime())
    case 'iso':
      return DateTime.fromJSDate(date).toUTC().toISO() ?? ''
    default:
      return DateTime.fromJSDate(date).toFormat(pattern)
  }
}

const DateTimePickerInner: React.FC<DateTimePickerProps> = ({
  value,
  onChange,
  firstDayOfWeek = 1,
  outputMode,
  format,
  onOutputModeChange,
  onFormatChange,
  includeTime,
  onIncludeTimeChange,
  disabled = false,
  className = '',
  style,
  inputOptions,
  'data-testid': dataTestId
}) => {
  const testId = dataTestId ?? 'datetimepicker'
  const { t } = useTranslation()
  const targetRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const monthPartRef = useRef<HTMLSpanElement | null>(null)
  const yearPartRef = useRef<HTMLSpanElement | null>(null)
  const monthMenuRef = useRef<HTMLDivElement | null>(null)
  const yearMenuRef = useRef<HTMLDivElement | null>(null)
  const [isMonthMenuOpen, setIsMonthMenuOpen] = useState(false)
  const [isYearMenuOpen, setIsYearMenuOpen] = useState(false)

  const [uncontrolledOutputMode, setUncontrolledOutputMode] = useState<'pattern' | 'unix' | 'epoch' | 'iso'>(
    outputMode ?? 'pattern'
  )

  const effectiveOutputMode = outputMode ?? uncontrolledOutputMode

  const defaultPattern = 'yyyy-MM-dd HH:mm:ss'
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

  const previewValue = useMemo(() => {
    if (!value) return ''
    return formatOutput(value, effectiveOutputMode, effectivePattern)
  }, [effectiveOutputMode, effectivePattern, value])

  const handleToggle = useCallback((): void => {
    if (disabled) return
    setIsOpen((prev) => !prev)
  }, [disabled])

  useEffect(() => {
    if (!isOpen) return

    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (!target) return

      if (targetRef.current?.contains(target)) return

      const tooltipEl = document.querySelector('.ecu-date-time-picker-tooltip')
      if (tooltipEl?.contains(target)) return

      setIsOpen(false)
    }

    // Capture phase: some hosts (e.g. a canvas/graph surface that owns pointer
    // gestures) stop propagation on mousedown, so a bubble-phase listener never
    // sees the click and the popover would stay open. Listening in capture runs
    // before those handlers; the containment checks above still keep it open for
    // clicks inside the trigger or the calendar.
    document.addEventListener('mousedown', handleMouseDown, true)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true)
    }
  }, [isOpen])

  // Close month menu when clicking outside
  useEffect(() => {
    if (!isMonthMenuOpen) return

    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (!target) return

      if (monthPartRef.current?.contains(target)) return
      if (monthMenuRef.current?.contains(target)) return

      setIsMonthMenuOpen(false)
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [isMonthMenuOpen])

  // Close year menu when clicking outside
  useEffect(() => {
    if (!isYearMenuOpen) return

    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (!target) return

      if (yearPartRef.current?.contains(target)) return
      if (yearMenuRef.current?.contains(target)) return

      setIsYearMenuOpen(false)
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [isYearMenuOpen])

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
      data-testid={`${testId}-popover-content`}
      onMouseDown={(e) => {
        e.stopPropagation()

        const target = e.target as Node | null
        if (!target) return
        if (monthPartRef.current?.contains(target)) return
        if (yearPartRef.current?.contains(target)) return
        if (monthMenuRef.current?.contains(target)) return
        if (yearMenuRef.current?.contains(target)) return

        setIsMonthMenuOpen(false)
        setIsYearMenuOpen(false)
      }}
    >
      <CalendarGrid
        viewMonth={viewMonth}
        onViewMonthChange={setViewMonth}
        value={value}
        onSelectDay={handleSelectDay}
        firstDayOfWeek={firstDayOfWeek}
        disabled={disabled}
        testId={testId}
        monthPartRef={monthPartRef}
        yearPartRef={yearPartRef}
        monthMenuRef={monthMenuRef}
        yearMenuRef={yearMenuRef}
        isMonthMenuOpen={isMonthMenuOpen}
        isYearMenuOpen={isYearMenuOpen}
        onMonthMenuOpenChange={setIsMonthMenuOpen}
        onYearMenuOpenChange={setIsYearMenuOpen}
      />

      <div className="ecu-date-time-picker-controls" data-testid={`${testId}-controls`}>
        <label className="ecu-date-time-picker-control">
          <input
            data-testid={`${testId}-include-time`}
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
          <TimePicker
            hours={value ? value.getHours() : 0}
            minutes={value ? value.getMinutes() : 0}
            onTimeChange={setTimeParts}
            disabled={disabled}
            testId={testId}
          />
        ) : null}

        <OutputSettings
          outputMode={effectiveOutputMode}
          onOutputModeChange={handleSetOutputMode}
          pattern={effectivePattern}
          onPatternChange={handleSetPattern}
          previewValue={previewValue}
          disabled={disabled}
          testId={testId}
        />
      </div>
    </div>
  )

  return (
    <div
      className={['ecu-date-time-picker', className].filter(Boolean).join(' ')}
      style={style}
      data-testid={testId}
      data-is-open={isOpen ? 'true' : 'false'}
      data-disabled={disabled ? 'true' : 'false'}
      data-output-mode={effectiveOutputMode}
      data-include-time={effectiveIncludeTime ? 'true' : 'false'}
    >
      <ControlGroup className="ecu-date-time-picker-group">
      <div className="ecu-date-time-picker-input">
        <InputBox
          data-testid={`${testId}-input`}
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
        <div
          ref={targetRef}
          className="ecu-date-time-picker-button-target"
          data-testid={`${testId}-target`}
        >
          <Button
            line
            secondary
            icon="clock"
            data-testid={`${testId}-open`}
            disabled={disabled}
            onClick={(e) => {
              e.preventDefault()
              handleToggle()
            }}
            options={{ ariaLabel: t('dateTimePicker.openCalendar') }}
          />
        </div>
      </div>
      </ControlGroup>

      <Tooltip
        targetRef={targetRef as unknown as React.RefObject<HTMLElement | null>}
        show={isOpen}
        content={calendarContent}
        className="ecu-date-time-picker-tooltip"
        placement="below"
        data-testid={`${testId}-popover`}
        onMouseDown={(e) => {
          e.stopPropagation()
        }}
      />
    </div>
  )
}

const DateTimePicker = React.memo(DateTimePickerInner)
export default DateTimePicker
