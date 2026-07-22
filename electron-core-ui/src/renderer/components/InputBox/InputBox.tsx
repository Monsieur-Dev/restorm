import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import './inputBox.css'
import { MessageType, defaultInputBoxStyles } from './types'
import type { IMessage, InputBoxProps } from './types'

const InputBoxInner: React.FC<InputBoxProps> = ({
  options,
  'data-testid': dataTestId,
  value = '',
  onChange,
  changeDebounceMs = 300,
  onBlur,
  onFocus,
  onKeyDown,
  disabled = false,
  readOnly = false,
  className = '',
  id,
  style,
  inputRef: externalInputRef,
  password = false
}) => {
  const [message, setMessage] = useState<IMessage | null>(null)
  const [state, setState] = useState<'idle' | 'focused'>('idle')

  // Local draft so typing stays instant even though `onChange` is debounced:
  // a fully-controlled value would snap the field back to the stale prop on
  // any intervening re-render and drop characters mid-word.
  const [draft, setDraft] = useState(value)
  const [syncedValue, setSyncedValue] = useState(value)
  // Adopt an external value change (parent update, programmatic reset, …)
  // during render — React's prop-derived-state pattern, not an effect.
  if (value !== syncedValue) {
    setSyncedValue(value)
    setDraft(value)
  }

  // Compute placeholder based on state and options (no useEffect needed)
  const currentPlaceholder = useMemo(() => {
    if (options.showPlaceholderOnFocus && state === 'idle') {
      return ''
    }
    return options.placeholder ?? ''
  }, [options.showPlaceholderOnFocus, options.placeholder, state])
  
  const containerRef = useRef<HTMLDivElement>(null)
  const internalInputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const inputRef = externalInputRef ?? internalInputRef
  const mirrorRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastEmittedValueRef = useRef<string>(value)
  // Latest onChange, so the unmount flush below fires the current closure
  // rather than the one captured by the mount-only effect.
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  // An external `value` change supersedes any in-flight debounced edit: the
  // render-phase branch above already adopted it into `draft`, so cancel the
  // pending timer (its captured value is now stale) and re-baseline the emit
  // ref — otherwise a later blur / unmount flush would re-emit the discarded
  // draft and clobber the value the parent just pushed.
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    lastEmittedValueRef.current = value
  }, [value])

  const styles = options.inputBoxStyles ?? defaultInputBoxStyles

  // Flush a pending debounced change on unmount so the last keystrokes aren't
  // dropped on tab close / navigation (the field may unmount before a blur).
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
        onChangeRef.current?.(lastEmittedValueRef.current)
      }
    }
  }, [])

  const stylesForType = useCallback((type: MessageType | undefined): { border: string | undefined; background: string | undefined; foreground: string | undefined } => {
    switch (type) {
      case MessageType.INFO:
        return {
          border: styles.inputValidationInfoBorder,
          background: styles.inputValidationInfoBackground,
          foreground: styles.inputValidationInfoForeground
        }
      case MessageType.WARNING:
        return {
          border: styles.inputValidationWarningBorder,
          background: styles.inputValidationWarningBackground,
          foreground: styles.inputValidationWarningForeground
        }
      default:
        return {
          border: styles.inputValidationErrorBorder,
          background: styles.inputValidationErrorBackground,
          foreground: styles.inputValidationErrorForeground
        }
    }
  }, [styles])

  const classForType = (type: MessageType | undefined): string => {
    switch (type) {
      case MessageType.INFO: return 'info'
      case MessageType.WARNING: return 'warning'
      default: return 'error'
    }
  }

  const dataMessageType = useMemo((): string | undefined => {
    if (!message) return undefined
    if (message.type === MessageType.INFO) return 'info'
    if (message.type === MessageType.WARNING) return 'warning'
    return 'error'
  }, [message])

  const validate = useCallback((val: string): IMessage | null => {
    if (!options.validationOptions?.validation) {
      return null
    }
    return options.validationOptions.validation(val)
  }, [options.validationOptions])

  const emitChange = useCallback((nextValue: string): void => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    lastEmittedValueRef.current = nextValue

    if (changeDebounceMs <= 0) {
      onChange?.(nextValue)
      return
    }

    debounceRef.current = setTimeout(() => {
      onChange?.(lastEmittedValueRef.current)
    }, changeDebounceMs)
  }, [changeDebounceMs, onChange])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    const newValue = e.target.value
    setDraft(newValue)

    // Validate
    const validationMessage = validate(newValue)
    if (validationMessage) {
      setMessage(validationMessage)
      if (inputRef.current) {
        inputRef.current.setAttribute('aria-invalid', 'true')
      }
    } else {
      setMessage(null)
      if (inputRef.current) {
        inputRef.current.removeAttribute('aria-invalid')
      }
    }
    
    emitChange(newValue)
  }

  // Number input: increment/decrement helper
  const isNumberInput = options.type === 'number'
  const stepValue = options.step ?? 1
  const incrementNumber = useCallback((delta: number): void => {
    const current = parseFloat(draft) || 0
    let next = current + delta
    if (options.min !== undefined) next = Math.max(next, options.min)
    if (options.max !== undefined) next = Math.min(next, options.max)
    const str = String(next)
    setDraft(str)
    emitChange(str)
  }, [draft, options.min, options.max, emitChange])

  // Use native event listeners for wheel events
  useEffect(() => {
    const el = inputRef.current
    if (!el) return

    if (el instanceof HTMLTextAreaElement) {
      const handleWheel = (e: WheelEvent): void => {
        e.stopPropagation()
        e.preventDefault()
        const deltaY = e.deltaY
        const scrollTop = el.scrollTop
        const maxScrollTop = el.scrollHeight - el.clientHeight
        if (deltaY > 0 && scrollTop < maxScrollTop) {
          el.scrollTop = Math.min(scrollTop + 30, maxScrollTop)
        } else if (deltaY < 0 && scrollTop > 0) {
          el.scrollTop = Math.max(scrollTop - 30, 0)
        }
      }
      el.addEventListener('wheel', handleWheel, { passive: false })
      return () => { el.removeEventListener('wheel', handleWheel) }
    }

    // Number input: wheel to increment/decrement. Stop propagation so the
    // wheel is fully consumed here — otherwise an ancestor that also reacts to
    // wheel (a scroll container, or a React Flow canvas that zooms on scroll)
    // fires at the same time as the increment.
    if (isNumberInput) {
      const handleWheel = (e: WheelEvent): void => {
        e.preventDefault()
        e.stopPropagation()
        incrementNumber(e.deltaY < 0 ? stepValue : -stepValue)
      }
      el.addEventListener('wheel', handleWheel, { passive: false })
      return () => { el.removeEventListener('wheel', handleWheel) }
    }

    return undefined
  }, [value, inputRef, isNumberInput, incrementNumber, stepValue])

  const handleFocus = (): void => {
    setState('focused')
    if (containerRef.current) {
      containerRef.current.classList.add('synthetic-focus')
    }
    onFocus?.()
  }

  const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    setState('idle')
    if (containerRef.current) {
      containerRef.current.classList.remove('synthetic-focus')
    }
    // Flush a pending debounced change so the value commits before any
    // blur-triggered action (save button, tab switch, …) reads stale state.
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
      onChange?.(lastEmittedValueRef.current)
    }
    onBlur?.(e)
  }

  // Calculate classes for container
  const getContainerClasses = (): string => {
    const classes = ['inputbox']
    
    if (message) {
      classes.push(classForType(message.type))
    } else {
      classes.push('idle')
    }
    
    if (className) {
      classes.push(className)
    }
    
    return classes.join(' ')
  }

  // Calculate styles for container
  const getContainerStyles = (): React.CSSProperties => {
    const containerStyles: React.CSSProperties = {
      backgroundColor: styles.inputBackground,
      color: styles.inputForeground
    }

    if (message) {
      const validationStyles = stylesForType(message.type)
      containerStyles.border = `1px solid ${validationStyles.border ?? 'transparent'}`
    } else {
      containerStyles.border = `1px solid ${styles.inputBorder ?? 'transparent'}`
    }

    return containerStyles
  }

  // Calculate styles for textarea
  const getTextareaStyles = (): React.CSSProperties => {
    const textareaStyles: React.CSSProperties = {
      backgroundColor: styles.inputBackground,
      color: styles.inputForeground,
      border: 'none',
      outline: 'none',
      resize: 'none'
    }

    // Merge with custom styles if provided
    if (style) {
      return { ...textareaStyles, ...style }
    }

    return textareaStyles
  }

  // Calculate styles for input
  const getInputStyles = (): React.CSSProperties => {
    return {
      backgroundColor: 'inherit',
      color: styles.inputForeground
    }
  }

  const inputClasses = ['input', draft ? '' : 'empty'].filter(Boolean).join(' ')

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    if (isNumberInput) {
      // Arrow up/down: increment/decrement
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        incrementNumber(stepValue)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        incrementNumber(-stepValue)
        return
      }
      // When min >= 0, negative values are not allowed: intercept +/- as increment/decrement
      // When min is undefined or < 0, allow normal typing of - for negative numbers
      if (options.min !== undefined && options.min >= 0) {
        if (e.key === '+') {
          e.preventDefault()
          incrementNumber(stepValue)
          return
        }
        if (e.key === '-') {
          e.preventDefault()
          incrementNumber(-stepValue)
          return
        }
      }
    }
    onKeyDown?.(e)
  }, [isNumberInput, incrementNumber, stepValue, onKeyDown, options.min])

  const baseProps = {
    className: inputClasses,
    value: draft,
    onChange: handleChange,
    onFocus: handleFocus,
    onBlur: handleBlur,
    onKeyDown: handleKeyDown,
    disabled,
    readOnly,
    placeholder: currentPlaceholder,
    autoCorrect: 'off' as const,
    autoCapitalize: 'off' as const,
    spellCheck: false,
    style: getInputStyles(),
    onDrop: (e: React.DragEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      // Prevent external drag sources (tabs, rows, etc.) from inserting arbitrary text
      e.preventDefault()
    },
    onDragOver: (e: React.DragEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.preventDefault()
    },
    id,
    'aria-label': options.ariaLabel,
    title: options.tooltip ?? options.placeholder ?? ''
  }

  return (
    <div className={className} style={style}>
      <div
        ref={containerRef}
        className={getContainerClasses()}
        style={getContainerStyles()}
        {...(dataTestId && { 'data-testid': `${dataTestId}-container` })}
      >
        <div className="ibwrapper">
          {options.flexibleHeight ? (
            <>
              <textarea
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                {...baseProps}
                {...(dataTestId && { 'data-testid': `${dataTestId}-input` })}
                rows={1}
                wrap="off"
                style={getTextareaStyles()}
              />
              {
                <div
                  ref={mirrorRef}
                  className="mirror"
                  aria-hidden="true"
                  {...(dataTestId && { 'data-testid': `${dataTestId}-mirror` })}
                >
                  {draft || '\u00a0'}
                </div>
              }
            </>
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              {...baseProps}
              {...(dataTestId && { 'data-testid': `${dataTestId}-input` })}
              type={password ? 'password' : (options.type ?? 'text')}
            />
          )}
        </div>
      </div>
      {message?.content && state === 'focused' && (
        <div
          className="inputbox-container"
          {...(dataTestId && {
            'data-testid': `${dataTestId}-message`,
            'data-message-type': dataMessageType,
            'data-has-message': 'true'
          })}
        >
          <div
            className={`inputbox-message ${classForType(message.type)}`}
            style={{
              backgroundColor: stylesForType(message.type).background,
              color: stylesForType(message.type).foreground,
              border: stylesForType(message.type).border ? `1px solid ${stylesForType(message.type).border}` : ''
            }}
          >
            {message.content}
          </div>
        </div>
      )}
      {dataTestId ? (
        <div
          data-testid={dataTestId}
          data-focused={state === 'focused' ? 'true' : 'false'}
          data-has-message={message?.content ? 'true' : 'false'}
          data-message-type={dataMessageType}
          data-multiline={options.flexibleHeight ? 'true' : 'false'}
          style={{ display: 'none' }}
        />
      ) : null}
    </div>
  )
}

const InputBox = React.memo(InputBoxInner)
export default InputBox
