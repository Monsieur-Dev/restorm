# Settings Components

## Overview

The Settings UI in `electron-core-ui` is composed of the following components:

- `SettingsModalProvider` / `useSettingsModal` -- modal wrapper for the settings page
- `SettingsPage` -- conditional rendering: dynamic `SettingsView` or hardcoded fallback
- `SettingsView` -- TOC sidebar + scrollable content with search
- `SettingItem` -- individual setting with renderer, gear menu, and modified indicator
- `ThemeCarousel` -- theme preview carousel (used inside `ThemeRenderer` and fallback `SettingsPage`)

### Component Locations

- Source: `electron-core-ui/src/renderer/components/Settings/`
  - `SettingsModal.tsx` -- `SettingsModalProvider`
  - `SettingsPage.tsx` -- `SettingsPage`, `SettingsPageFallback`
  - `SettingsView.tsx` -- `SettingsView`, `TocItemRenderer`
  - `SettingItem.tsx` -- `SettingItem`
  - `ThemeCarousel.tsx` -- `ThemeCarousel`
  - `useSettingsModal.ts` -- `SettingsModalContext`, `useSettingsModal`
  - `renderers/` -- `ToggleRenderer`, `NumberInput`, `TextInput`, `EnumRenderer`, `ThemeRenderer`
- Exports from `electron-core-ui/renderer`:
  - `SettingsPage`, `SettingsModalProvider`, `useSettingsModal`, `ThemeCarousel`, `SettingsView`, `SettingItem`

## SettingsModalProvider / useSettingsModal

Wraps your app to enable the settings modal:

```tsx
<SettingsModalProvider>
  <MyApp />
</SettingsModalProvider>
```

Open/close from anywhere:

```tsx
const { isOpen, showSettingsModal, hideSettingsModal } = useSettingsModal()
```

Renders a `Modal` (test id: `settings-modal`) containing a `SettingsPage` (test id: `settings-page`).

## SettingsPage

Conditional rendering based on `SettingsContext`:

- **When `SettingsProvider` is active** and has loaded groups: renders `SettingsView` (the full YAML-driven settings UI)
- **Otherwise**: falls back to a hardcoded UI with `ThemeCarousel` + language `SelectBox`

Props:

| Prop | Default | Description |
|------|---------|-------------|
| `data-testid` | `"settings-page"` | Root element test id |
| `themeCarouselTestId` | `"{data-testid}-theme-carousel"` | ThemeCarousel test id (fallback only) |
| `languageSelectBoxTestId` | `"{data-testid}-language-selectbox"` | Language SelectBox test id (fallback only) |
| `children` | -- | Additional content rendered below settings |

## SettingsView

The primary settings UI with two-panel layout:

- **Left panel (~25%)**: TOC sidebar with a tree of group names
  - Scroll-synced: active group updates as user scrolls content
  - Click a TOC entry to smooth-scroll to that group
  - Expand/collapse nested groups via chevron icons
  - During search, only groups with matching settings are shown
- **Right panel (~75%)**: Scrollable content area
  - Groups rendered with heading tags (h1-h4 based on depth)
  - Sticky group headers with `data-sticky-level` attribute indicating nesting depth
  - Settings filtered when a search query is active
- **Search bar**: `InputBox` at the top; delegates search to the main process via `SettingsContext`

Props:

| Prop | Default | Description |
|------|---------|-------------|
| `data-testid` | `"settings-view"` | Root element test id |

## SettingItem

Renders a single setting:

- **Title**: translated via `titleKey`
- **Description**: translated via `descriptionKey` (hidden for `toggle` type)
- **Renderer**: selected by `type` field from built-in or custom renderers
- **Gear menu**: visible when the item is focused; opens a `ContextMenu` with:
  - "Reset Setting" -- resets to default value
  - "Copy Setting ID" -- copies `storageKey` to clipboard
- **Modified indicator**: CSS class `setting-item--modified` applied when `currentValue !== default`

Props:

| Prop | Type | Description |
|------|------|-------------|
| `setting` | `ResolvedSetting` | The setting definition with current value |
| `value` | `SettingValue` | Current value |
| `onChange` | `(storageKey, value) => void` | Change handler |
| `onReset` | `(storageKey) => void` | Reset handler |

## ThemeCarousel

A scrollable theme preview component used by `ThemeRenderer` (in `SettingsView`) and the fallback `SettingsPage`.

## Test IDs and Data Attributes

### SettingsPage

- Root: `data-testid="settings-page"`
- Data attribute: `data-language` (current `i18n.language`)
- When dynamic: embeds `SettingsView` with `data-testid="{rootTestId}-settings-view"`
- When fallback:
  - Theme carousel: `data-testid="{rootTestId}-theme-carousel"`
  - Language select box: `data-testid="{rootTestId}-language-selectbox"`

### SettingsView

- Root: `data-testid="settings-view"`
- Search input: `data-testid="{rootTestId}-search"`
- Group containers: `data-testid="settings-group-{groupId}"`
- Group titles: `data-sticky-level="{depth}"` attribute

### SettingItem

- Container: `data-testid="setting-item-{storageKey}"`
- Gear button: `data-testid="setting-gear-{storageKey}"`

### ThemeCarousel

- Root: `data-testid="{testId}"`
- Scrollable: `data-testid="{testId}-scrollable"`
- Data attributes: `data-theme-count`, `data-selected-theme-id`

### SettingsModal

- Modal root: `data-testid="settings-modal"`

## Selectors (`electron-core-ui/testing`)

```typescript
settingsModalRootSelector(testId: string): string
settingsPageRootSelector(testId: string): string
settingsPageThemeCarouselTestId(settingsPageTestId: string): string
settingsPageLanguageSelectBoxTestId(settingsPageTestId: string): string
themeCarouselRootSelector(testId: string): string
themeCarouselScrollableTestId(themeCarouselTestId: string): string
```

## Playwright-BDD Step Definitions (`electron-core-ui/testing/playwright-bdd`)

### `defineSettingsBddSteps`

Settings-specific steps:

- `Then settings page "{id}" should be visible`
- `Then settings page "{id}" language should be "{lang}"`
- `Then settings page "{id}" theme carousel should be visible`
- `Then settings page "{id}" language select box should be visible`

### Reusing internal component steps (recommended)

- `defineModalBddSteps` for the modal (`settings-modal`)
- `defineSelectBoxBddSteps` for the language SelectBox (`settings-page-language-selectbox`)
- `defineScrollableElementBddSteps` for the theme carousel scrollable (`settings-page-theme-carousel-scrollable`)
