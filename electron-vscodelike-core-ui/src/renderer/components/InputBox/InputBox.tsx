/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useRef, useEffect, useState, useCallback } from 'react'
import './inputBox.css'

export enum MessageType {
  INFO = 1,
  WARNING = 2,
  ERROR = 3
}

export interface IMessage {
  readonly content?: string
  readonly formatContent?: boolean
  readonly type?: MessageType
}

export interface IInputValidator {
  (value: string): IMessage | null
}

export interface IInputValidationOptions {
  validation?: IInputValidator
}

export interface IInputBoxStyles {
  readonly inputBackground: string | undefined
  readonly inputForeground: string | undefined
  readonly inputBorder: string | undefined
  readonly inputValidationInfoBorder: string | undefined
  readonly inputValidationInfoBackground: string | undefined
  readonly inputValidationInfoForeground: string | undefined
  readonly inputValidationWarningBorder: string | undefined
  readonly inputValidationWarningBackground: string | undefined
  readonly inputValidationWarningForeground: string | undefined
  readonly inputValidationErrorBorder: string | undefined
  readonly inputValidationErrorBackground: string | undefined
  readonly inputValidationErrorForeground: string | undefined
}

export interface IInputOptions {
  readonly placeholder?: string
  readonly showPlaceholderOnFocus?: boolean
  readonly tooltip?: string
  readonly ariaLabel?: string
  readonly type?: string
  readonly validationOptions?: IInputValidationOptions
  readonly flexibleHeight?: boolean
  readonly flexibleWidth?: boolean
  readonly flexibleMaxHeight?: number
  readonly inputBoxStyles?: IInputBoxStyles
}

export interface IRange {
  start: number
  end: number
}

export const defaultInputBoxStyles: IInputBoxStyles = {
  inputBackground: 'var(--vscode-input-background)',
  inputForeground: 'var(--vscode-input-foreground)',
  inputBorder: 'var(--vscode-input-border)',
  inputValidationInfoBorder: 'var(--vscode-inputValidation-infoBorder)',
  inputValidationInfoBackground: 'var(--vscode-inputValidation-infoBackground)',
  inputValidationInfoForeground: 'var(--vscode-inputValidation-infoForeground)',
  inputValidationWarningBorder: 'var(--vscode-inputValidation-warningBorder)',
  inputValidationWarningBackground: 'var(--vscode-inputValidation-warningBackground)',
  inputValidationWarningForeground: 'var(--vscode-inputValidation-warningForeground)',
  inputValidationErrorBorder: 'var(--vscode-inputValidation-errorBorder)',
  inputValidationErrorBackground: 'var(--vscode-inputValidation-errorBackground)',
  inputValidationErrorForeground: 'var(--vscode-inputValidation-errorForeground)'
}

export interface InputBoxProps {
  options: IInputOptions
  value?: string
  onChange?: (value: string) => void
  onBlur?: () => void
  onFocus?: () => void
  disabled?: boolean
  className?: string
  id?: string
}

const InputBox: React.FC<InputBoxProps> = ({
  options,
  value = '',
  onChange,
  onBlur,
  onFocus,
  disabled = false,
  className = '',
  id
}) => {
  const [internalValue, setInternalValue] = useState(value)
  const [message, setMessage] = useState<IMessage | null>(null)
  const [state, setState] = useState<'idle' | 'focused'>('idle')
  const [currentPlaceholder, setCurrentPlaceholder] = useState(options.placeholder || '')
  
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)

  const styles = options.inputBoxStyles || defaultInputBoxStyles

  // Sync internal value with prop
  useEffect(() => {
    setInternalValue(value)
  }, [value])

  // Apply placeholder logic
  useEffect(() => {
    if (options.showPlaceholderOnFocus && state === 'idle') {
      setCurrentPlaceholder('')
    } else {
      setCurrentPlaceholder(options.placeholder || '')
    }
  }, [options.showPlaceholderOnFocus, options.placeholder, state])

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

  const validate = useCallback((val: string): IMessage | null => {
    if (!options.validationOptions?.validation) {
      return null
    }
    return options.validationOptions.validation(val)
  }, [options.validationOptions])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    const newValue = e.target.value
    setInternalValue(newValue)
    
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

    onChange?.(newValue)
  }

  const handleFocus = (): void => {
    setState('focused')
    if (containerRef.current) {
      containerRef.current.classList.add('synthetic-focus')
    }
    onFocus?.()
  }

  const handleBlur = (): void => {
    setState('idle')
    if (containerRef.current) {
      containerRef.current.classList.remove('synthetic-focus')
    }
    onBlur?.()
  }

  // Calculate classes for container
  const getContainerClasses = (): string => {
    const classes = ['monaco-inputbox']
    
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
      containerStyles.border = `1px solid ${validationStyles.border || 'transparent'}`
    } else {
      containerStyles.border = `1px solid ${styles.inputBorder || 'transparent'}`
    }

    return containerStyles
  }

  // Calculate styles for input
  const getInputStyles = (): React.CSSProperties => {
    return {
      backgroundColor: 'inherit',
      color: styles.inputForeground
    }
  }

  const inputClasses = ['input', internalValue ? '' : 'empty'].filter(Boolean).join(' ')

  const baseProps = {
    className: inputClasses,
    value: internalValue,
    onChange: handleChange,
    onFocus: handleFocus,
    onBlur: handleBlur,
    disabled,
    placeholder: currentPlaceholder,
    autoCorrect: 'off' as const,
    autoCapitalize: 'off' as const,
    spellCheck: false,
    style: getInputStyles(),
    id,
    'aria-label': options.ariaLabel,
    title: options.tooltip || options.placeholder || ''
  }

  return (
    <div>
      <div
        ref={containerRef}
        className={getContainerClasses()}
        style={getContainerStyles()}
      >
        <div className="ibwrapper">
          {options.flexibleHeight ? (
            <>
              <textarea
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                {...baseProps}
                rows={1}
                wrap="off"
              />
              {options.flexibleHeight && (
                <div ref={mirrorRef} className="mirror" aria-hidden="true">
                  {internalValue || '\u00a0'}
                </div>
              )}
            </>
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              {...baseProps}
              type={options.type || 'text'}
            />
          )}
        </div>
      </div>
      {message && message.content && state === 'focused' && (
        <div className="monaco-inputbox-container">
          <div
            className={`monaco-inputbox-message ${classForType(message.type)}`}
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
    </div>
  )
}

export default InputBox

