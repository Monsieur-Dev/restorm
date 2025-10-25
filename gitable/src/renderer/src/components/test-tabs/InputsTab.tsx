import React, { useState } from 'react'
import { InputBox, MessageType } from 'electron-vscodelike-core-ui/renderer'
import type { IInputValidator } from 'electron-vscodelike-core-ui/renderer'

const InputsTab: React.FC = () => {
  // Internal state management
  const [textInput, setTextInput] = useState('Sample text')
  const [numberInput, setNumberInput] = useState('42')
  const [emailInput, setEmailInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [usernameInput, setUsernameInput] = useState('')
  const [textareaValue, setTextareaValue] = useState(`Line 1: Lorem ipsum dolor sit amet
Line 2: Consectetur adipiscing elit
Line 3: Sed do eiusmod tempor incididunt
Line 4: Ut labore et dolore magna aliqua
Line 5: Ut enim ad minim veniam
Line 6: Quis nostrud exercitation ullamco
Line 7: Laboris nisi ut aliquip ex ea
Line 8: Commodo consequat duis aute
Line 9: Irure dolor in reprehenderit
Line 10: In voluptate velit esse cillum
Line 11: Dolore eu fugiat nulla pariatur
Line 12: Excepteur sint occaecat cupidatat
Line 13: Non proident sunt in culpa
Line 14: Qui officia deserunt mollit
Line 15: Anim id est laborum sed ut`)
  // Validators
  const emailValidator: IInputValidator = (value: string) => {
    if (!value) {
      return { content: 'Email is required', type: MessageType.ERROR }
    }
    if (!value.includes('@')) {
      return { content: 'Invalid email format', type: MessageType.ERROR }
    }
    return null
  }

  const passwordValidator: IInputValidator = (value: string) => {
    if (value.length > 0 && value.length < 8) {
      return {
        content: 'Password should be at least 8 characters',
        type: MessageType.WARNING
      }
    }
    return null
  }

  const usernameValidator: IInputValidator = (value: string) => {
    if (value.length > 0) {
      return {
        content: 'Username will be used for login',
        type: MessageType.INFO
      }
    }
    return null
  }

  return (
    <div style={{ display: 'grid', gap: '20px', maxWidth: '600px', padding: '20px' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>Basic Inputs</h3>
        
        <div>
          <label
            htmlFor="text-input"
            style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '13px'
            }}
          >
            Text Input
          </label>
          <div style={{ maxWidth: '400px' }}>
            <InputBox
              id="text-input"
              options={{
                placeholder: 'Enter text...',
                ariaLabel: 'Text input',
                tooltip: 'Basic text input'
              }}
              value={textInput}
              onChange={setTextInput}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="number-input"
            style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '13px'
            }}
          >
            Number Input
          </label>
          <div style={{ maxWidth: '400px' }}>
            <InputBox
              id="number-input"
              options={{
                type: 'number',
                placeholder: 'Enter a number',
                ariaLabel: 'Number input',
                tooltip: 'Input for numeric values'
              }}
              value={numberInput}
              onChange={setNumberInput}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="disabled-input"
            style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '13px',
              color: 'var(--vscode-descriptionForeground)'
            }}
          >
            Disabled Input
          </label>
          <div style={{ maxWidth: '400px' }}>
            <InputBox
              id="disabled-input"
              options={{
                placeholder: 'Cannot edit',
                ariaLabel: 'Disabled input'
              }}
              value="This input is disabled"
              disabled={true}
            />
          </div>
        </div>

        <h3 style={{ fontSize: '16px', marginTop: '20px', marginBottom: '8px' }}>
          Inputs with Validation
        </h3>

        <div>
          <label
            htmlFor="email-input"
            style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '13px'
            }}
          >
            Email Input (Error Validation)
          </label>
          <div style={{ maxWidth: '400px' }}>
            <InputBox
              id="email-input"
              options={{
                placeholder: 'email@example.com',
                ariaLabel: 'Email address',
                tooltip: 'Enter a valid email address',
                validationOptions: {
                  validation: emailValidator
                }
              }}
              value={emailInput}
              onChange={setEmailInput}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="password-input"
            style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '13px'
            }}
          >
            Password Input (Warning Validation)
          </label>
          <div style={{ maxWidth: '400px' }}>
            <InputBox
              id="password-input"
              options={{
                type: 'password',
                placeholder: 'Enter password',
                ariaLabel: 'Password',
                tooltip: 'Password should be at least 8 characters',
                validationOptions: {
                  validation: passwordValidator
                }
              }}
              value={passwordInput}
              onChange={setPasswordInput}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="username-input"
            style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '13px'
            }}
          >
            Username Input (Info Validation)
          </label>
          <div style={{ maxWidth: '400px' }}>
            <InputBox
              id="username-input"
              options={{
                placeholder: 'Username',
                ariaLabel: 'Username',
                tooltip: 'Enter your username',
                validationOptions: {
                  validation: usernameValidator
                }
              }}
              value={usernameInput}
              onChange={setUsernameInput}
            />
          </div>
        </div>

        <h3 style={{ fontSize: '16px', marginTop: '20px', marginBottom: '8px' }}>
          TextArea (Flexible Height)
        </h3>
        
        <div>
          <label
            htmlFor="textarea-input"
            style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '13px'
            }}
          >
            Multi-line Text
          </label>
          <InputBox
            id="textarea-input"
            options={{
              flexibleHeight: true,
              placeholder: 'Enter multiple lines...',
              ariaLabel: 'Multi-line text area',
              tooltip: 'Flexible height textarea'
            }}
            value={textareaValue}
            onChange={setTextareaValue}
            style={{ minHeight: '120px' }}
          />
        </div>
      </div>
  )
}

export default InputsTab
