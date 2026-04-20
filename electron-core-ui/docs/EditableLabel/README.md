# EditableLabel

Inline-editable label. Renders as any single-line text element, shows a pencil icon on hover / keyboard focus, clicks into an auto-focused input, and commits on Enter / blur / Tab. Extracted from `<Breadcrumb>` so the pattern is reusable wherever a user should be able to rename a thing in place.

## Usage

```tsx
import { EditableLabel } from 'electron-core-ui/renderer'

function FolderHeader({ folder, onRename }: { folder: Folder; onRename: (next: string) => void }) {
  return (
    <EditableLabel
      as="h2"
      value={folder.name}
      onChange={onRename}
      editTooltip="Rename folder"
    />
  )
}
```

The element rendered in read mode comes from the polymorphic `as` prop. Typography (font-size / weight) is inherited from that tag plus any `className` the caller passes — `EditableLabel` only provides layout glue for the pencil + input swap.

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `string` | required | Canonical text. Treated as a controlled value — the component always renders `value` in read mode, even between commits. |
| `onChange` | `(next: string) => void` | required | Called with the trimmed next value when the user commits a *changed* entry that passes `validate`. Never called on cancel. |
| `as` | `'span' \| 'p' \| 'h1'..'h6' \| 'div'` | `'span'` | Tag used in read mode. |
| `editable` | `boolean` | `true` | When false, no pencil, no click/keyboard interaction — the component collapses to plain text. |
| `isEditing` | `boolean` | — | Optional *controlled* edit-mode flag. When omitted, edit state is local. |
| `onEditingChange` | `(editing: boolean) => void` | — | Fired whenever the component wants to enter or leave edit mode. Useful paired with `isEditing` for parents that need to render modal UI around the input. |
| `placeholder` | `string` | — | Forwarded to the input. |
| `maxLength` | `number` | — | Forwarded to the input. |
| `inputType` | `'text'` | `'text'` | Placeholder for future single-line variants (e.g. `'email'`, `'url'`). |
| `validate` | `(next: string) => string \| null \| undefined` | — | Return a non-empty string to block the commit and display it as an inline error; falsy accepts. |
| `editTooltip` | `string` | — | Title on the pencil icon + `aria-label` on the read element and input. Default `aria-label` falls back to `Edit <value>`. |
| `className` | `string` | — | Appended to the root element's class list (both modes). |
| `inputClassName` | `string` | — | Extra class applied to the `<input>` in edit mode. |
| `data-testid` | `string` | — | Root gets the id as-is; input gets `${id}-input`; error (when shown) gets `${id}-error`. |

## Behaviour

- **Entering edit mode**: click on the read element, or press Enter / Space while it's keyboard-focused. The input auto-focuses and selects the whole text, so the user can immediately type-to-replace.
- **Committing**: Enter, blur, or Tab. The committed value is trimmed. `onChange` is skipped when the trimmed result equals the current `value` (no-op edit). If `validate` is supplied and returns a non-empty string, the commit is blocked, the error is rendered in an `aria-live="polite"` span, and the input re-focuses.
- **Cancelling**: Escape. No `onChange`. The input discards its draft and the read element re-focuses.
- **Controlled vs uncontrolled**: `isEditing` is optional; when passed, the parent is the single source of truth and `onEditingChange` notifies it of user-driven transitions.

## Accessibility

- Read mode, `editable={true}`: the polymorphic `as` tag keeps its native semantics (heading levels stay heading levels, etc.) and a nested `<button class="ecui-editable-label-trigger">` provides the interactive affordance. The button gets `aria-label="Edit <value>"` (or the caller's `editTooltip`) and inherits native Enter/Space keyboard handling.
- Read mode, `editable={false}`: plain text, no interactive semantics, no button.
- Edit mode: the input gets the same `aria-label`. When validation fails, `aria-invalid="true"` + `aria-describedby` tie the input to the error text.
- After a commit or cancel the component restores focus to the trigger button, so keyboard users don't lose their place. A parent-driven close (via `isEditing=false` on a controlled instance) does NOT steal focus.

## Examples

### Plain span (default)

```tsx
<EditableLabel value={title} onChange={setTitle} />
```

### Heading with validation

```tsx
<EditableLabel
  as="h1"
  value={pageTitle}
  onChange={setPageTitle}
  validate={(next) => next.length < 3 ? 'Title must be at least 3 characters' : null}
/>
```

### Controlled edit state

```tsx
const [editing, setEditing] = useState(false)

<>
  <button onClick={() => setEditing(true)}>Rename</button>
  <EditableLabel
    value={folder.name}
    onChange={commitRename}
    isEditing={editing}
    onEditingChange={setEditing}
  />
</>
```

### Disabled (read-only)

```tsx
<EditableLabel value={folder.name} onChange={() => {}} editable={false} />
```

## Styling hooks

The stylesheet uses the standard ECU theme variables:

- `--focusBorder` — outline on focus and on the input.
- `--input-border` / `--input-background` / `--input-foreground` — input chrome.
- `--errorForeground` (with a fallback) — validation error text and the input's invalid-state border.

Override any of these via the `className` prop on a specific instance, or via a theme-level cascade for the whole app.

## Out of scope

- Multi-line / textarea editing (single-line only).
- Rich-text / markdown.
- The icon-selection affordance that sits alongside an editable name in `<Breadcrumb>` — that stays in `Breadcrumb` itself, composed next to `EditableLabel`.
