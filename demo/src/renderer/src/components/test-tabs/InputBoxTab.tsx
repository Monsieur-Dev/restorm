import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InputBox, MessageType } from 'electron-core-ui/renderer'
import type { IInputValidator } from 'electron-core-ui/renderer'

const INITIAL_TEXT = 'Hello {{foo}}'

const InputBoxTab: React.FC = () => {
  const { t } = useTranslation()

  const [valueInput, setValueInput] = useState(INITIAL_TEXT)
  const [lastChange, setLastChange] = useState('')
  const [focusCount, setFocusCount] = useState(0)
  const [blurCount, setBlurCount] = useState(0)
  const [lastValidation, setLastValidation] = useState('')

  const [basicValue, setBasicValue] = useState('')
  const [debouncedValue, setDebouncedValue] = useState('')
  const [multilineValue, setMultilineValue] = useState('Line 1\nLine 2')
  const [passwordValue, setPasswordValue] = useState('')
  const [placeholderFocusValue, setPlaceholderFocusValue] = useState('')

  const basicInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const disabledInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  const emailValidator: IInputValidator = useCallback((value: string) => {
    if (!value) {
      return { content: 'Email is required', type: MessageType.ERROR }
    }
    if (!value.includes('@')) {
      return { content: 'Invalid email format', type: MessageType.ERROR }
    }
    return null
  }, [])

  const passwordValidator: IInputValidator = useCallback((value: string) => {
    if (value.length > 0 && value.length < 8) {
      return { content: 'Password should be at least 8 characters', type: MessageType.WARNING }
    }
    return null
  }, [])

  const usernameValidator: IInputValidator = useCallback((value: string) => {
    if (value.length > 0) {
      return { content: 'Username will be used for login', type: MessageType.INFO }
    }
    return null
  }, [])

  const applyValueTo = useCallback((target: 'basic' | 'disabled'): void => {
    if (target === 'basic') {
      setBasicValue(valueInput)
      setLastChange(valueInput)
      return
    }
    // Disabled input is uncontrolled here, but we still expose the intended action for tests.
    setLastChange(valueInput)
  }, [valueInput])

  const sectionStyle = useMemo<React.CSSProperties>(() => ({
    padding: 20,
    maxWidth: 900,
    display: 'grid',
    gap: 18
  }), [])

  const cardStyle = useMemo<React.CSSProperties>(() => ({
    border: '1px solid var(--panel-border)',
    backgroundColor: 'var(--sideBar-background)',
    padding: 16,
    borderRadius: 4,
    display: 'grid',
    gap: 10
  }), [])

  const metaGridStyle = useMemo<React.CSSProperties>(() => ({
    display: 'grid',
    gridTemplateColumns: '220px 1fr',
    gap: 8,
    alignItems: 'center',
    fontSize: 13
  }), [])

  const metaKeyStyle = useMemo<React.CSSProperties>(() => ({
    color: 'var(--descriptionForeground)'
  }), [])

  return (
    <div style={sectionStyle}>
      <div style={cardStyle}>
        <h3 style={{ margin: 0 }}>{t('inputBox.harness.title')}</h3>

        {/* Shared value input (reused by CodeEditor steps) */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            data-testid="codeeditor-value-input"
            value={valueInput}
            onChange={(e) => { setValueInput(e.target.value) }}
            style={{ minWidth: 320 }}
          />
          <button data-testid="inputbox-apply-value-basic" onClick={() => { applyValueTo('basic') }}>
            {t('inputBox.harness.applyValueBasic')}
          </button>
          <button data-testid="inputbox-apply-value-disabled" onClick={() => { applyValueTo('disabled') }}>
            {t('inputBox.harness.applyValueDisabled')}
          </button>
        </div>

        <div style={metaGridStyle}>
          <div style={metaKeyStyle}>{t('inputBox.harness.ready')}</div>
          <div data-testid="inputbox-ready">true</div>

          <div style={metaKeyStyle}>{t('inputBox.harness.lastChange')}</div>
          <div data-testid="inputbox-last-change">{lastChange}</div>

          <div style={metaKeyStyle}>{t('inputBox.harness.focusCount')}</div>
          <div data-testid="inputbox-focus-count">{String(focusCount)}</div>

          <div style={metaKeyStyle}>{t('inputBox.harness.blurCount')}</div>
          <div data-testid="inputbox-blur-count">{String(blurCount)}</div>

          <div style={metaKeyStyle}>{t('inputBox.harness.lastValidation')}</div>
          <div data-testid="inputbox-last-validation">{lastValidation}</div>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ margin: 0 }}>{t('inputBox.harness.instances')}</h3>

        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <div style={metaKeyStyle}>{t('inputBox.harness.basic')}</div>
            <InputBox
              data-testid="inputbox-basic"
              inputRef={basicInputRef}
              options={{ placeholder: 'Enter text...', ariaLabel: 'Text input', tooltip: 'Basic text input' }}
              value={basicValue}
              onChange={(v) => {
                setBasicValue(v)
                setLastChange(v)
              }}
              onFocus={() => { setFocusCount((c) => c + 1) }}
              onBlur={() => { setBlurCount((c) => c + 1) }}
            />
          </div>

          <div>
            <div style={metaKeyStyle}>{t('inputBox.harness.disabled')}</div>
            <InputBox
              data-testid="inputbox-disabled"
              inputRef={disabledInputRef}
              options={{ placeholder: 'Cannot edit', ariaLabel: 'Disabled input' }}
              value="This input is disabled"
              disabled={true}
            />
          </div>

          <div>
            <div style={metaKeyStyle}>{t('inputBox.harness.placeholderOnFocus')}</div>
            <InputBox
              data-testid="inputbox-placeholder-focus"
              options={{ placeholder: 'Hidden until focus', ariaLabel: 'Placeholder on focus', showPlaceholderOnFocus: true }}
              value={placeholderFocusValue}
              onChange={setPlaceholderFocusValue}
            />
          </div>

          <div>
            <div style={metaKeyStyle}>{t('inputBox.harness.validationError')}</div>
            <InputBox
              data-testid="inputbox-validated-error"
              options={{ placeholder: 'email@example.com', ariaLabel: 'Email', validationOptions: { validation: (v) => {
                const msg = emailValidator(v)
                setLastValidation(msg ? `${msg.type ?? ''}:${msg.content ?? ''}` : '')
                return msg
              } } }}
              value=""
              onChange={(v) => { setLastChange(v) }}
            />
          </div>

          <div>
            <div style={metaKeyStyle}>{t('inputBox.harness.validationWarning')}</div>
            <InputBox
              data-testid="inputbox-validated-warning"
              options={{ placeholder: 'Enter password', ariaLabel: 'Password', validationOptions: { validation: (v) => {
                const msg = passwordValidator(v)
                setLastValidation(msg ? `${msg.type ?? ''}:${msg.content ?? ''}` : '')
                return msg
              } } }}
              value={passwordValue}
              onChange={(v) => {
                setPasswordValue(v)
                setLastChange(v)
              }}
            />
          </div>

          <div>
            <div style={metaKeyStyle}>{t('inputBox.harness.validationInfo')}</div>
            <InputBox
              data-testid="inputbox-validated-info"
              options={{ placeholder: 'Username', ariaLabel: 'Username', validationOptions: { validation: (v) => {
                const msg = usernameValidator(v)
                setLastValidation(msg ? `${msg.type ?? ''}:${msg.content ?? ''}` : '')
                return msg
              } } }}
              value=""
              onChange={(v) => { setLastChange(v) }}
            />
          </div>

          <div>
            <div style={metaKeyStyle}>{t('inputBox.harness.multiline')}</div>
            <InputBox
              data-testid="inputbox-multiline"
              options={{ flexibleHeight: true, placeholder: 'Enter multiple lines...', ariaLabel: 'Multiline', tooltip: 'Flexible height textarea' }}
              value={multilineValue}
              onChange={(v) => {
                setMultilineValue(v)
                setLastChange(v)
              }}
              style={{ minHeight: 120 }}
            />
          </div>

          <div>
            <div style={metaKeyStyle}>{t('inputBox.harness.password')}</div>
            <InputBox
              data-testid="inputbox-password"
              options={{ placeholder: 'Enter password', ariaLabel: 'Password input' }}
              password={true}
              value={passwordValue}
              onChange={(v) => {
                setPasswordValue(v)
                setLastChange(v)
              }}
            />
          </div>

          <div>
            <div style={metaKeyStyle}>{t('inputBox.harness.debounced')}</div>
            <InputBox
              data-testid="inputbox-debounced"
              options={{ placeholder: 'Debounced', ariaLabel: 'Debounced input' }}
              value={debouncedValue}
              changeDebounceMs={200}
              onChange={(v) => {
                setDebouncedValue(v)
                setLastChange(v)
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default InputBoxTab
export {}
