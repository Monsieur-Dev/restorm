# SettingsTreeView Component

## Overview

`SettingsTreeView` renders a VSCode-like settings navigation tree (left sidebar) from a declarative `SettingsSchema`.  
It supports nested categories, auto-expansion when searching, and highlights the selected category.

## API

### Types

```typescript
import type { SettingsSchema, SettingCategory } from 'electron-core-ui/types/settings'

export interface SettingsTreeViewProps {
  schema: SettingsSchema
  selectedCategory: string | null
  onSelectCategory: (categoryKey: string) => void
  searchQuery?: string
}
```

Where `SettingsSchema` is:

```typescript
export interface SettingsSchema {
  categories: Record<string, SettingCategory>
}

export interface SettingCategory {
  key: string
  name: string
  categories?: Record<string, SettingCategory>
  settings?: Record<string, unknown> // actual shape depends on host app
}
```

### Props

- **schema** (`SettingsSchema`, required): Full settings tree definition.
- **selectedCategory** (`string | null`, required): Currently selected category id (e.g. `"workbench-appearance-theme"`).
- **onSelectCategory** (`(categoryKey: string) => void`, required): Called when the user clicks a category that has settings.
- **searchQuery** (`string`, optional): When non-empty, all categories are expanded so that the right-hand filter can show matching settings.

## Category IDs

`SettingsTreeView` builds category keys as a `'-'`-joined path:

- Root category `workbench`
- Child `appearance`
- Grandchild `theme`

→ full key: `"workbench-appearance-theme"`.

Your `selectedCategory` must use the same format to correctly highlight and expand the tree.

## Usage

```tsx
import React, { useState } from 'react'
import { SettingsTreeView } from 'electron-core-ui/renderer'
import type { SettingsSchema } from 'electron-core-ui/types/settings'

const schema: SettingsSchema = {
  categories: {
    workbench: {
      key: 'workbench',
      name: 'Workbench',
      categories: {
        appearance: {
          key: 'appearance',
          name: 'Appearance',
          settings: { /* settings omitted */ }
        }
      }
    }
  }
}

const SettingsShell: React.FC = () => {
  const [selected, setSelected] = useState<string | null>('workbench-appearance')

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <SettingsTreeView
        schema={schema}
        selectedCategory={selected}
        onSelectCategory={setSelected}
      />
      {/* Right side: render settings for `selected` */}
      <div style={{ flex: 1 }}>Settings editor for: {selected}</div>
    </div>
  )
}
```

## Notes for AI Usage

- Always keep the `schema` **pure and serializable** (no functions inside), since it may be generated or persisted from external sources.
- When constructing `selectedCategory`, reuse the same `'-'`-joined path logic as in the component (root to leaf keys) to avoid mismatches.
- For search UX, use `searchQuery` only to control expansion; apply actual text filtering on the right-hand settings panel instead of mutating the schema.


