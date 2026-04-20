# IconSelect Component

A component for selecting icons – either emojis or codicons – with themed styling.

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
| `readonly`   | `boolean`                         | `false` | Readonly mode (no interaction)             |
| `size`       | `number`                          | `16`    | Pixel size of the displayed icon. Bump for e.g. H1 adornments so the glyph matches the heading without cascading into other IconSelect instances |
| `small`      | `boolean`                         | `true`  | Use the `small` button variant for the trigger. Set to `false` when rendering at a larger `size` (≥ 20 px) so the button isn't squashed; pair with a CSS override on the button's horizontal padding if you need a tighter layout |
| `className`  | `string`                          | –       | Additional CSS class                       |
| `style`      | `React.CSSProperties`             | –       | Inline styles                              |
| `data-testid`| `string`                          | –       | Stable E2E hooks base id                   |

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

## Testing

### `data-testid` API

`IconSelect` exposes stable hooks via `data-testid` (default: `iconselect`):

- Root: `data-testid={id}`
  - attributes: `data-is-open`, `data-disabled`, `data-active-tab`, `data-selected-type`, `data-selected-value`
- Button/value: `${id}-button`, `${id}-value`
- Picker: `${id}-picker`, header `${id}-header`, tabs `${id}-tabs`
- Tab: `${id}-tab-${tabId}` (attribute `data-is-active`)
- Panel: `${id}-panel-${tabId}`
- Clear: `${id}-clear`

Per-tab hooks (search + items):

- Emoji:
  - search: `${id}-emoji-search-input`, `${id}-emoji-search-clear`
  - items: `data-emoji` on each emoji button inside `${id}-picker`
- Grouped libraries (`codicon`, `iconoir`, `phosphor`, `fontawesome`):
  - search: `${id}-${tabId}-search-input`, `${id}-${tabId}-search-clear`
  - items: `${id}-${tabId}-icon-${iconName}` with `data-icon-type` and `data-icon-name`
- Flat grids (`material`, `simpleicons`, `feather`):
  - search: `${id}-${tabId}-search-input`, `${id}-${tabId}-search-clear`
  - items: `${id}-${tabId}-icon-${iconName}` with `data-icon-type` and `data-icon-name`

### Selectors (electron-core-ui/testing)

- `iconSelectRootSelector(testId)`
- `iconSelectButtonSelector(testId)`
- `iconSelectPickerSelector(testId)`
- `iconSelectTabSelector(testId, tabId)`
- `iconSelectClearSelector(testId)`
- `iconSelectSearchInputSelector(testId, tabId)`
- `iconSelectSearchClearSelector(testId, tabId)`
- `iconSelectIconSelector(testId, tabId, iconName)`
- `iconSelectEmojiSelector(testId, emoji)`

### Playwright-BDD steps (electron-core-ui/testing/playwright-bdd)

Register:

- `defineIconSelectBddSteps(bdd)`

Steps:

- `When I open icon select {string}`
- `When I close icon select {string}`
- `Then icon select {string} should be open`
- `Then icon select {string} should be closed`
- `Then icon select {string} active tab should be {string}`
- `Then icon select {string} should be readonly`
- `When I select icon select {string} tab {string}`
- `When I type in icon select {string} search for tab {string} {string}` (typing letter-by-letter)
- `When I select emoji {string} in icon select {string}`
- `When I select first emoji in icon select {string}`
- `When I select icon {string} {string} in icon select {string}`
- `When I select first icon of type {string} in icon select {string}`
- `When I clear icon select {string}`
- `Then icon select {string} selected type should be {string}`
- `Then icon select {string} selected value should be {string}`
- `Then icon select {string} selected value should not be empty`
