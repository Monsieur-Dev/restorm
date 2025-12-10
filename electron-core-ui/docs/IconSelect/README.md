# IconSelect Component

A component for selecting icons - either emojis or codicons.

## Installation

The component requires the emoji-mart library:

```bash
npm install @emoji-mart/data @emoji-mart/react
```

## Usage

```tsx
import { IconSelect } from 'electron-core-ui/renderer'
import type { Icon } from 'electron-core-ui/types'

function MyComponent() {
  const [icon, setIcon] = useState<Icon | null>(null)

  return (
    <IconSelect
      value={icon}
      onChange={setIcon}
    />
  )
}
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `Icon \| null` | `null` | Currently selected icon |
| `onChange` | `(icon: Icon \| null) => void` | - | Called when icon selection changes |
| `placeholder` | `string` | `'🔲'` | Placeholder shown when no icon selected |
| `disabled` | `boolean` | `false` | Whether the picker is disabled |
| `className` | `string` | - | Additional CSS class |
| `style` | `CSSProperties` | - | Inline styles |

## Icon Type

```typescript
type IconType = 'emoji' | 'codicon' | 'none'

interface Icon {
  type: IconType
  value: string // emoji character or codicon name
}
```

## Helper Functions

```typescript
import { emojiIcon, codiconIcon, noIcon } from 'electron-core-ui/types/icon'

// Create an emoji icon
const rocket = emojiIcon('🚀')

// Create a codicon icon
const folder = codiconIcon('folder')

// Create an empty icon
const empty = noIcon()
```

## Features

- **Emoji Picker**: Full emoji picker powered by emoji-mart
- **Codicons Section**: Custom section with all VS Code codicons
- **Theme Support**: Automatically follows light/dark theme
- **Clear Button**: Easy way to remove the selected icon
- **Keyboard Navigation**: Full keyboard support via emoji-mart
- **Search**: Built-in emoji search

## Styling

The component uses CSS variables for theming:

- `--vscode-foreground`
- `--vscode-toolbar-hoverBackground`
- `--vscode-editorWidget-background`
- `--vscode-editorWidget-border`
- `--vscode-list-hoverBackground`
- `--vscode-descriptionForeground`

## Example with Breadcrumb

```tsx
import { Breadcrumb, IconSelect } from 'electron-core-ui/renderer'
import type { Icon } from 'electron-core-ui/types'

const items = [
  { id: '1', label: 'Root', icon: { type: 'emoji', value: '📁' } },
  { id: '2', label: 'Child', icon: { type: 'codicon', value: 'file' } }
]

<Breadcrumb items={items} showRoot />
```

