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

The language `SelectBox` lists `AVAILABLE_LANGUAGES` (`Settings/languages.ts`) as
`"{flag} {endonym}"` (e.g. `🇫🇷 Français`) — each entry carries an emoji `flag`
alongside its `code` + `name`. On platforms without emoji flags (Windows' Segoe
UI Emoji) the flag degrades to regional-indicator letters; no image assets.

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
- **Gear menu**: revealed when the row is hovered or holds focus (`:hover` / `:focus-within`); it stays mounted so it remains a keyboard tab stop. Opens a `ContextMenu` with:
  - "Reset Setting" -- resets to default value
  - "Copy Setting ID" -- copies `storageKey` to clipboard
- **Modified indicator**: CSS class `setting-item--modified` applied when `currentValue !== default`
- **Focus**: the row container is not focusable and never draws a focus ring — only the real controls (the gear button and the setting's input) are tab stops.

Props:

| Prop | Type | Description |
|------|------|-------------|
| `setting` | `ResolvedSetting` | The setting definition with current value |
| `value` | `SettingValue` | Current value |
| `onChange` | `(storageKey, value) => void` | Change handler |
| `onReset` | `(storageKey) => void` | Reset handler |

## ThemeCarousel

A scrollable theme preview component used by `ThemeRenderer` (in `SettingsView`) and the fallback `SettingsPage`.

### Props

| Prop | Type | Description |
|------|------|-------------|
| `className` | `string` | Optional class merged with `theme-carousel`. |
| `data-testid` | `string` | Root test id (defaults to `theme-carousel`). |
| `scrollableTestId` | `string` | Inner `ScrollableElement` test id (defaults to `{data-testid}-scrollable`). |
| `onSelect` | `(themeId: string) => void` | Override the click handler. Without it, clicking a tile calls `setTheme` directly. The Settings UI passes a callback that routes the choice through `setSetting` / `setWorkspaceSetting`, so a tile picked on the Workspace tab lands in the host's workspace settings file (`<dir>/<workspace dotfolder>/settings.json`) instead of bypassing the overlay. |

## Feature-Gated Settings

Settings can be conditionally shown based on feature flags. This allows settings to be hidden when their associated feature is disabled.

### YAML Configuration

Add `feature` and `featureDisabledDefault` to a setting definition:

```yaml
- setting:
    id: "advancedVisualEffects"
    titleKey: "settings.appearance.advancedVisualEffects.title"
    type: "toggle"
    default: true
    feature: "advancedGraphics"
    featureDisabledDefault: false
```

| Field | Required | Description |
|-------|----------|-------------|
| `feature` | No | Name of the feature flag that gates this setting |
| `featureDisabledDefault` | Only when `feature` is set | Value returned when the feature is disabled |

### Behavior

- **Feature disabled:** The setting is hidden from the settings UI (`getFilteredGroups()` strips it). `get()` returns `featureDisabledDefault` regardless of the stored value. Components using `useSetting()` receive the disabled default.
- **Feature enabled:** The setting appears in the UI and behaves normally. `get()` returns the stored value or `default`.
- **No feature set:** The setting always appears and behaves normally.
- **Empty groups:** If all settings in a group are feature-gated and disabled, the group is removed from the UI.

### Usage in Code

```typescript
// Works regardless of feature state.
// Returns true when feature is enabled (or stored value), false when disabled.
const [advancedEffects] = useSetting('appearance:advancedVisualEffects')
```

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
