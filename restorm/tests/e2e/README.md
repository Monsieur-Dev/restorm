# E2E Tests

Playwright-BDD end-to-end tests for Restorm. Three projects are active in
`playwright.config.ts`:

| Project | Scope |
| --- | --- |
| [`full-workflow`](#project-full-workflow) | Single long linear scenario driven by a mocked persistence layer. Starts from an empty file, imports every supported format, and exercises tabs, tags, env variables, search, rename, undo/redo, navigation history, docs, and Ctrl+O — verifying state survives close/reopen. |
| [`open-folder`](#project-open-folder) | Folder-mode load (Petstore folder on disk → 9 env folders). |
| [`save-operations`](#project-save-operations) | Save As folder-mode with YAML format, structure diff against reference. |

Folder-mode coverage (open-folder + save-operations) is deliberately
narrow — expect a dedicated folder-mode scenario in a later ticket.

---

## Project: `full-workflow`

- Feature: `bdd/full-workflow/features/full-workflow.feature`
- Steps: `bdd/full-workflow/steps/full-workflow.steps.ts`
- Fixture: `bdd/fixtures/full-workflow.fixture.ts`

The single scenario is long (~340 lines) and linear — every `When` /
`Then` below is exercised by that one run. Grouped by feature area.

### App lifecycle & window bounds

- **`Given a fresh app seeded with the main window at x={int} y={int}`** — bootstrap launch with `--clear-settings`, seed `config.json`, then start the real app.
- **`Then the window bounds should be at x={int} y={int}`** — read live BrowserWindow bounds.
- **`When I move and resize the window to x={int} y={int} width={int} height={int}`**
- **`Then the window bounds should be x={int} y={int} width={int} height={int}`**
- **`When I close the app`** / **`When I relaunch the app`** — relaunch reuses the discovered `userData` path.
- **`Then the saved main window bounds should be x={int} y={int} width={int} height={int}`** — read `windows.main` from `config.json` after close.

### New file, welcome screen, recent files & favorites

- **`When I create a new single-file YAML collection named {string}`** — drives File → New with the mocked save-file dialog.
- **`Then the file {string} should exist in the temp dir`**
- **`When I close the current file`** — via `__restormTestHelpers.closeFile()` (bypasses the unsaved-changes prompt).
- **`Then the welcome screen should be visible`** / **`Then the welcome screen should not be visible`**
- **`Then the welcome recent files should contain {string}`**
- **`When I favorite the welcome recent file {string}`** / **`When I unfavorite the welcome favorite {string}`**
- **`Then the welcome favorites should contain {string}`** / **`Then … should not contain …`**
- **`When I open the welcome recent file {string}`**
- **`When I open the {string} file via Ctrl+O`** — mocks the next system open-file dialog for the given filename (resolved under `FULL_WORKFLOW_TEMP_DIR`) then presses Ctrl+O.

### Import modal

- **`When I open the import modal`** / **`When I cancel the import modal`** / **`When I clear the import source`**
- **`When I paste the sample file {string} into the import source`**
- **`Then the import preview should be visible`** / **`Then the import preview should not be visible`**
- **`When I import the sample file {string}`** — paste + confirm import; expands all imported folders in the sidebar.
- **`When I import the URL {string}`** — URL-based import (requires the sample docker server running).

### Sidebar tree

- **`When I click the sidebar collapse-all button`**
- **`Then every sidebar folder should be collapsed`**
- **`When I expand the sidebar folder {string}`** / **`When I collapse the sidebar folder {string}`** (both idempotent).
- **`Then the folder {string} should be expanded`** / **`Then the sidebar folder {string} should be expanded`** / **`… should be collapsed`**
- **`Then the folder {string} should have {int} collapsed children`**
- **`Then the sidebar should contain the folder {string}`** / **`Then the sidebar should show a child of {string}`**
- **`When I click the sidebar request {string}`** / **`When I open the sidebar request {string}`**
- **`When I rename {string} to {string} in the sidebar`**

### Workbench tabs

- **`Then a request tab for {string} should be open`** / **`Then a folder tab for {string} should be open`**
- **`Then no tab with title {string} should be open`**
- **`Then exactly {int} workbench tabs should be open`**
- **`When I focus the {string} tab`** / **`When I focus the {string} folder tab`**
- **`Then the active tab title should be {string}`**
- **`When I middle-click the tab {string}`** / **`When I right-click the tab {string} and choose close-others`**
- **`When I close every open tab in the workbench`**
- **`When I record the tab ids for folder {string} with subfolder {string} and request {string}`** — captures real index-path ids for the workbench seeder.
- **`When I seed the workbench with the recorded folder and request tabs side-by-side`** — writes a 2-group layout into persisted state.
- **`When I snapshot the current window as the final screenshot`**

### Navigation (back / forward / Ctrl+Tab / tab switcher)

- **`When I press Ctrl+Tab`** / **`When I press Ctrl+Shift+Tab`** — quick cycle between the two most-recent tabs.
- **`When I hold Ctrl and press Tab to open the tab switcher`** — opens the overlay (persists while Ctrl is held).
- **`Then the tab switcher item at index {int} should contain {string}`** — most recent = index 0.
- **`When I release Ctrl`** — dismisses the overlay / selects the highlighted item.
- **`When I click the titlebar back button`** / **`When I click the titlebar back button until {string} is open`**
- **`When I click the titlebar forward button`**
- **`Then the titlebar forward button should be disabled`**

### Request pane, URL field, path params, env

- **`When I select the {string} environment on the active request tab`** — drives the env dropdown.
- **`Then the active request tab should show the {string} environment`**
- **`When I fill the first path-param value with {string}`** — Monaco-backed VariableInputBox.
- **`Then the active request URL tooltip should be {string}`** — polls `url-container[title]` through the URLResolver round-trip.
- **`When I focus the URL field at the start`**
- **`When I type {string} character by character with delay {int} ms`** — exercises CodeEditor debounce.
- **`Then the URL field should start with {string}`**
- **`When I press Backspace in the URL field`** — implemented as `Control+Z` so Monaco's undo rolls the checksum back to the last-saved state (used by the doc-tab un-match check).
- **`When I open the request Notes tab and type {string}`** — drives the Milkdown editor.

### Docs tabs

- **`Then the folder tab Docs tab should be populated with compiled markdown`** — opens the active folder's Docs tab, locates the structured `<DocumentationHost>` (testid suffix `-documentation-host`) and asserts an H1 is present.
- **`Then the request Docs tab should be visible`** / **`Then the request Docs tab should not be visible`**

### Titlebar search

- **`When I open the search bar`** / **`When I close the search bar`**
- **`When I search for {string}`**
- **`Then I should see search results`**
- **`Then a title-bar search for {string} should return no results`**
- **`Then the title-bar search results should contain a hit mentioning {string}`**
- **`When I click on the search result containing {string}`**
- **`When I hover over the first search result`**
- **`Then the title-bar search tooltip should be visible`**

### Folder tab: breadcrumb icon, env variables, tags

- **`When I set the folder tab icon to codicon {string}`**
- **`Then the folder tab breadcrumb icon should be {string}`**
- **`When I add a variable {string} of type color to the env folder`** / **`… of type dateTime …`**
- **`Then the environment-folder variables table color picker should be visible`**
- **`Then the env folder variables should have a dateTime cell`**
- **`When I click the env folder environment named {string}`** — switch sub-env in the env-folder view.
- **`When I add tag {string} to the active folder tab`** / **`When I remove tag {string} from the active folder tab`**
- **`Then the active folder tab should have tag {string}`** / **`… should not have tag …`**
- **`When I set the color of the folder tab's {string} tag to yellow`** — driven by `__restormTestHelpers.setEnvFolderTagColor`.
- **`Then the folder tab's {string} tag should be colored yellow`** / **`Then the request tab's {string} tag should be colored yellow`**

### Dirty state & save

- **`When I save the file with Ctrl+S`**
- **`Then the file's dirty-state should be: {word}`** (`clean` / `dirty`)
- **`Then the active tab should have a dirty dot`**
- **`Then the app title should contain {string}`** / **`Then the app title should not contain {string}`** (typically `"*"`).

### Log hygiene (scenario end)

- **`Then no errors should have been logged`** — fails on any `[renderer:pageerror]`, `[renderer:error]`, or non-benign `[main:err]` line (benign patterns live in `BENIGN_LOG_PATTERNS`).

---

## Project: `open-folder`

- Feature: `bdd/open-folder/features/open-folder.feature`
- Steps: `bdd/open-folder/steps/open-folder.steps.ts`
- Fixture: `bdd/fixtures/petstore-folder.fixture.ts`

Uses the shared menu-bar + system-modals BDD step sets.

### Steps

- **`Given I configure the open folder dialog to return path {string}`** — mocks the next `showOpenDialog` with `kind: 'openDirectory'`.
- **`When I request opening a folder`** — triggers File → Open Folder.
- **`Then an open dialog should have been shown`** (from system-modals step set).
- **`Given the folder is loaded`** — waits for `Swagger Petstore` in the tree.
- **`Then I should see {string} folder`**
- **`Then I should see exactly {int} folders`**

---

## Project: `save-operations`

- Feature: `bdd/save-operations/features/save-operations.feature`
- Steps: `bdd/save-operations/steps/save-operations.steps.ts`
- Fixture: `bdd/fixtures/save-operations.fixture.ts`

### Steps

- **`Given the file is loaded`**
- **`When I open menu bar … menu …`** / **`When I click menu bar item …`** (shared menu-bar set).
- **`Then the save options modal should be open`**
- **`When I select Folder mode`** / **`When I select YAML format`** / **`When I click the Save button`**
- **`Then the folder structure should match the reference`** — compares the saved tree against the reference folder.
- **`When I enable confirmation dialog auto-confirm`**
- **`When I expand {string} in sidebar`** / **`When I click on {string} in sidebar`**
- **`When I right-click on {string} in sidebar`** / **`When I click {string} in context menu`**
- **`When I confirm the deletion`** / **`When I confirm the deletion in modal`**
- **`When I click on the breadcrumb name`** / **`When I rename it to {string}`**
- **`When I press Ctrl+S`**
- **`Then the tab should contain {string}`**
- **`Then the final folder structure should match the second reference`**

---

## Debugging a failing e2e run

Playwright attaches a screenshot + main/renderer log dump for every
failed scenario. Open both before guessing at a fix — they are under:

```
restorm/test-results/<test-dir>/attachments/
  end-state-screenshot-*.png
  failure-state.png
  electron-logs.txt
```

The UI at the point of failure usually tells you whether production
code actually broke or whether the selector / expectation is wrong.
