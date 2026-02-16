import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DateTime } from 'luxon'
import type * as monacoEditor from 'monaco-editor'
import { Button } from '../Button'
import { Tooltip } from '../Tooltip'
import { InputBox } from '../InputBox'
import { VariableInputBox, type VariableDefinition } from '../VariableInputBox'
import { ScrollableElement } from '../ScrollableElement'
import type { DateTimePickerProps } from './types'
import './dateTimePicker.css'

const LUXON_LANGUAGE_ID = 'luxon-format'
const YEAR_MENU_RANGE = 10
const YEAR_MENU_ROW_HEIGHT_PX = 28
const YEAR_MENU_WINDOW_SIZE = (YEAR_MENU_RANGE * 2) + 1
const YEAR_MENU_SHIFT = 1

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function dayTestIdSuffix(d: Date): string {
  const y = d.getFullYear()
  const m = pad2(d.getMonth() + 1)
  const day = pad2(d.getDate())
  return `${y}-${m}-${day}`
}

// List of all Luxon token names (in order from the documentation)
const LUXON_TOKEN_NAMES = [
  'S', 'SSS', 'u', 'uu', 'uuu', 's', 'ss', 'm', 'mm', 'h', 'hh', 'H', 'HH',
  'Z', 'ZZ', 'ZZZ', 'ZZZZ', 'ZZZZZ', 'z', 'a', 'd', 'dd', 'c', 'ccc', 'cccc', 'ccccc',
  'L', 'LL', 'LLL', 'LLLL', 'LLLLL', 'y', 'yy', 'yyyy', 'G', 'GG', 'GGGGG',
  'kk', 'kkkk', 'W', 'WW', 'ii', 'iiii', 'n', 'nn', 'o', 'ooo', 'q', 'qq',
  'D', 'DD', 'DDD', 'DDDD', 't', 'tt', 'ttt', 'tttt', 'T', 'TT', 'TTT', 'TTTT',
  'f', 'ff', 'fff', 'ffff', 'F', 'FF', 'FFF', 'FFFF', 'X', 'x'
]

function getLuxonTokens(t: (key: string) => string): VariableDefinition[] {
  return LUXON_TOKEN_NAMES.map(name => ({
    name,
    value: name,
    description: t(`dateTimePicker.tokens.${name}`)
  }))
}

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

const DateTimePicker: React.FC<DateTimePickerProps> = ({
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
  const { t, i18n } = useTranslation()
  const targetRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const monthPartRef = useRef<HTMLSpanElement | null>(null)
  const yearPartRef = useRef<HTMLSpanElement | null>(null)
  const monthMenuRef = useRef<HTMLDivElement | null>(null)
  const yearMenuRef = useRef<HTMLDivElement | null>(null)
  const [isMonthMenuOpen, setIsMonthMenuOpen] = useState(false)
  const [isYearMenuOpen, setIsYearMenuOpen] = useState(false)
  const yearMenuContentRef = useRef<HTMLDivElement | null>(null)
  const yearMenuNeedsInitScrollRef = useRef(false)
  const yearMenuIsAdjustingScrollRef = useRef(false)
  const [yearMenuWindowStart, setYearMenuWindowStart] = useState<number>(() => new Date().getFullYear() - YEAR_MENU_RANGE)
  
  // Get translated Luxon tokens
  const luxonTokens = useMemo(() => getLuxonTokens(t), [t])

  // Use app language (i18n) for Intl formatting instead of OS locale.
  const intlLocale = i18n.resolvedLanguage

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

  const viewMonthName = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(intlLocale, { month: 'long' })
    return formatter.format(viewMonth)
  }, [intlLocale, viewMonth])

  const viewYearLabel = useMemo(() => String(viewMonth.getFullYear()), [viewMonth])

  // Generate list of month names for the dropdown
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
    // 2024-01-07 is a Sunday
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

  // Close month menu when clicking outside
  useEffect(() => {
    if (!isMonthMenuOpen) return

    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (!target) return

      // Click on the month label should not close.
      if (monthPartRef.current?.contains(target)) return

      // Click inside the month menu should not close.
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

      // Click on the year label should not close.
      if (yearPartRef.current?.contains(target)) return

      // Click inside the year menu should not close.
      if (yearMenuRef.current?.contains(target)) return

      setIsYearMenuOpen(false)
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [isYearMenuOpen])

  const handleMonthLabelClick = useCallback((): void => {
    if (disabled) return
    setIsYearMenuOpen(false)
    setIsMonthMenuOpen((prev) => !prev)
  }, [disabled])

  const handleSelectMonth = useCallback((monthIndex: number): void => {
    if (disabled) return
    setViewMonth((m) => new Date(m.getFullYear(), monthIndex, 1))
    setIsMonthMenuOpen(false)
  }, [disabled])

  const handleYearLabelClick = useCallback((): void => {
    if (disabled) return
    setIsMonthMenuOpen(false)
    setIsYearMenuOpen((prev) => {
      const next = !prev
      if (next) {
        // Initialize the fixed window around the currently selected year.
        const selectedYear = viewMonth.getFullYear()
        setYearMenuWindowStart(selectedYear - YEAR_MENU_RANGE)
        yearMenuNeedsInitScrollRef.current = true
      }
      return next
    })
  }, [disabled, viewMonth])

  const handleSelectYear = useCallback((year: number): void => {
    if (disabled) return
    setViewMonth((m) => new Date(year, m.getMonth(), 1))
    setIsYearMenuOpen(false)
  }, [disabled])

  useLayoutEffect(() => {
    if (!isYearMenuOpen) return
    if (!yearMenuNeedsInitScrollRef.current) return
    if (!yearMenuContentRef.current) return

    yearMenuNeedsInitScrollRef.current = false
    // Keep scroll position centered so we can "shift" the year window on scroll.
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

  const completionProviderDisposableRef = useRef<monacoEditor.IDisposable | null>(null)

  // Custom completion provider for Luxon tokens (inserts tokens directly without {{}})
  const handlePatternInputMount = useCallback(
    (_editor: monacoEditor.editor.IStandaloneCodeEditor, monaco: typeof monacoEditor): void => {
      const hasLanguage = monaco.languages.getLanguages().some((lang) => lang.id === LUXON_LANGUAGE_ID)
      if (!hasLanguage) {
        monaco.languages.register({ id: LUXON_LANGUAGE_ID })
      }

      // Dispose previous provider if it exists
      if (completionProviderDisposableRef.current) {
        completionProviderDisposableRef.current.dispose()
      }

      // Register completion provider that inserts tokens directly (without {{}})
      // This provider MUST return incomplete: false to prevent other providers
      completionProviderDisposableRef.current = monaco.languages.registerCompletionItemProvider(LUXON_LANGUAGE_ID, {
        triggerCharacters: ['y', 'M', 'd', 'c', 'H', 'h', 'm', 's', 'S', 'a', 'Z', 'z', 'L', 'G', 'k', 'W', 'i', 'n', 'o', 'q', 'D', 't', 'T', 'f', 'F', 'X', 'x', 'u'],
        provideCompletionItems(model: monacoEditor.editor.ITextModel, position: monacoEditor.Position, _context: monacoEditor.languages.CompletionContext) {
          const word = model.getWordAtPosition(position)

          // Always return Luxon tokens, regardless of context
          // This prevents Handlebars functions from appearing
          const suggestions: monacoEditor.languages.CompletionItem[] = []
          
          if (word && word.word.length > 0) {
            // User is typing - filter tokens
            const wordLower = word.word.toLowerCase()
            for (const token of luxonTokens) {
              if (token.name.toLowerCase().startsWith(wordLower) || wordLower.startsWith(token.name.toLowerCase())) {
                const item: monacoEditor.languages.CompletionItem = {
                  label: token.name,
                  kind: monaco.languages.CompletionItemKind.Value,
                  insertText: token.name,
                  detail: token.description ?? 'Luxon token', // detail appears in right column
                  range: {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endColumn: word.endColumn
                  }
                }
                if (token.description) {
                  item.documentation = token.description
                }
                suggestions.push(item)
              }
            }
          } else {
            // No word selected (Ctrl+Space) - show all tokens
            const range = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: position.column,
              endColumn: position.column
            }
            for (const token of luxonTokens) {
              const item: monacoEditor.languages.CompletionItem = {
                label: token.name,
                kind: monaco.languages.CompletionItemKind.Value,
                insertText: token.name,
                detail: token.description ?? 'Luxon token', // detail appears in right column
                range
              }
              if (token.description) {
                item.documentation = token.description
              }
              suggestions.push(item)
            }
          }

          // Return incomplete: false to prevent other providers (like Handlebars functions) from running
          return { suggestions, incomplete: false }
        }
      })
    },
    [luxonTokens]
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (completionProviderDisposableRef.current) {
        completionProviderDisposableRef.current.dispose()
        completionProviderDisposableRef.current = null
      }
    }
  }, [])

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

        // Close month/year dropdowns when clicking elsewhere inside the picker popover.
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
      <div className="ecu-date-time-picker-header">
        <Button
          small
          secondary
          data-testid={`${testId}-prev-year`}
          onClick={() => {
            setViewMonth((m) => addYears(m, -1))
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
            setViewMonth((m) => addMonths(m, -1))
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
            setViewMonth((m) => addMonths(m, 1))
          }}
          options={{ ariaLabel: t('dateTimePicker.nextMonth') }}
        />
        <Button
          small
          secondary
          data-testid={`${testId}-next-year`}
          onClick={() => {
            setViewMonth((m) => addYears(m, 1))
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
                handleSelectDay(d)
              }}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>

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
          <div className="ecu-date-time-picker-time">
            <input
              className="ecu-date-time-picker-time-input"
              data-testid={`${testId}-hours`}
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
              data-testid={`${testId}-minutes`}
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

        <div className="ecu-date-time-picker-output" data-testid={`${testId}-output`}>
          <label className="ecu-date-time-picker-output-label">{t('dateTimePicker.output')}</label>
          <select
            className="ecu-date-time-picker-select"
            data-testid={`${testId}-output-mode`}
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
          <div className="ecu-date-time-picker-pattern" data-testid={`${testId}-pattern-section`}>
            <div className="ecu-date-time-picker-pattern-wrapper">
              <VariableInputBox
                data-testid={`${testId}-pattern`}
                value={effectivePattern}
                onChange={handleSetPattern}
                variables={[]}
                placeholder="yyyy-MM-dd HH:mm:ss"
                ariaLabel={t('dateTimePicker.pattern')}
                style={{ width: '100%', opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}
                onMount={handlePatternInputMount}
                languageId={LUXON_LANGUAGE_ID}
                disableDefaultProviders
              />
            </div>
            <div className="ecu-date-time-picker-preview">
              <div className="ecu-date-time-picker-preview-label">{t('dateTimePicker.preview')}</div>
              <div className="ecu-date-time-picker-preview-value" data-testid={`${testId}-preview-value`}>{previewValue}</div>
            </div>
          </div>
        ) : null}
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

export default DateTimePicker
