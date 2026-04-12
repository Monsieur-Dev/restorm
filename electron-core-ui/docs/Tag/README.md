# Tag Component

A label-shaped tag with optional custom color, auto-computed contrast text, and inline editing.

## Component Location

- Source: `electron-core-ui/src/renderer/components/Tag/Tag.tsx`
- CSS: `electron-core-ui/src/renderer/components/Tag/tag.css`
- Export: `electron-core-ui/renderer`

## Usage

```tsx
import { Tag } from 'electron-core-ui/renderer'

// Basic tag
<Tag label="query" />

// Custom color (text color auto-computed for contrast)
<Tag label="pet" color="#ff0000" />

// Compact variant (smaller, for search results)
<Tag label="tag" compact />

// Editable tag
<Tag label="rename me" editable onLabelChange={(v) => console.log(v)} />
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | *(required)* | Tag text |
| `color` | `string` | — | Background color (hex). Text color is auto-computed for contrast (black/white). |
| `compact` | `boolean` | `false` | Compact mode (smaller font, tighter padding) |
| `editable` | `boolean` | `false` | Whether the tag can be edited inline |
| `onLabelChange` | `(newLabel: string) => void` | — | Called when the label is changed (only when `editable`) |
| `onClick` | `() => void` | — | Click handler (not called when `editable` — click enters edit mode instead) |
| `onContextMenu` | `(event: React.MouseEvent) => void` | — | Context menu handler |
| `data-testid` | `string` | — | Test ID |

## Visual Shape

The tag has a clothing-label shape with:
- An angled left notch (via `clip-path` polygon)
- A decorative hole punch (via `::after` pseudo-element)
- Rounded corners on the right side only

## Inline Editing

When `editable` is `true`:
- Clicking the tag enters edit mode
- The input field appears inside the tag shape (same background, font)
- Press Enter to commit, Escape to cancel
- Max length: 30 characters
- Input width auto-adapts to the text being typed

## Color Contrast

When a custom `color` is set, the text color is automatically computed using the W3C relative luminance formula (WCAG 2.0):
- Dark background → white text
- Light background → black text

## CSS Classes

- `.ecui-tag` — Base tag styling with label shape
- `.ecui-tag--default` — Default colors (no custom color)
- `.ecui-tag--compact` — Compact variant
- `.ecui-tag--editing` — Editing mode
- `.ecui-tag-input` — Inline input (transparent, inherits tag styling)

## CSS Variables

| Variable | Description |
|----------|-------------|
| `--tag-background` | Default tag background color |
| `--tag-background-hover` | Default tag hover background color |
| `--tag-foreground` | Default tag text color |
| `--editor-background` | Used for the hole punch color |
