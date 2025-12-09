# InputBox Component

## Overview

The `InputBox` component is a React implementation of VSCode's input box component. It provides a customizable text/number input or textarea with validation support, theming capabilities, and various configuration options.

## Component Location

- Source: `electron-core-ui/src/renderer/components/InputBox.tsx`
- Styles: `electron-core-ui/src/renderer/components/inputBox.css`

## Features

- Text and number input support
- Flexible height (textarea) support
- Built-in validation with info/warning/error messages
- VSCode theme integration via CSS variables
- Placeholder management (static or show-on-focus)
- Tooltip and aria-label support
- Disabled state support
- Auto validation on change

## TypeScript Interfaces

### IInputOptions

Configuration options for the InputBox component.

```typescript
interface IInputOptions {
  readonly placeholder?: string              // Placeholder text
  readonly showPlaceholderOnFocus?: boolean  // Show placeholder only when focused
  readonly tooltip?: string                  // Tooltip text
  readonly ariaLabel?: string                // Accessibility label
  readonly type?: string                     // Input type (text, number, etc.)
  readonly validationOptions?: IInputValidationOptions  // Validation configuration
  readonly flexibleHeight?: boolean          // Use textarea instead of input
  readonly flexibleWidth?: boolean           // Allow flexible width
  readonly flexibleMaxHeight?: number        // Max height for textarea
  readonly inputBoxStyles?: IInputBoxStyles  // Custom color styles
}
```

### IInputBoxStyles

Color styling configuration using CSS variables or direct color values.

```typescript
interface IInputBoxStyles {
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
```

### IMessage

Validation message structure.

```typescript
interface IMessage {
  readonly content?: string        // Message content
  readonly formatContent?: boolean // Whether to format the content (default: false)
  readonly type?: MessageType      // Message type (INFO, WARNING, ERROR)
}
```

### MessageType

```typescript
enum MessageType {
  INFO = 1,
  WARNING = 2,
  ERROR = 3
}
```

### IInputValidator

```typescript
type IInputValidator = (value: string) => IMessage | null
```

### InputBoxProps

React component props.

```typescript
interface InputBoxProps {
  options: IInputOptions     // Configuration options
  value?: string            // Controlled value
  onChange?: (value: string) => void  // Change handler
  onBlur?: () => void       // Blur handler
  onFocus?: () => void      // Focus handler
  disabled?: boolean        // Disabled state
  className?: string        // Additional CSS classes
  id?: string              // HTML id attribute
}
```

## Default Styles

The component comes with default styles using VSCode CSS variables:

```typescript
const defaultInputBoxStyles: IInputBoxStyles = {
  inputBackground: 'var(--ecui-input-background)',
  inputForeground: 'var(--ecui-input-foreground)',
  inputBorder: 'var(--ecui-input-border)',
  inputValidationInfoBorder: 'var(--ecui-inputValidation-infoBorder)',
  inputValidationInfoBackground: 'var(--ecui-inputValidation-infoBackground)',
  inputValidationInfoForeground: 'var(--ecui-inputValidation-infoForeground)',
  inputValidationWarningBorder: 'var(--ecui-inputValidation-warningBorder)',
  inputValidationWarningBackground: 'var(--ecui-inputValidation-warningBackground)',
  inputValidationWarningForeground: 'var(--ecui-inputValidation-warningForeground)',
  inputValidationErrorBorder: 'var(--ecui-inputValidation-errorBorder)',
  inputValidationErrorBackground: 'var(--ecui-inputValidation-errorBackground)',
  inputValidationErrorForeground: 'var(--ecui-inputValidation-errorForeground)'
}
```

## Usage Examples

### Basic Text Input

```tsx
import { InputBox } from 'electron-core-ui/renderer'

const [value, setValue] = useState('')

<InputBox
  options={{
    placeholder: 'Enter text...',
    ariaLabel: 'Text input'
  }}
  value={value}
  onChange={setValue}
/>
```

### Number Input

```tsx
const [number, setNumber] = useState('42')

<InputBox
  options={{
    type: 'number',
    placeholder: 'Enter a number',
    ariaLabel: 'Number input'
  }}
  value={number}
  onChange={setNumber}
/>
```

### Input with Validation (Error)

```tsx
import { InputBox, MessageType } from 'electron-core-ui/renderer'
import type { IInputValidator } from 'electron-core-ui/renderer'

const emailValidator: IInputValidator = (value: string) => {
  if (!value) {
    return { content: 'Email is required', type: MessageType.ERROR }
  }
  if (!value.includes('@')) {
    return { content: 'Invalid email format', type: MessageType.ERROR }
  }
  return null
}

<InputBox
  options={{
    placeholder: 'email@example.com',
    ariaLabel: 'Email address',
    validationOptions: {
      validation: emailValidator
    }
  }}
  value={email}
  onChange={setEmail}
/>
```

### Input with Warning

```tsx
const passwordValidator: IInputValidator = (value: string) => {
  if (value.length > 0 && value.length < 8) {
    return {
      content: 'Password should be at least 8 characters',
      type: MessageType.WARNING
    }
  }
  return null
}

<InputBox
  options={{
    type: 'password',
    placeholder: 'Enter password',
    validationOptions: {
      validation: passwordValidator
    }
  }}
  value={password}
  onChange={setPassword}
/>
```

### Input with Info Message

```tsx
const usernameValidator: IInputValidator = (value: string) => {
  if (value.length > 0) {
    return {
      content: 'Username will be used for login',
      type: MessageType.INFO
    }
  }
  return null
}

<InputBox
  options={{
    placeholder: 'Username',
    validationOptions: {
      validation: usernameValidator
    }
  }}
  value={username}
  onChange={setUsername}
/>
```

### Textarea (Flexible Height)

```tsx
<InputBox
  options={{
    flexibleHeight: true,
    placeholder: 'Enter multiple lines...',
    ariaLabel: 'Multi-line text area'
  }}
  value={text}
  onChange={setText}
/>
```

### Disabled Input

```tsx
<InputBox
  options={{
    placeholder: 'Disabled input'
  }}
  value="Cannot edit"
  disabled={true}
/>
```

### Input with Tooltip

```tsx
<InputBox
  options={{
    placeholder: 'Hover for info',
    tooltip: 'This is a helpful tooltip',
    ariaLabel: 'Input with tooltip'
  }}
  value={value}
  onChange={setValue}
/>
```

### Show Placeholder Only on Focus

```tsx
<InputBox
  options={{
    placeholder: 'Appears when focused',
    showPlaceholderOnFocus: true,
    ariaLabel: 'Focus-sensitive placeholder'
  }}
  value={value}
  onChange={setValue}
/>
```

## Number Input Styling

Number inputs have the spinners (up/down arrows) hidden for a cleaner appearance, matching VSCode's design. Users can still increment/decrement values using keyboard arrow keys.

## CSS Classes

The component uses the following CSS classes from VSCode:

- `.monaco-inputbox` - Main container
- `.monaco-inputbox.idle` - Idle state
- `.monaco-inputbox.info` - Info validation state
- `.monaco-inputbox.warning` - Warning validation state
- `.monaco-inputbox.error` - Error validation state
- `.monaco-inputbox.synthetic-focus` - Focus state
- `.ibwrapper` - Input wrapper
- `.input` - Input/textarea element
- `.input.empty` - Empty input state
- `.mirror` - Mirror element for flexible height calculation
- `.monaco-inputbox-container` - Validation message container
- `.monaco-inputbox-message` - Validation message element

## VSCode Theme Variables

The component automatically integrates with VSCode themes using these CSS variables:

### Input Colors
- `--ecui-input-background` - Input background color
- `--ecui-input-foreground` - Input text color
- `--ecui-input-border` - Input border color

### Validation Info Colors
- `--ecui-inputValidation-infoBorder` - Info border color
- `--ecui-inputValidation-infoBackground` - Info background color
- `--ecui-inputValidation-infoForeground` - Info text color

### Validation Warning Colors
- `--ecui-inputValidation-warningBorder` - Warning border color
- `--ecui-inputValidation-warningBackground` - Warning background color
- `--ecui-inputValidation-warningForeground` - Warning text color

### Validation Error Colors
- `--ecui-inputValidation-errorBorder` - Error border color
- `--ecui-inputValidation-errorBackground` - Error background color
- `--ecui-inputValidation-errorForeground` - Error text color

## DOM Structure

The component renders the following HTML structure:

```html
<div>
  <div class="monaco-inputbox idle" style="...">
    <div class="ibwrapper">
      <input class="input" ... />
      <!-- OR for flexibleHeight: -->
      <textarea class="input" ...></textarea>
      <div class="mirror" aria-hidden="true">...</div>
    </div>
  </div>
  <!-- Validation message (when focused and has message) -->
  <div class="monaco-inputbox-container">
    <div class="monaco-inputbox-message info|warning|error" style="...">
      Message content
    </div>
  </div>
</div>
```

## AI Assistant Usage Notes

When using this component:
1. Always provide `options` prop with at least the basic configuration
2. Use controlled component pattern with `value` and `onChange`
3. Validation is automatic when `validationOptions` is provided
4. Validation messages appear only when the input is focused
5. Use `MessageType` enum for validation message types
6. The component automatically applies VSCode theme colors
7. For textarea behavior, set `flexibleHeight: true` in options
8. The component handles empty/non-empty state automatically via CSS classes

## Implementation Notes

- Based on VSCode's InputBox implementation (`vscode/src/vs/base/browser/ui/inputbox`)
- CSS classes preserved from original VSCode implementation
- React-based with hooks for state management
- Automatic validation on value change
- Theme integration via CSS variables
- Accessibility support with ARIA attributes

