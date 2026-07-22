# InputBox Component

## Overview

`InputBox` is a React implementation of the input box. It provides a themed single-line or multi-line text/number input with validation, placeholder handling, and accessibility options.

It is used internally by several higher-level components (such as `VariableInputBox`) and can be used directly in your own forms and toolbars.

## Component Location

- Source: `electron-core-ui/src/renderer/components/InputBox/InputBox.tsx`
- Types: `electron-core-ui/src/renderer/components/InputBox/types.ts`
- Styles: `electron-core-ui/src/renderer/components/InputBox/inputBox.css`

## Main Types

```typescript
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

export interface InputBoxProps {
  options: IInputOptions
  'data-testid'?: string
  value?: string
  onChange?: (value: string) => void
  /** Debounce (ms) before emitting onChange. Default 300; 0 opts out. */
  changeDebounceMs?: number
  onBlur?: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  onFocus?: () => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  disabled?: boolean
  /** Non-editable but readable, focusable and selectable. Default false. */
  readOnly?: boolean
  className?: string
  id?: string
  style?: React.CSSProperties
  inputRef?: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>
  password?: boolean
}
```

### Read-only value

`readOnly` shows a value the user may read, focus and copy but not change.
Prefer it over `disabled` for that case: `disabled` also greys the field out
and drops it from the tab order, which reads as "unavailable" rather than
"not yours to edit".

```tsx
<InputBox value={name} readOnly options={{ ariaLabel: 'Name' }} />
```

Validation-related types (`IInputBoxStyles`, `IMessage`, `MessageType`, `IInputValidator`) are exported from `electron-core-ui/renderer` and documented in the source.

## Usage Examples

### Basic text input

```tsx
import React, { useState } from 'react'
import { InputBox } from 'electron-core-ui/renderer'

const BasicInput: React.FC = () => {
  const [value, setValue] = useState('')

  return (
    <InputBox
      options={{
        placeholder: 'Enter text…',
        ariaLabel: 'Text input'
      }}
      value={value}
      onChange={setValue}
    />
  )
}
```

### Number input with validation

```tsx
import React, { useState } from 'react'
import { InputBox, MessageType } from 'electron-core-ui/renderer'
import type { IInputValidator } from 'electron-core-ui/renderer'

const positiveIntegerValidator: IInputValidator = (v) => {
  if (!v) return { content: 'Value is required', type: MessageType.ERROR }
  if (!/^\\d+$/.test(v)) return { content: 'Only integers are allowed', type: MessageType.ERROR }
  return null
}

const ValidatedNumber: React.FC = () => {
  const [value, setValue] = useState('')

  return (
    <InputBox
      options={{
        type: 'number',
        ariaLabel: 'Positive integer',
        validationOptions: { validation: positiveIntegerValidator }
      }}
      value={value}
      onChange={setValue}
    />
  )
}
```

## Notes for AI Usage

- Treat `InputBox` as a **controlled component**: always pass `value` and `onChange` from your own state instead of using it uncontrolled; this makes generated code easier to reason about and to test.
- `onChange` is **debounced by default (300 ms)**. The field keeps its own draft so typing is always instant; only the parent callback (your persistence / side effect) is delayed, and a pending change is flushed on blur and on unmount. Do **not** add your own debounce around `onChange` — pass `changeDebounceMs={0}` only when you genuinely need every keystroke (e.g. an address bar that commits on Enter, or a live filter).
- Keep validation logic in small, pure `IInputValidator` functions; avoid inlining complex conditions in JSX so that agents can reuse, replace or test them independently.
- Use `ariaLabel` and `id` consistently so that form fields can be referenced by name in higher-level reasoning (e.g. "set the project name input to…" maps to a specific `InputBox`).
- Prefer simple `type` values (`'text'`, `'number'`) and avoid mixing multiple concerns (e.g. format + validation + parsing) inside a single `onChange` handler; instead, chain small helpers.

## Testing

### Recommended stable hooks

If you pass `data-testid`:

- Root metadata node: `[data-testid="{id}"]` (hidden, used for stable state attributes)
- Container: `[data-testid="{id}-container"]`
- Input element (input/textarea): `[data-testid="{id}-input"]`
- Message container (when visible): `[data-testid="{id}-message"]` with `data-message-type`
- Mirror (multiline): `[data-testid="{id}-mirror"]`

### E2E helpers

`electron-core-ui/testing` exports selector helpers:

- `inputBoxRootSelector(testId)`
- `inputBoxContainerSelector(testId)`
- `inputBoxInputSelector(testId)`
- `inputBoxMessageSelector(testId)`
- `inputBoxMirrorSelector(testId)`

### Playwright-BDD steps

`electron-core-ui/testing/playwright-bdd` exports `defineInputBoxBddSteps(bdd)`.
It registers generic steps such as:

- `When I set input box {string} value to {string}`
- `Then input box {string} value should be {string}`
- `Then input box {string} message should be {string}`
