# System modals testing utilities (Electron)

## Goal

Provide reusable E2E testing helpers for native Electron system modals:

- open file dialog (`dialog.showOpenDialog` with `openFile`)
- open folder dialog (`dialog.showOpenDialog` with `openDirectory`)
- save file dialog (`dialog.showSaveDialog`)
- confirmation dialogs (`dialog.showMessageBox`) with i18n-based button validation

## What this solves

In E2E tests, native OS dialogs block the flow. These utilities let tests:

- declare the **next** expected system modal and its answer (path / clicked button)
- validate that the app asked for the expected buttons (by comparing with `i18nService.t` semantics)
- automatically **clear** the configuration after the modal was used (one-shot), so every test must configure mocks explicitly

## Exports

- `electron-core-ui/testing`
  - E2E helpers to install/configure mocks through Playwright `electronApp.evaluate(...)`
  - `withE2ELocaleEnv(env, overrides?)` to pin the launch locale (see below)
- `electron-core-ui/testing/playwright-bdd`
  - `defineSystemModalsBddSteps(...)` to register ready-to-use BDD steps

## Pinning the launch locale (`withE2ELocaleEnv`)

The renderer's i18n bootstrap defaults the UI language to the OS locale whenever
the user has never explicitly chosen one (see
[Architecture/I18n](../Architecture/I18n.md)) — which is the state of every test
run, since each launch gets a throwaway `userData` dir. An inherited host locale
therefore runs the suite in whatever language the developer's machine uses while
CI runs it in another, silently changing every user-visible string the specs
assert on.

Build the launch environment through this helper so the language is a property
of the suite rather than of the machine:

```ts
import { withE2ELocaleEnv } from 'electron-core-ui/testing'

const app = await electron.launch({
  args: [mainJsPath],
  env: withE2ELocaleEnv(process.env, { NODE_ENV: 'development' })
})
```

It drops every locale variable it finds (`LANG`, `LANGUAGE`, and all `LC_*` —
a host setting only `LC_MESSAGES` would otherwise keep steering Chromium's
locale resolution) and substitutes `en_US.UTF-8`. `overrides` are applied last,
so they win over the pin. The return type is `Record<string, string>`, which is
what Playwright's `launch({ env })` accepts; variables with no value are dropped
rather than forwarded.

## How to use (Playwright Electron fixture)

Install once (per test run / per scenario):

```ts
import { installSystemModalsMockingForE2E } from 'electron-core-ui/testing'

await installSystemModalsMockingForE2E(electronApp)
```

Configure the next dialogs (one-shot):

```ts
import {
  configureNextOpenDialogForE2E,
  configureNextSaveFileDialogForE2E,
  configureNextConfirmationDialogForE2E
} from 'electron-core-ui/testing'

await configureNextOpenDialogForE2E(electronApp, { kind: 'openFolder', path: '/tmp/sample' })
await configureNextSaveFileDialogForE2E(electronApp, { kind: 'saveFile', path: '/tmp/output.restorm' })

await configureNextConfirmationDialogForE2E(electronApp, {
  buttonKeys: ['file.unsavedChanges.save', 'file.unsavedChanges.dontSave', 'file.unsavedChanges.cancel'],
  choiceKey: 'file.unsavedChanges.dontSave'
})
```

Notes:
- Confirmation buttons are checked against the **translated** strings (same idea as `i18nService.t(key)`), so tests remain stable when the UI is localized.
- After a modal is triggered, its configuration is cleared automatically.

## How to use (Playwright-BDD)

In the consuming app, create a small step file that binds the generic steps to your fixture:

```ts
import { createBdd } from 'playwright-bdd'
import { test } from '../fixtures/my-electron.fixture'
import { defineSystemModalsBddSteps } from 'electron-core-ui/testing/playwright-bdd'

defineSystemModalsBddSteps(createBdd(test))
```

### Available BDD steps (high level)

- Install/reset:
  - `Given system modals mocking is installed`
  - `When I reset system modals mock history`

- Configure dialogs:
  - `Given I configure the open file dialog to return path "{path}"`
  - `Given I configure the open folder dialog to return path "{path}"`
  - `Given I configure the save file dialog to return path "{path}"`
  - `Given I configure the save folder dialog to return path "{path}"`
  - `Given I configure the confirmation dialog buttons "{key1|key2|...}" and choose "{keyX}"`

- Assert dialogs:
  - `Then an open dialog should have been shown`
  - `Then a save dialog should have been shown`
  - `Then a confirmation dialog should have been shown`
  - `Then no system modal should have been shown`

## Component Testing docs index

- Breadcrumb → see [Testing](../Breadcrumb/README.md#testing)
- Button → see [Testing](../Button/README.md#testing)
- Callout → see [Testing](../Callout/README.md#testing)
- CodeEditor → see [Testing](../CodeEditor/README.md#testing)
- ColorPicker → see [Testing](../ColorPicker/README.md#testing)
- ContextMenu → see [Testing](../ContextMenu/README.md#testing)
- CustomDropdown → see [Testing](../CustomDropdown/README.md#testing)
- CustomTabs → see [Testing](../CustomTabs/README.md#testing)
- CustomWCO → see [Testing](../CustomWCO/README.md#testing)
- DateTimePicker → see [Testing](../DateTimePicker/README.md#testing)
- IconSelect → see [Testing](../IconSelect/README.md#testing)
- InputBox → see [Testing](../InputBox/README.md#testing)
- KeyValueTable → see [Testing](../KeyValueTable/README.md#testing)
- ListView → see [Testing](../ListView/README.md#testing)
- ListViewDropdown → see [Testing](../ListViewDropdown/README.md#testing)
- MarkdownEditor → see [Testing](../MarkdownEditor/README.md#testing)
- MarkdownViewer → see [Testing](../MarkdownViewer/README.md#testing)
- MenuBar → see [Testing](../MenuBar/README.md#testing)
- Modal → see [Testing](../Modal/README.md#testing)
- ProgressBar → see [Testing](../ProgressBar/README.md#testing)
- Radio → see [Testing](../Radio/README.md#testing)
- Sash → see [Testing](../Sash/README.md#testing)
- ScrollableElement → see [Testing](../ScrollableElement/README.md#testing)
- SearchBar → see [Testing](../SearchBar/README.md#testing)
- SelectBox → see [Testing](../SelectBox/README.md#testing)
- Settings → see [Testing](../Settings/README.md#testing)
- SplitView → see [Testing](../SplitView/README.md#testing)
- Statusbar → see [Testing](../Statusbar/README.md#testing)
- TagsView → see [Testing](../TagsView/README.md#testing)
- Titlebar → see [Testing](../Titlebar/README.md#testing)
- Toggle → see [Testing](../Toggle/README.md#testing)
- Tooltip → see [Testing](../Tooltip/README.md#testing)
- VariableInputBox → see [Testing](../VariableInputBox/README.md#testing)
- Workbench → see [Testing](../Workbench/README.md#testing)

