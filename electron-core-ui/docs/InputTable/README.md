# InputTable Component

## Overview

The `InputTable` component is a VSCode-themed, editable table built on top of AG Grid Community.
It is designed for parameter-style data entry where each row represents an item and each column defines the input type (text, checkbox, or `VariableInputBox`).

## Component Location

- Source: `electron-core-ui/src/renderer/components/InputTable/InputTable.tsx`
- Types: `electron-core-ui/src/renderer/components/InputTable/types.ts`
- Styles: `electron-core-ui/src/renderer/components/InputTable/inputTable.css`

## Features

- Column-based configuration with explicit input types:
  - `text` for plain string input
  - `checkbox` for boolean flags
  - `variable` for `VariableInputBox` (supports `{{variable}}` syntax)
- Row management:
  - Add new rows via a built-in "+" button
  - Row reordering via drag & drop (grab from the first checkbox column if configured)
- Controlled data model:
  - `rows` is fully controlled by the parent
  - `onChange` is called whenever a cell changes, rows are reordered, or a row is added
- Theming:
  - Uses VSCode CSS variables (`--*`) to theme the grid via AG Grid CSS variables
  - Works seamlessly with `useTheme` in the host application

## TypeScript Interfaces

### InputTableColumnType

```typescript
export type InputTableColumnType = 'text' | 'checkbox' | 'variable'
```

### InputTableColumn

```typescript
export interface InputTableColumn {
  id: string                    // Column id, used as row[field] key
  label?: string                // Column header label
  type: InputTableColumnType    // 'text' | 'checkbox' | 'variable'
  width?: number | string       // Optional fixed width, otherwise flex = 1
}
```

### InputTableRow

```typescript
export type InputTableRow = Record<string, string | boolean>
```

Each row is a simple key/value map where keys match `InputTableColumn.id`.  
An internal `__id` field is added automatically for stable row identity.

### InputTableProps

```typescript
export interface InputTableProps {
  columns: InputTableColumn[]                                // Column configuration
  rows: InputTableRow[]                                      // Controlled row data
  onChange: (rows: InputTableRow[]) => void                  // Called on any change
  createEmptyRow: () => InputTableRow                        // Factory for new rows
  getVariablesForColumn?: (
    columnId: string,
    row: InputTableRow,
    rowIndex: number
  ) => VariableDefinition[]                                  // Variables for 'variable' columns
  className?: string
  style?: React.CSSProperties
}
```

## Behavior Details

- **Editing**:
  - `text` columns use AG Grid's default text editor.
  - `checkbox` columns use the built-in checkbox renderer/editor.
  - `variable` columns use a custom cell editor that embeds `VariableInputBox`.
- **Autocomplete in variable columns**:
  - Suggestions are provided by `getVariablesForColumn`.
  - Triggers:
    - `Ctrl+Space`
    - Typing `{`
  - Selected variables are inserted as `{{variableName}}`.
- **Row reordering**:
  - `rowDragManaged` is enabled; the first `checkbox` column is configured with `rowDrag: true`.
  - When a row drag ends, `onChange` is called with rows in the new order.
- **Add row**:
  - A small "+" button above the grid calls `createEmptyRow()` and appends the new row.

## Usage Examples

### Basic Parameter Table

```tsx
import { InputTable } from 'electron-core-ui/renderer'
import type {
  InputTableColumn,
  InputTableRow,
  InputTableColumnType,
  VariableDefinition
} from 'electron-core-ui/renderer'

const columns: InputTableColumn[] = [
  { id: 'enabled', label: '', type: 'checkbox', width: 32 },
  { id: 'key', label: 'Key', type: 'variable', width: 200 },
  { id: 'value', label: 'Value', type: 'variable', width: 260 },
  { id: 'description', label: 'Description', type: 'text' }
]

const [rows, setRows] = useState<InputTableRow[]>([
  { enabled: true, key: 'userId', value: '123', description: 'User identifier' }
])

const allVariables: VariableDefinition[] = [
  { name: 'baseUrl', value: 'https://api.example.com', description: 'Base API URL' },
  { name: 'userId', value: '123456', description: 'Current user identifier' }
]

const getVariablesForColumn = (
  columnId: string,
  _row: InputTableRow,
  _rowIndex: number
): VariableDefinition[] => {
  if (columnId === 'key' || columnId === 'value') {
    return allVariables
  }
  return []
}

const createEmptyRow = (): InputTableRow => ({
  enabled: true,
  key: '',
  value: '',
  description: ''
})

<InputTable
  columns={columns}
  rows={rows}
  onChange={setRows}
  createEmptyRow={createEmptyRow}
  getVariablesForColumn={getVariablesForColumn}
/>
```
