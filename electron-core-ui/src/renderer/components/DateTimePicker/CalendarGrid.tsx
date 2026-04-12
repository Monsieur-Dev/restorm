import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../Button'
import { ScrollableElement } from '../ScrollableElement'

const YEAR_MENU_RANGE = 10
const YEAR_MENU_ROW_HEIGHT_PX = 28
const YEAR_MENU_WINDOW_SIZE = (YEAR_MENU_RANGE * 2) + 1
const YEAR_MENU_SHIFT = 1

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
}

function addYears(date: Date, delta: number): Date {
  return new Date(date.getFullYear() + delta, date.getMonth(), 1)
}

function buildCalendarGrid(viewMonth: Date, firstDayOfWeek: number): Date[] {
  const year = viewMonth.getFullYear()
  const month = viewMonth.getMonth()
  const firstOfMonth = new Date(year, month, 1)
  const offset = (firstOfMonth.getDay() - firstDayOfWeek + 7) % 7
  const gridStart = new Date(year, month, 1 - offset)

  const days: Date[] = []
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    days.push(d)
  }
  return days
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function dayTestIdSuffix(d: Date): string {
  const y = d.getFullYear()
  const m = pad2(d.getMonth() + 1)
  const day = pad2(d.getDate())
  return `${y}-${m}-${day}`
}

export interface CalendarGridProps {
  /** The month being viewed (first day of that month). */
  viewMonth: Date
  /** Callback to change the viewed month. */
  onViewMonthChange: (next: Date | ((prev: Date) => Date)) => void
  /** Currently selected date, or null. */
  value: Date | null
  /** Called when a day cell is clicked. */
  onSelectDay: (day: Date) => void
  /** First day of week (0=Sun, 1=Mon, etc.). */
  firstDayOfWeek: number
  /** Whether interaction is disabled. */
  disabled: boolean
  /** Test-id prefix. */
  testId: string
  /** Refs for the month and year label spans (used by parent for outside-click detection). */
  monthPartRef: React.RefObject<HTMLSpanElement | null>
  yearPartRef: React.RefObject<HTMLSpanElement | null>
  /** Refs for the month and year menus (used by parent for outside-click detection). */
  monthMenuRef: React.RefObject<HTMLDivElement | null>
  yearMenuRef: React.RefObject<HTMLDivElement | null>
  /** Whether each dropdown is open. */
  isMonthMenuOpen: boolean
  isYearMenuOpen: boolean
  /** Callbacks to toggle dropdowns. */
  onMonthMenuOpenChange: (open: boolean) => void
  onYearMenuOpenChange: (open: boolean) => void
}

const CalendarGridInner: React.FC<CalendarGridProps> = ({
  viewMonth,
  onViewMonthChange,
  value,
  onSelectDay,
  firstDayOfWeek,
  disabled,
  testId,
  monthPartRef,
  yearPartRef,
  monthMenuRef,
  yearMenuRef,
  isMonthMenuOpen,
  isYearMenuOpen,
  onMonthMenuOpenChange,
  onYearMenuOpenChange
}) => {
  const { t, i18n } = useTranslation()
  const intlLocale = i18n.resolvedLanguage

  const yearMenuContentRef = useRef<HTMLDivElement | null>(null)
  const yearMenuNeedsInitScrollRef = useRef(false)
  const yearMenuIsAdjustingScrollRef = useRef(false)
  const [yearMenuWindowStart, setYearMenuWindowStart] = useState<number>(() => new Date().getFullYear() - YEAR_MENU_RANGE)

  const viewMonthName = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(intlLocale, { month: 'long' })
    return formatter.format(viewMonth)
  }, [intlLocale, viewMonth])

  const viewYearLabel = useMemo(() => String(viewMonth.getFullYear()), [viewMonth])

  const monthNames = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(intlLocale, { month: 'long' })
    return Array.from({ length: 12 }, (_, i) => {
      const date = new Date(2000, i, 1)
      return formatter.format(date)
    })
  }, [intlLocale])

  const yearOptions = useMemo(() => {
    return Array.from({ length: YEAR_MENU_WINDOW_SIZE }, (_, i) => yearMenuWindowStart + i)
  }, [yearMenuWindowStart])

  const weekdayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(intlLocale, { weekday: 'short' })
    const baseSunday = new Date(2024, 0, 7)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(baseSunday)
      d.setDate(baseSunday.getDate() + firstDayOfWeek + i)
      return formatter.format(d)
    })
  }, [firstDayOfWeek, intlLocale])

  const gridDays = useMemo(() => buildCalendarGrid(viewMonth, firstDayOfWeek), [firstDayOfWeek, viewMonth])
  const today = useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }, [])

  const handleMonthLabelClick = useCallback((): void => {
    if (disabled) return
    onYearMenuOpenChange(false)
    onMonthMenuOpenChange(!isMonthMenuOpen)
  }, [disabled, isMonthMenuOpen, onMonthMenuOpenChange, onYearMenuOpenChange])

  const handleSelectMonth = useCallback((monthIndex: number): void => {
    if (disabled) return
    onViewMonthChange((m) => new Date(m.getFullYear(), monthIndex, 1))
    onMonthMenuOpenChange(false)
  }, [disabled, onMonthMenuOpenChange, onViewMonthChange])

  const handleYearLabelClick = useCallback((): void => {
    if (disabled) return
    onMonthMenuOpenChange(false)
    const next = !isYearMenuOpen
    if (next) {
      const selectedYear = viewMonth.getFullYear()
      setYearMenuWindowStart(selectedYear - YEAR_MENU_RANGE)
      yearMenuNeedsInitScrollRef.current = true
    }
    onYearMenuOpenChange(next)
  }, [disabled, isYearMenuOpen, onMonthMenuOpenChange, onYearMenuOpenChange, viewMonth])

  const handleSelectYear = useCallback((year: number): void => {
    if (disabled) return
    onViewMonthChange((m) => new Date(year, m.getMonth(), 1))
    onYearMenuOpenChange(false)
  }, [disabled, onViewMonthChange, onYearMenuOpenChange])

  useLayoutEffect(() => {
    if (!isYearMenuOpen) return
    if (!yearMenuNeedsInitScrollRef.current) return
    if (!yearMenuContentRef.current) return

    yearMenuNeedsInitScrollRef.current = false
    yearMenuContentRef.current.scrollTop = YEAR_MENU_RANGE * YEAR_MENU_ROW_HEIGHT_PX
  }, [isYearMenuOpen])

  const handleYearMenuScroll = useCallback((scrollTop: number): void => {
    if (!isYearMenuOpen) return
    if (yearMenuIsAdjustingScrollRef.current) return
    const el = yearMenuContentRef.current
    if (!el) return

    const threshold = YEAR_MENU_ROW_HEIGHT_PX * 3
    const remaining = el.scrollHeight - el.clientHeight - scrollTop

    if (scrollTop <= threshold) {
      yearMenuIsAdjustingScrollRef.current = true
      setYearMenuWindowStart((s) => s - YEAR_MENU_SHIFT)
      requestAnimationFrame(() => {
        const nextEl = yearMenuContentRef.current
        if (nextEl) {
          nextEl.scrollTop = nextEl.scrollTop + (YEAR_MENU_SHIFT * YEAR_MENU_ROW_HEIGHT_PX)
        }
        yearMenuIsAdjustingScrollRef.current = false
      })
      return
    }

    if (remaining <= threshold) {
      yearMenuIsAdjustingScrollRef.current = true
      setYearMenuWindowStart((s) => s + YEAR_MENU_SHIFT)
      requestAnimationFrame(() => {
        const nextEl = yearMenuContentRef.current
        if (nextEl) {
          nextEl.scrollTop = Math.max(0, nextEl.scrollTop - (YEAR_MENU_SHIFT * YEAR_MENU_ROW_HEIGHT_PX))
        }
        yearMenuIsAdjustingScrollRef.current = false
      })
    }
  }, [isYearMenuOpen])

  return (
    <>
      <div className="ecu-date-time-picker-header">
        <Button
          small
          secondary
          data-testid={`${testId}-prev-year`}
          onClick={() => {
            onViewMonthChange((m) => addYears(m, -1))
          }}
          options={{ ariaLabel: t('dateTimePicker.previousYear') }}
          icon="chevron-left"
        />
        <Button
          small
          secondary
          icon="chevron-left"
          data-testid={`${testId}-prev-month`}
          onClick={() => {
            onViewMonthChange((m) => addMonths(m, -1))
          }}
          options={{ ariaLabel: t('dateTimePicker.previousMonth') }}
        />
        <div className="ecu-date-time-picker-month-year" data-testid={`${testId}-month-year`}>
          <span
            ref={monthPartRef}
            className="ecu-date-time-picker-month-part"
            data-testid={`${testId}-month-part`}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-label={t('dateTimePicker.selectMonth')}
            aria-disabled={disabled}
            onClick={(e) => {
              e.stopPropagation()
              handleMonthLabelClick()
            }}
            onKeyDown={(e) => {
              if (disabled) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleMonthLabelClick()
              }
            }}
          >
            {viewMonthName}
          </span>
          <span className="ecu-date-time-picker-month-year-sep"> </span>
          <span
            ref={yearPartRef}
            className="ecu-date-time-picker-year-part"
            data-testid={`${testId}-year-part`}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-label={t('dateTimePicker.selectYear')}
            aria-disabled={disabled}
            onClick={(e) => {
              e.stopPropagation()
              handleYearLabelClick()
            }}
            onKeyDown={(e) => {
              if (disabled) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleYearLabelClick()
              }
            }}
          >
            {viewYearLabel}
          </span>

          {isMonthMenuOpen && (
            <div
              ref={monthMenuRef}
              className="ecu-date-time-picker-month-menu"
              data-testid={`${testId}-month-menu`}
              onMouseDown={(e) => {
                e.stopPropagation()
              }}
            >
              <ScrollableElement
                options={{
                  vertical: 'auto',
                  horizontal: 'hidden',
                  useShadows: true,
                  verticalScrollbarSize: 7,
                  handleMouseWheel: true,
                  fitContent: true
                }}
                style={{
                  maxHeight: '300px',
                  minWidth: '150px'
                }}
              >
                {monthNames.map((monthName, index) => {
                  const isSelected = index === viewMonth.getMonth()
                  return (
                    <div
                      key={index}
                      className={`ecu-date-time-picker-month-option ${isSelected ? 'is-selected' : ''}`}
                      data-testid={`${testId}-month-option-${index}`}
                      data-is-selected={isSelected ? 'true' : 'false'}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleSelectMonth(index)
                      }}
                    >
                      {monthName}
                    </div>
                  )
                })}
              </ScrollableElement>
            </div>
          )}

          {isYearMenuOpen && (
            <div
              ref={yearMenuRef}
              className="ecu-date-time-picker-year-menu"
              data-testid={`${testId}-year-menu`}
              onMouseDown={(e) => {
                e.stopPropagation()
              }}
            >
              <ScrollableElement
                options={{
                  vertical: 'auto',
                  horizontal: 'hidden',
                  useShadows: true,
                  verticalScrollbarSize: 7,
                  handleMouseWheel: true,
                  mouseWheelSmoothScroll: false,
                  fitContent: true
                }}
                style={{
                  maxHeight: '300px',
                  minWidth: '150px'
                }}
                contentRef={yearMenuContentRef}
                onScroll={(scrollTop) => {
                  handleYearMenuScroll(scrollTop)
                }}
              >
                {yearOptions.map((year) => {
                  const isSelected = year === viewMonth.getFullYear()
                  return (
                    <div
                      key={year}
                      className={`ecu-date-time-picker-year-option ${isSelected ? 'is-selected' : ''}`}
                      data-testid={`${testId}-year-option-${year}`}
                      data-is-selected={isSelected ? 'true' : 'false'}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleSelectYear(year)
                      }}
                    >
                      {String(year)}
                    </div>
                  )
                })}
              </ScrollableElement>
            </div>
          )}
        </div>
        <Button
          small
          secondary
          icon="chevron-right"
          data-testid={`${testId}-next-month`}
          onClick={() => {
            onViewMonthChange((m) => addMonths(m, 1))
          }}
          options={{ ariaLabel: t('dateTimePicker.nextMonth') }}
        />
        <Button
          small
          secondary
          data-testid={`${testId}-next-year`}
          onClick={() => {
            onViewMonthChange((m) => addYears(m, 1))
          }}
          options={{ ariaLabel: t('dateTimePicker.nextYear') }}
        >
          <span className="codicon codicon-chevron-right" />
          <span className="codicon codicon-chevron-right" style={{ marginLeft: '-4px' }} />
        </Button>
      </div>

      <div className="ecu-date-time-picker-weekdays" data-testid={`${testId}-weekdays`}>
        {weekdayLabels.map((l) => (
          <div key={l} className="ecu-date-time-picker-weekday">
            {l}
          </div>
        ))}
      </div>

      <div className="ecu-date-time-picker-grid" data-testid={`${testId}-grid`}>
        {gridDays.map((d) => {
          const isInMonth = d.getMonth() === viewMonth.getMonth()
          const isSelected = value ? isSameDay(d, value) : false
          const isToday = isSameDay(d, today)
          const suffix = dayTestIdSuffix(d)
          return (
            <button
              key={`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`}
              type="button"
              className={['ecu-date-time-picker-day', !isInMonth && 'is-outside', isToday && 'is-today', isSelected && 'is-selected']
                .filter(Boolean)
                .join(' ')}
              data-testid={`${testId}-day-${suffix}`}
              data-is-in-month={isInMonth ? 'true' : 'false'}
              data-is-selected={isSelected ? 'true' : 'false'}
              onClick={() => {
                onSelectDay(d)
              }}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
    </>
  )
}

export const CalendarGrid = React.memo(CalendarGridInner)
