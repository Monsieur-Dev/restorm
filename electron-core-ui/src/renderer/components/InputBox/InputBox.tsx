import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import './inputBox.css'
import { MessageType, defaultInputBoxStyles } from './types'
import type { IMessage, InputBoxProps } from './types'

const InputBoxInner: React.FC<InputBoxProps> = ({
  options,
  'data-testid': dataTestId,
  value = '',
  onChange,
  changeDebounceMs = 0,
  onBlur,
  onFocus,
  onKeyDown,
  disabled = false,
  className = '',
  id,
  style,
  inputRef: externalInputRef,
  password = false
}) => {
  const [message, setMessage] = useState<IMessage | null>(null)
  const [state, setState] = useState<'idle' | 'focused'>('idle')
  
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

  const styles = options.inputBoxStyles ?? defaultInputBoxStyles

  // Clear pending debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
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

  // Use native event listeners for wheel events
  useEffect(() => {
    const textarea = inputRef.current
    if (!(textarea instanceof HTMLTextAreaElement)) return

    const handleWheel = (e: WheelEvent): void => {
      e.stopPropagation()
      e.preventDefault()
      
      // Manually handle the scroll
      const deltaY = e.deltaY
      const scrollTop = textarea.scrollTop
      const maxScrollTop = textarea.scrollHeight - textarea.clientHeight
      
      if (deltaY > 0 && scrollTop < maxScrollTop) {
        // Scroll down
        textarea.scrollTop = Math.min(scrollTop + 30, maxScrollTop)
      } else if (deltaY < 0 && scrollTop > 0) {
        // Scroll up
        textarea.scrollTop = Math.max(scrollTop - 30, 0)
      }
    }

    textarea.addEventListener('wheel', handleWheel, { passive: false })
    
    return () => {
      textarea.removeEventListener('wheel', handleWheel)
    }
  }, [value, inputRef]) // Re-attach when content changes

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

  const inputClasses = ['input', value ? '' : 'empty'].filter(Boolean).join(' ')

  const baseProps = {
    className: inputClasses,
    value: value,
    onChange: handleChange,
    onFocus: handleFocus,
    onBlur: handleBlur,
    onKeyDown,
    disabled,
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
                  {value || '\u00a0'}
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
