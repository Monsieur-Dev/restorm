# IconView Component

A lightweight display component that renders any icon type supported by the `Icon` interface: codicons, emojis, and all library icons (Material, Feather, Phosphor, Iconoir, Simple Icons, Font Awesome).

Use `IconView` whenever you need to display an icon without the picker UI of `IconSelect`.

## Component Location

- Source: `electron-core-ui/src/renderer/components/IconView/IconView.tsx`
- Types: `electron-core-ui/types/icon.ts`

## Usage

```tsx
import { IconView } from 'electron-core-ui/renderer'

// Codicon
<IconView icon={{ type: 'codicon', value: 'heart' }} />

// Emoji
<IconView icon={{ type: 'emoji', value: '🚀' }} />

// Material icon
<IconView icon={{ type: 'material', value: 'mdiAccount' }} size={20} />

// No icon (renders nothing)
<IconView icon={null} />
<IconView icon={{ type: 'none', value: '' }} />
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `icon` | `Icon \| null \| undefined` | -- | The icon to display. Renders nothing if `null`, `undefined`, or `type: 'none'`. |
| `size` | `number` | `16` | Icon size in pixels. |
| `className` | `string` | -- | Additional CSS class on the root element. |
| `data-testid` | `string` | -- | Test ID for E2E tests. |

## Supported Icon Types

| Type | Rendering |
|------|-----------|
| `codicon` | `<i className="codicon codicon-{value}" />` |
| `emoji` | Raw emoji character in a `<span>` |
| `iconoir` | Iconoir React component |
| `phosphor` | Phosphor React component |
| `material` | MDI React component |
| `simpleicons` | Simple Icons SVG |
| `feather` | Feather React component |
| `fontawesome` | Font Awesome React component |
| `none` | Renders `null` |

## Integration

`IconView` is used internally by:

- **IconSelect** -- to display the currently selected icon value
- **Breadcrumb** -- to display item icons (both navigational and current item)

Consumer apps can use it in ListView items to display custom icons:

```tsx
import { IconView } from 'electron-core-ui/renderer'

const icon = folder.icon // { type: 'material', value: 'mdiFolder' }

// As a ListView item icon (ReactNode)
const listViewItem = {
  id: folder.id,
  title: folder.name,
  icon: icon ? <IconView icon={icon} size={16} /> : 'folder'
}
```

## Testing

### Test IDs

- Root element: `data-testid="{value}"` (when provided)

### CSS

- `.ecui-icon-view` -- root class, inline-flex centered
