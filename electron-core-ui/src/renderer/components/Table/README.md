# `<Table>`

Generic, controlled table with optional **resizable columns**, **row reordering** (HTML5 drag & drop), and **column-width persistence** (localStorage, opt-in).

The table is fully controlled: the consumer owns the rows and decides when to mutate them. The table only fires `onRowsReorder` when the user drops a dragged row.

## When to use it

Reach for `<Table>` when you need a semantic `<table>` with:

- A mix of fixed-width columns (handles, toggles, delete buttons) and flexible content columns (key, value, description, …).
- Per-column resize handles that persist their widths across sessions.
- Drag-to-reorder rows with the same visual behaviour everywhere in the app.

For a richer key/value editor with typed inputs and a type-switch context menu, compose on top of `KeyValueTable` (which itself uses `<Table>` internally).

## Out of scope

Sorting, filtering, pagination, multi-row selection, virtualization, and keyboard-driven drag are explicitly not handled. Don't expect them — use a dedicated component if you need them.

## Minimal usage

```tsx
import { Table, type TableColumn } from 'electron-core-ui/renderer'

interface Person { id: string; name: string; email: string }

const columns: TableColumn<Person>[] = [
  { id: 'name',  header: 'Name',  renderCell: (p) => p.name },
  { id: 'email', header: 'Email', renderCell: (p) => p.email }
]

<Table<Person>
  columns={columns}
  rows={people}
  getRowId={(p) => p.id}
/>
```

No persistence, no resizing, no reorder — the most stripped-down form.

## Resizable columns + persistence

```tsx
const columns: TableColumn<KeyValueRow>[] = [
  { id: 'enabled', header: '', width: 25, renderCell: (r) => <Toggle … /> },
  { id: 'key',   header: 'Key',   resizable: true, defaultWidth: 200, minWidth: 80,  renderCell: (r) => <Input … /> },
  { id: 'value', header: 'Value', resizable: true, defaultWidth: 300, minWidth: 80,  renderCell: (r) => <Input … /> },
  { id: 'desc',  header: 'Desc',  resizable: true,                    minWidth: 100, renderCell: (r) => <Input … /> },
  { id: 'delete', header: '', width: 25, renderCell: (r) => <DeleteButton … /> }
]

<Table<KeyValueRow>
  id="kv-default"              // persist widths under ecu:table:kv-default:column-widths
  columns={columns}
  rows={rows}
  getRowId={(r) => r.id}
/>
```

- Columns with `width` are fixed; they never get a resize handle and are not persisted.
- Columns with `resizable: true` get a resize handle on their right edge. `defaultWidth` is the initial width before the user has touched it; `minWidth` / `maxWidth` clamp the drag.
- Resizable columns without a `defaultWidth` share the remaining space equally (until the user resizes them).
- When `id` (persistence key) is omitted, widths live in memory for the component lifetime only.
- The persisted payload is pruned automatically when columns are added or removed — stale entries never accumulate.

## Reorderable rows

```tsx
<Table<Favorite>
  columns={columns}
  rows={favorites}
  getRowId={(f) => f.id}
  reorderable
  onRowsReorder={(orderedIds) => {
    setFavorites(orderedIds.map((id) => favoritesById[id]))
  }}
/>
```

- `reorderable={true}` auto-injects a drag-handle column (⋮⋮, 18px wide) at position 0. You don't list it in `columns`.
- `onRowsReorder(orderedIds)` fires after a successful drop with the new full order. Update your rows from this callback — the table never mutates rows itself.
- The drop indicator is a 2px border on the neighbour row, matching the visual language of other electron-core-ui components.

## Imperative API

The table forwards a `TableHandle` ref with two methods:

```ts
interface TableHandle {
  focusRow(id: string): void        // focus first input/button/tabindex inside row
  resetColumnWidths(): void          // clear persistence + revert to defaults
}
```

Typical pattern:

```tsx
const tableRef = useRef<TableHandle>(null)
// …after adding a row…
tableRef.current?.focusRow(newRowId)
```

## Controlled row model — why no `addRow`?

Rows are a fully controlled prop. The table never owns them. If you want an "add row" button, wire it up on the consumer side:

```tsx
function handleAddRow() {
  const newRow = { id: uuid(), name: '', email: '' }
  setPeople((prev) => [...prev, newRow])
  // Optionally: tableRef.current?.focusRow(newRow.id)
}
```

This keeps the table reusable for any row shape and avoids forcing a `createEmptyRow` prop.

## Persistence key conventions

- Use stable, lowercase, dash-separated ids: `kv-default`, `env-favorites`, `request-headers`.
- Keep the key **semantic**, not instance-specific — you usually want all KV tables to share a width preference, not each one to have its own.
- If you need per-instance widths (rare), you can include an instance id in the key, but think twice — localStorage fills up fast.

## Styling

Core CSS classes used by the component (overridable via scoped selectors):

- `.ecu-table` — the `<table>` element
- `.ecu-table-th--resizable` / `.ecu-table-th--resizing` — resizable header states
- `.ecu-table-resize-handle` — the invisible 6px drag zone on the right edge of resizable headers
- `.ecu-table-row` — every `<tr>`
- `.ecu-table-row--drop-before` / `.ecu-table-row--drop-after` — drop indicator states
- `.ecu-table-drag-handle` — the ⋮⋮ drag handle (auto-injected when reorderable)

For consumer-specific tweaks, scope your overrides under a wrapper class so they don't leak to other tables.
