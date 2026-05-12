# KeyValueTable Component

## Overview

`KeyValueTable` is a themed key/value table built on top of `InputBox`, `Toggle`, `ScrollableElement` and `Button`.
It is designed for editing ordered lists of key/value pairs (with an optional description), with per-row enable/disable and drag & drop reordering.

This component is a generic, reusable key/value editor suitable for environment variables, HTTP headers, query params, and similar use cases.

## Component Location

- Source: `electron-core-ui/src/renderer/components/KeyValueTable/KeyValueTable.tsx`
- Styles: `electron-core-ui/src/renderer/components/KeyValueTable/keyValueTable.css`

## Features

- **Key/value/description rows**:
  - Each row has an `enabled` toggle, a `key`, a `value` and an optional `description`.
- **Variable-aware inputs**:
  - `key` and `value` use `VariableInputBox` with Handlebars-like `{{variable}}` syntax.
  - Autocomplete and hover information are provided by `VariableInputBox`.
- **Context-based resolution**:
  - Rows can see a base context (environment/folder/request variables) plus, optionally, previously defined rows.
  - The component can emit a resolved `VariableContext` when rows change.
- **Row management**:
  - Add new rows programmatically via the `addRow` imperative handle.
  - Enable/disable rows per-line via `Toggle`.
  - Drag & drop reordering with a custom drag ghost and visual drop indicators (before/after).
- **Theming**:
  - Uses theme CSS variables (`--*`) for borders, background and text.
  - Fits naturally into styled layouts and dark/light themes.

## TypeScript Interfaces

```typescript
export interface KeyValueTableRow {
  id?: string | undefined
  key: string
  value: string
  description?: string | undefined
  enabled?: boolean
}

export interface KeyValueTableProps {
  /** Optional test id applied to the table root element. */
  'data-testid'?: string
  /** Initial rows to populate the table */
  initialRows?: KeyValueTableRow[]
  /** Optional callback when rows change (for persisting edits). */
  onRowsChange?: (rows: KeyValueTableRow[]) => void
  /** Custom renderer for key cells. Defaults to InputBox. */
  renderKeyCell?: React.ComponentType<CellRendererProps>
  /** Custom renderer for value cells. Defaults to InputBox. */
  renderValueCell?: React.ComponentType<CellRendererProps>
  /** Custom renderer for description cells. Defaults to InputBox. */
  renderDescriptionCell?: React.ComponentType<CellRendererProps>
  /**
   * Whether the Description column is rendered. Defaults to `true`.
   * Hide it when descriptions aren't meaningful for the use-case
   * (e.g. a short auth-config table where the rows are obvious).
   */
  showDescription?: boolean
  /**
   * Whether to render an extra read-only "Resolved value" column
   * between Value and Description. Useful when the raw value is a
   * template (handlebars, variable expressions) and the caller wants
   * to show its evaluated form side-by-side. Defaults to `false`.
   */
  showResolvedValue?: boolean
  /**
   * Custom renderer for the resolved-value cell. Receives the raw
   * `value` plus a no-op `onChange` — the cell is read-only. When
   * omitted, the raw value is echoed verbatim. Only used when
   * `showResolvedValue` is `true`.
   */
  renderResolvedValueCell?: React.ComponentType<CellRendererProps>
  /**
   * Whether the leading enabled-toggle column is rendered. Defaults
   * to `true`. Set to `false` when every row is unconditionally
   * active and the toggle would be misleading (e.g. an auth route's
   * produced-headers table).
   */
  showEnabledToggle?: boolean
  /**
   * When `true`, the enabled-toggle is auto-managed against the
   * value column: typing into an empty value re-enables the row,
   * clearing a non-empty value disables it. Off by default —
   * consumers that legitimately want a checked-but-empty row
   * (e.g. `?filter=` to reset a server-side default) should leave
   * this off.
   */
  autoToggleEnabledOnEmpty?: boolean
}

export interface KeyValueTableHandle {
  addRow: () => void
}
```

## Behavior Details

- **Change notifications**:
  - When `onRowsChange` is provided, the component notifies the parent when the serialized rows actually change (after the first render).

## Usage Examples

### Basic key/value table

```tsx
import React, { useRef } from 'react'
import { KeyValueTable } from 'electron-core-ui/renderer'
import type {
  KeyValueTableHandle,
  KeyValueTableRow
} from 'electron-core-ui/renderer'

const Example: React.FC = () => {
  const tableRef = useRef<KeyValueTableHandle | null>(null)

  const initialRows: KeyValueTableRow[] = [
    { id: 'row-1', key: 'Authorization', value: 'Bearer token', description: 'Auth header', enabled: true }
  ]

  return (
    <KeyValueTable
      ref={tableRef}
      data-testid="headers-table"
      initialRows={initialRows}
    />
  )
}
```

## Notes for AI Usage

- Prefer **controlled data flow**: keep the source of truth for rows in your app state and use `onRowsChange` to persist or mirror changes elsewhere (e.g. in Redux or a model object).
- When orchestrating multiple `KeyValueTable` instances (headers, query params, path params), centralize the construction of the combined `VariableContext` in a small pure helper so it stays easy to test and to generate from non-interactive inputs.

## Testing

### Stable `data-testid` conventions

If you pass `data-testid` (e.g. `headers-table`), the component exposes stable hooks derived from your row ids:

- Root: `{tableId}`
- Table: `{tableId}-table`
- Row: `{tableId}-row-{rowId}`
- Drag handle: `{tableId}-row-{rowId}-drag`
- Enabled toggle wrapper: `{tableId}-row-{rowId}-enabled`
- Delete button: `{tableId}-row-{rowId}-delete`
- Cell InputBox ids (so you can reuse `InputBox` selectors/steps):
  - key: `{tableId}-row-{rowId}-key`
  - value: `{tableId}-row-{rowId}-value`
  - resolved value (when `showResolvedValue`): `{tableId}-row-{rowId}-resolved-value`
  - description (when `showDescription !== false`): `{tableId}-row-{rowId}-description`

### Selectors (`electron-core-ui/testing`)

- `keyValueTableRootSelector(tableId)`
- `keyValueTableTableSelector(tableId)`
- `keyValueTableRowSelector(tableId, rowId)`
- `keyValueTableRowKeyCellSelector(tableId, rowId)`
- `keyValueTableRowValueCellSelector(tableId, rowId)`
- `keyValueTableRowDescriptionCellSelector(tableId, rowId)`
- `keyValueTableRowEnabledToggleSelector(tableId, rowId)`
- `keyValueTableRowDeleteSelector(tableId, rowId)`
- `keyValueTableRowDragHandleSelector(tableId, rowId)`

### Playwright-BDD steps (`electron-core-ui/testing/playwright-bdd`)

Reusable steps are available via `defineKeyValueTableBddSteps`:

- `Then key value table {string} should be visible`
- `When I set key value table {string} row {string} key to {string}` (wraps `InputBox` fill)
- `When I set key value table {string} row {string} value to {string}`
- `When I set key value table {string} row {string} description to {string}`
- `When I toggle key value table {string} row {string} enabled`
- `When I delete key value table {string} row {string}`
