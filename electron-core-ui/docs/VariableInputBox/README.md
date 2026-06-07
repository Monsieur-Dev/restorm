# VariableInputBox Component

## Overview

The `VariableInputBox` component is a single-line Monaco-based input designed for user-facing strings that can contain variables, similar to Postman's `{{variable}}` syntax.
It reuses the visual look & feel of the standard `InputBox` while providing Handlebars-style highlighting, autocompletion, and hover tooltips for variables.

## Component Location

- Source: `electron-core-ui/src/renderer/components/VariableInputBox/VariableInputBox.tsx`
- Types: `electron-core-ui/src/renderer/components/VariableInputBox/types.ts`
- Styles: 
  - `electron-core-ui/src/renderer/components/InputBox/inputBox.css` (shared container styles)
  - `electron-core-ui/src/renderer/components/VariableInputBox/variableInputBox.css` (Monaco background override)

## Features

- Single-line Monaco editor wrapped in an `InputBox`-like container
- Variable highlighting for `{{variableName}}` using a Handlebars-style tokenizer
- Autocompletion of variables:
  - Triggered by `Ctrl+Space`
  - Triggered by typing `{`
  - Inserts `{{variableName}}` — or `{{'variable name'}}` when the name contains
    whitespace, since a bare `{{a b}}` parses as a Handlebars helper call and
    never resolves the value (the hover lookup understands both forms)
- Hover tooltip displaying the variable value (and optional description)
- Theme integration:
  - Uses `document.documentElement.dataset.theme` (`data-theme` attribute) to detect dark/light/hc
  - Applies a derived Monaco theme (`vs-dark` or `vs`) with transparent background
  - Reacts to theme changes via a `MutationObserver`
- Layout and sizing compatible with buttons and dropdowns in the same toolbar row

## TypeScript Interfaces

### VariableDefinition

Represents a variable that can be inserted into the input.

```typescript
export interface VariableDefinition {
  name: string          // Variable name, used between {{ }}
  value: string         // Variable value, shown in tooltip and completion detail
  description?: string  // Optional description, shown in completion documentation
}
```

### VariableInputBoxProps

React props for the `VariableInputBox` component.

```typescript
export interface VariableInputBoxProps {
  value: string                          // Controlled value
  onChange: (value: string) => void      // Change handler
  variables: VariableDefinition[]        // List of available variables
  'data-testid'?: string                 // Optional test id applied to the root element
  placeholder?: string                   // Placeholder text
  id?: string                            // HTML id attribute
  className?: string                     // Additional CSS classes for the outer input box
  style?: React.CSSProperties            // Inline styles for the outer input box
  ariaLabel?: string                     // Accessibility label
}
```

## Behavior Details

- **Single-line enforcement**:
  - `Enter` key is intercepted to prevent new lines.
  - Editor height is fixed; the container's `minHeight` matches button/combobox height.
- **Autocomplete behavior**:
  - `quickSuggestions` are disabled to avoid suggestions on every keystroke.
  - `suggestOnTriggerCharacters` is enabled, with `triggerCharacters: ['{']`.
  - `Ctrl+Space` always shows the full list of variables, regardless of the preceding text.
- **Theming**:
  - Uses `data-theme` (`dark`, `light`, `hc`, `hcLight`) to select `vs-dark` or `vs`.
  - A `MutationObserver` re-applies the Monaco theme whenever `data-theme` changes.
  - The Monaco editor background is transparent so the `InputBox` background (`--input-background`) remains visible.

## Usage Examples

### Basic Variable Input

```tsx
import { VariableInputBox } from 'electron-core-ui/renderer'
import type { VariableDefinition } from 'electron-core-ui/renderer'

const [url, setUrl] = useState('')

const urlVariables: VariableDefinition[] = [
  { name: 'baseUrl', value: 'https://api.example.com', description: 'Base API URL' },
  { name: 'userId', value: '123456', description: 'Current user identifier' }
]

<VariableInputBox
  data-testid="request-url"
  value={url}
  onChange={setUrl}
  variables={urlVariables}
  placeholder="Enter URL (you can use {{baseUrl}} and {{userId}})"
/>
```

### With Custom Styling and Accessibility

```tsx
<VariableInputBox
  data-testid="request-url"
  id="request-url-input"
  className="request-url-input"
  style={{ maxWidth: 800 }}
  value={url}
  onChange={setUrl}
  variables={urlVariables}
  placeholder="https://{{baseUrl}}/users/{{userId}}"
  ariaLabel="Request URL"
/>
```

## Testing

### Stable `data-testid` conventions

If you pass `data-testid`, the component exposes stable hooks:

- Root: `{id}`
- Editor wrapper: `{id}-editor`
- Internal `CodeEditor` root: `{id}-codeeditor`
- Internal Monaco textarea: `{id}-codeeditor-textarea` (see `CodeEditor` testing docs)
- Context menu root: `{id}-contextmenu`

It also exposes stable attributes on the root:

- `data-language-id="..."`
- `data-disable-default-providers="true|false"`

### Selectors (`electron-core-ui/testing`)

- `variableInputBoxRootSelector(testId)`
- `variableInputBoxEditorSelector(testId)`
- `variableInputBoxCodeEditorSelector(testId)`
- `variableInputBoxTextareaSelector(testId)` (delegates to `CodeEditor` textarea selector)
- `variableInputBoxContextMenuSelector(testId)`

### Playwright-BDD steps (`electron-core-ui/testing/playwright-bdd`)

Reusable steps are available via `defineVariableInputBoxBddSteps`:

- `Then variable input box {string} should be visible`
- `When I focus variable input box {string}`
- `When I type in variable input box {string} {string}` (types character-by-character)
- `When I press {string} in variable input box {string}`
- `When I right click variable input box {string}`
