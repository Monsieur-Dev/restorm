import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DateTime } from 'luxon'
import type * as monacoEditor from 'monaco-editor'
import { Button } from '../Button'
import { Tooltip } from '../Tooltip'
import { InputBox } from '../InputBox'
import { VariableInputBox, type VariableDefinition } from '../VariableInputBox'
import type { DateTimePickerProps } from './types'
import './dateTimePicker.css'

const LUXON_LANGUAGE_ID = 'luxon-format'

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
  
  // Get translated Luxon tokens
  const luxonTokens = useMemo(() => getLuxonTokens(t), [t])

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
            <div className="ecu-date-time-picker-pattern-wrapper">
              <VariableInputBox
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
              <div className="ecu-date-time-picker-preview-value">{previewValue}</div>
            </div>
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
