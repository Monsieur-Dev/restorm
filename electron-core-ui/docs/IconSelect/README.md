# IconSelect Component

A component for selecting icons – either emojis or VS Code codicons – with VSCode-themed styling.

## Component Location

- Source: `electron-core-ui/src/renderer/components/IconSelect/IconSelect.tsx`
- Types: `electron-core-ui/types/icon.ts`

## Installation

The component relies on `emoji-mart` for the emoji picker:

```bash
npm install @emoji-mart/data @emoji-mart/react
```

## Usage

```tsx
import React, { useState } from 'react'
import { IconSelect } from 'electron-core-ui/renderer'
import type { Icon } from 'electron-core-ui/types/icon'

const Example: React.FC = () => {
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

| Prop         | Type                              | Default | Description                               |
|--------------|-----------------------------------|---------|-------------------------------------------|
| `value`      | `Icon \| null`                   | `null`  | Currently selected icon                    |
| `onChange`   | `(icon: Icon \| null) => void`   | –       | Called when icon selection changes         |
| `placeholder`| `string`                          | `'🔲'`  | Placeholder shown when no icon is selected |
| `disabled`   | `boolean`                         | `false` | Whether the picker is disabled             |
| `className`  | `string`                          | –       | Additional CSS class                       |
| `style`      | `React.CSSProperties`             | –       | Inline styles                              |

## Icon Type

```typescript
export type IconType = 'emoji' | 'codicon' | 'none'

export interface Icon {
  type: IconType
  /** emoji character or codicon name */
  value: string
}
```

Helper functions are provided in `electron-core-ui/types/icon`:

```typescript
import { emojiIcon, codiconIcon, noIcon } from 'electron-core-ui/types/icon'

const rocket = emojiIcon('🚀')
const folder = codiconIcon('folder')
const empty = noIcon()
```

## Notes for AI Usage

- Store the selected icon as an **explicit, typed value** (`Icon`) in your domain model rather than as a raw string; this makes it easier for agents to transform or migrate icon data.
- When generating UIs, prefer semantic defaults (e.g. `folder` for folders, `file` for files) and only fall back to emojis for user-facing decoration.
- Keep `onChange` handlers small and pure (e.g. just `setState` or dispatch an action); avoid mixing side effects (like network calls) directly into icon selection logic.
- If you expose icon choices via config or JSON, reuse the same `Icon` shape so that both human-edited configs and programmatic code paths stay aligned.
