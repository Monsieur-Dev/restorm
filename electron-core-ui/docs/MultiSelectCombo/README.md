# MultiSelectCombo Component

## Overview

`MultiSelectCombo` is a compact multi-select dropdown with checkbox toggles. The trigger renders a comma-separated summary of the selected values; clicking opens a portal-based popup with a checkbox per option.

## API

```typescript
interface MultiSelectComboOption {
  value: string
  label?: string
}

interface MultiSelectComboProps {
  options: MultiSelectComboOption[]
  selected: string[]
  onChange: (selected: string[]) => void
  placeholder?: string
  /** Item count at or above which a sticky filter row appears. Default: 15. */
  filterThreshold?: number
  /** Localised placeholder for the filter input. */
  filterPlaceholder?: string
  /** Localised label for the Select-all action button. */
  selectAllLabel?: string
  /** Localised label for the Deselect-all action button. */
  deselectAllLabel?: string
  /** Optional test id forwarded to the filter row. */
  filterTestId?: string
  'data-testid'?: string
}
```

## Filtering long lists

When the popup contains at least `filterThreshold` items (default **15**, exposed as `DEFAULT_FILTER_THRESHOLD`), a sticky filter row appears at the top of the popup body:

- **Filter input** — auto-focused on open, case-insensitive substring match on the item label. `Esc` clears a non-empty filter; a second `Esc` (with the filter empty) closes the popup.
- **Select all / Deselect all** — these act on the *currently visible* slice, so combined with the filter the user can pick "filter + select all matching" in one stroke.
- **No matches** — when the filter eliminates every row, an italic placeholder is rendered in place of the list.

Per-instance opt-out: pass a `filterThreshold` larger than the item count.

The shared logic lives in `useFilterableDropdown` (see `hooks/useFilterableDropdown.ts`) and the row UI in `components/DropdownFilterRow`.

## Usage

```tsx
import React, { useState } from 'react'
import { MultiSelectCombo } from 'electron-core-ui/renderer'

const options = [
  { value: 'available', label: 'Available' },
  { value: 'pending', label: 'Pending' },
  { value: 'sold', label: 'Sold' }
]

export function StatusPicker(): JSX.Element {
  const [selected, setSelected] = useState<string[]>([])
  return (
    <MultiSelectCombo
      options={options}
      selected={selected}
      onChange={setSelected}
      placeholder="Select statuses…"
    />
  )
}
```
