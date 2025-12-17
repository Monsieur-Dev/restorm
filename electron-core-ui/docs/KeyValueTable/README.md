# KeyValueTable Component

## Overview

`KeyValueTable` is a VSCode-themed, variable-aware key/value table built on top of `VariableInputBox`, `InputBox`, `Toggle` and `ScrollableElement`.
It is designed for editing ordered lists of key/value pairs (with an optional description), with support for Handlebars-style `{{variables}}`, per-row enable/disable, and drag & drop reordering.

This component is a generic, reusable version of the environment/headers/params editor used in the `restorm` project.

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
  - Uses VSCode CSS variables (`--*`) for borders, background and text.
  - Fits naturally into VSCode-like layouts and dark/light themes.

## TypeScript Interfaces

```typescript
export interface KeyValueTableRow {
  key: string
  value: string
  description?: string | undefined
}

export type VariableContext = Record<string, string>

export interface KeyValueTableProps {
  /** Base variables visible to all rows (environment, folder, etc.) */
  variables: VariableDefinition[]
  /** Initial rows to populate the table */
  initialRows?: KeyValueTableRow[]
  /**
   * Visibility mode for variables inside this table:
   * - 'accumulated': each row sees base variables plus previous rows
   * - 'base-only': each row only sees base variables (no variables from previous rows)
   */
  visibilityMode?: 'accumulated' | 'base-only'
  /** Optional callback receiving the final resolved context (for body/url computation). */
  onResolvedContextChange?: (context: VariableContext) => void
  /** Optional callback when rows change (for persisting edits). */
  onRowsChange?: (rows: KeyValueTableRow[]) => void
}

export interface KeyValueTableHandle {
  addRow: () => void
}
```

> `VariableDefinition` comes from `VariableInputBox` and is already exported by `electron-core-ui/renderer`.

## Behavior Details

- **Base context**:
  - `variables` are converted to a `VariableContext` where `name => value`.
  - This base context is always visible to all rows.
- **Row resolution**:
  - Internally, each row is evaluated using Handlebars against a context that may include previous rows.
  - When `visibilityMode === 'accumulated'`, row *N* sees the base context plus resolved variables from rows `< N`.
  - When `visibilityMode === 'base-only'`, each row only sees the base context.
- **Resolved context emission**:
  - When `onResolvedContextChange` is provided, the component computes a `VariableContext` from enabled rows with non-empty keys.
  - It shallow-compares contexts to avoid infinite update loops and only calls the callback when values actually change.
- **Change notifications**:
  - When `onRowsChange` is provided, the component notifies the parent when the serialized rows actually change (after the first render).

## Usage Examples

### Basic key/value table without resolution callback

```tsx
import React, { useRef } from 'react'
import { KeyValueTable } from 'electron-core-ui/renderer'
import type {
  KeyValueTableHandle,
  KeyValueTableRow,
  VariableDefinition
} from 'electron-core-ui/renderer'

const Example: React.FC = () => {
  const tableRef = useRef<KeyValueTableHandle | null>(null)

  const baseVariables: VariableDefinition[] = [
    { name: 'baseUrl', value: 'https://api.example.com', description: 'Base API URL' },
    { name: 'userId', value: '123', description: 'Current user id' }
  ]

  const initialRows: KeyValueTableRow[] = [
    { key: 'Authorization', value: 'Bearer {{token}}', description: 'Auth header' }
  ]

  return (
    <KeyValueTable
      ref={tableRef}
      variables={baseVariables}
      initialRows={initialRows}
      visibilityMode="base-only"
    />
  )
}
```

### Table with resolved context (e.g. for building a URL/body)

```tsx
import React, { useRef, useState } from 'react'
import { KeyValueTable } from 'electron-core-ui/renderer'
import type {
  KeyValueTableHandle,
  KeyValueTableRow,
  VariableDefinition,
  KeyValueTableVariableContext
} from 'electron-core-ui/renderer'

const WithResolvedContext: React.FC = () => {
  const tableRef = useRef<KeyValueTableHandle | null>(null)
  const [resolved, setResolved] = useState<KeyValueTableVariableContext>({})

  const baseVariables: VariableDefinition[] = [
    { name: 'userId', value: '42', description: 'Current user id' }
  ]

  const initialRows: KeyValueTableRow[] = [
    { key: 'token', value: 'token-{{userId}}', description: 'Derived token' }
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <KeyValueTable
        ref={tableRef}
        variables={baseVariables}
        initialRows={initialRows}
        visibilityMode="accumulated"
        onResolvedContextChange={setResolved}
      />

      <pre style={{ fontSize: 11 }}>
        {JSON.stringify(resolved, null, 2)}
      </pre>
    </div>
  )
}
```

## Notes for AI Usage

- Prefer **controlled data flow**: keep the source of truth for rows in your app state and use `onRowsChange` to persist or mirror changes elsewhere (e.g. in Redux or a model object).
- Use `visibilityMode="accumulated"` when you want later rows to depend on variables defined earlier (environment-style flows), and `"base-only"` when each row must be independent.
- Keep `VariableDefinition` lists stable between renders when possible (e.g. memoize them) to avoid unnecessary recomputation and re-subscription work in `VariableInputBox`.
- When orchestrating multiple `KeyValueTable` instances (headers, query params, path params), centralize the construction of the combined `VariableContext` in a small pure helper so it stays easy to test and to generate from non-interactive inputs.
