# CustomDropdown Component

## Overview

`CustomDropdown` is a small, themed dropdown component used in the demo apps.  
It provides keyboard-navigation, full-width styling, and integrates with the theme color variables exposed by the theme service.

## API

### Types

```typescript
interface CustomDropdownOption {
  value: string
  label: React.ReactNode
  /** Plain-text override for the substring filter when `label` is JSX. */
  searchText?: string
}

interface CustomDropdownProps {
  id?: string
  value: string
  options: CustomDropdownOption[]
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  /** Item count at or above which a sticky filter row appears. Default: 15. */
  filterThreshold?: number
  /** Localised placeholder for the filter input. Default: `Filter…`. */
  filterPlaceholder?: string
  /** Optional test id forwarded to the filter row. */
  filterTestId?: string
}
```

### Props

- **id** (`string`, optional): DOM id used for ARIA attributes.
- **value** (`string`, required): Currently selected option value.
- **options** (`CustomDropdownOption[]`, required): List of options (`value` + `label`, plus an optional `searchText` if the `label` is JSX and the substring filter would otherwise have nothing meaningful to match).
- **onChange** (`(value: string) => void`, required): Called when the user selects a new value.
- **disabled** (`boolean`, optional): Disables interaction and focus when `true`.
- **placeholder** (`string`, optional): Text displayed when no option is selected. Defaults to `"Select..."`.
- **filterThreshold** (`number`, optional): Item count at or above which a sticky filter row appears at the top of the popup. Defaults to `15` (the shared `DEFAULT_FILTER_THRESHOLD`). Pass a large value (e.g. `Number.POSITIVE_INFINITY`) to opt out per-instance.
- **filterPlaceholder** (`string`, optional): Localised placeholder for the filter input. Defaults to `"Filter…"`.
- **filterTestId** (`string`, optional): Test id forwarded to the filter row's container. The inner input gets `${filterTestId}-input`.

When the filter is shown, typing narrows the list to options whose `searchText` (or stringified `label`) contain the query, case-insensitive. `Esc` clears a non-empty filter; a second `Esc` (with the filter empty) closes the popup. ArrowUp / ArrowDown / Home / End navigate the visible slice.

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
- Options are rendered using theme variables (`--dropdown-*`, `--list-*`, `--tab-active-text-color`).

## Notes for AI Usage

- Use **controlled state** for `value` + `onChange`; do not store mutable option state inside the component.
- When integrating with i18n, put translations on `label` only; keep `value` stable and non-localized.
- For accessibility, always provide a semantic label via an external `<label htmlFor="id">` element instead of using placeholder text only.

## Testing

### `data-testid` API

`CustomDropdown` does not currently expose `data-testid` hooks.

### Recommended approach

For E2E testing, consider:

- Using ARIA attributes (`role="combobox"`, `aria-expanded`).
- Targeting by the `id` prop (when provided).
- Using text content selectors for options.
