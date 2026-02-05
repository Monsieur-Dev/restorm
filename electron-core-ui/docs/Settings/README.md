## Overview

The Settings UI in `electron-core-ui` is composed of:

- `SettingsModalProvider`: a provider that renders a `Modal` containing `SettingsPage`, and exposes `useSettingsModal()` helpers.
- `SettingsPage`: the settings page content (theme carousel + language select).
- `ThemeCarousel`: a small theme preview carousel used inside `SettingsPage`.

### Component locations

- Source:
  - `electron-core-ui/src/renderer/components/Settings/SettingsModal.tsx`
  - `electron-core-ui/src/renderer/components/Settings/SettingsPage.tsx`
  - `electron-core-ui/src/renderer/components/Settings/ThemeCarousel.tsx`
- Exports:
  - `SettingsPage`, `SettingsModalProvider`, `useSettingsModal`, `ThemeCarousel` from `electron-core-ui/renderer`

## Testing

### Test ids

Defaults (unless overridden via props):

- Settings modal (`Modal`): `data-testid="settings-modal"`
- Settings page: `data-testid="settings-page"`
- Theme carousel: `data-testid="settings-page-theme-carousel"`
- Theme carousel scrollable: `data-testid="settings-page-theme-carousel-scrollable"`
- Language select box: `data-testid="settings-page-language-selectbox"`

### Data attributes

`SettingsPage` exposes `data-language` on its root (current `i18n.language`).

`ThemeCarousel` exposes:

- `data-theme-count`
- `data-selected-theme-id`

### Selectors (`electron-core-ui/testing`)

- `settingsModalRootSelector(testId)`
- `settingsPageRootSelector(testId)`
- `settingsPageThemeCarouselTestId(settingsPageTestId)`
- `settingsPageLanguageSelectBoxTestId(settingsPageTestId)`
- `themeCarouselRootSelector(testId)`
- `themeCarouselScrollableTestId(themeCarouselTestId)`

### Playwright-BDD steps (`electron-core-ui/testing/playwright-bdd`)

Settings-specific steps:

- `Then settings page "{id}" should be visible`
- `Then settings page "{id}" language should be "{lang}"`
- `Then settings page "{id}" theme carousel should be visible`
- `Then settings page "{id}" language select box should be visible`

Reusing internal components (recommended):

- `defineModalBddSteps` for the modal (`settings-modal`)
- `defineSelectBoxBddSteps` for the language SelectBox (`settings-page-language-selectbox`)
- `defineScrollableElementBddSteps` for the theme carousel scrollable (`settings-page-theme-carousel-scrollable`)
