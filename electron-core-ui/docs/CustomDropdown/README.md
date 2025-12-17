# CustomDropdown Component

## Overview

`CustomDropdown` is a small, VSCode-themed dropdown component used in the demo apps.  
It provides keyboard-navigation, full-width styling, and integrates with the VSCode color variables exposed by the theme service.

## API

### Types

```typescript
interface CustomDropdownOption {
  value: string
  label: string
}

interface CustomDropdownProps {
  id?: string
  value: string
  options: CustomDropdownOption[]
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
}
```

### Props

- **id** (`string`, optional): DOM id used for ARIA attributes.
- **value** (`string`, required): Currently selected option value.
- **options** (`CustomDropdownOption[]`, required): List of options (`value` + `label`).
- **onChange** (`(value: string) => void`, required): Called when the user selects a new value.
- **disabled** (`boolean`, optional): Disables interaction and focus when `true`.
- **placeholder** (`string`, optional): Text displayed when no option is selected. Defaults to `"Select..."`.

## Usage

```tsx
import React, { useState } from 'react'
import { CustomDropdown } from 'electron-core-ui/renderer'

const ThemeSelector: React.FC = () => {
  const [value, setValue] = useState('dark')

  const options = [
    { value: 'dark', label: 'Dark Theme' },
    { value: 'light', label: 'Light Theme' }
  ]

  return (
    <CustomDropdown
      id="theme-selector"
      value={value}
      options={options}
      onChange={setValue}
      placeholder="Select theme…"
    />
  )
}
```

## Behavior

- Click toggles the dropdown list.
- Keyboard support:
  - **Enter/Space**: open/confirm selection.
  - **Escape**: close list.
  - **ArrowUp/ArrowDown/Home/End**: move focused option.
- Clicking outside closes the list.
- Options are rendered using VSCode theme variables (`--dropdown-*`, `--list-*`, `--tab-active-text-color`).

## Notes for AI Usage

- Use **controlled state** for `value` + `onChange`; do not store mutable option state inside the component.
- When integrating with i18n, put translations on `label` only; keep `value` stable and non-localized.
- For accessibility, always provide a semantic label via an external `<label htmlFor="id">` element instead of using placeholder text only.
