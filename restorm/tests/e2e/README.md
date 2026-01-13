# E2E Test Steps Documentation

This document lists all available BDD steps for Restorm E2E tests, organized by feature area.

## Table of Contents

- [Import Steps](#import-steps)
- [Open Folder Steps](#open-folder-steps)
- [Search Steps](#search-steps)
- [Save Operations Steps](#save-operations-steps)
- [Handlebars Steps](#handlebars-steps)
- [Dirty State Steps](#dirty-state-steps)

---

## Import Steps

**File:** `bdd/import/steps/import.steps.ts`

### Given Steps

- **`Given I have started the application`**
  - Parameters: none
  - Description: Verifies the application is running and the menubar is visible

- **`Given I have created a new empty file`**
  - Parameters: none
  - Description: Creates a new empty file via File > New menu

### When Steps

- **`When I click the import button`**
  - Parameters: none
  - Description: Opens the import modal using Ctrl+I

- **`When I click the import button again`**
  - Parameters: none
  - Description: Opens the import modal again using Ctrl+I

- **`When I paste {string} in the source input`**
  - Parameters: `input` (string) - Text to paste
  - Description: Pastes text into the import modal source input

- **`When I paste the path to {string} in the source input`**
  - Parameters: `filename` (string) - Filename from tests/unit directory
  - Description: Pastes the absolute path to a test file into the source input

- **`When I clear the source input`**
  - Parameters: none
  - Description: Clears the import modal source input

- **`When I click the Import button in the modal`**
  - Parameters: none
  - Description: Clicks the Import button and waits for modal to close

- **`When I open the search bar`**
  - Parameters: none
  - Description: Opens the search bar by clicking on it

- **`When I search for {string}`**
  - Parameters: `query` (string) - Search query
  - Description: Types a search query into the search input

- **`When I click on the first search result`**
  - Parameters: none
  - Description: Clicks on the first search result item

- **`When I expand the {string} folder`**
  - Parameters: `folderName` (string) - Name of the folder to expand
  - Description: Expands a folder in the import preview or sidebar

- **`When I click on the {string} request`**
  - Parameters: `requestName` (string) - Name of the request to click
  - Description: Clicks on a request item in the sidebar

- **`When I change the path param {string} to {string}`**
  - Parameters: `paramName` (string) - Path parameter name, `value` (string) - New value
  - Description: Changes a path parameter value in the PATH PARAMS pane

- **`When I select the environment {string} in the environment dropdown`**
  - Parameters: `environmentName` (string) - Name of the environment to select
  - Description: Selects an environment from the environment dropdown

- **`When I select the root node in the destination dropdown`**
  - Parameters: none
  - Description: Selects the root node in the import destination dropdown

- **`When I click the new folder button`**
  - Parameters: none
  - Description: Clicks the button to create a new folder in the import modal

- **`When I enter {string} as the folder name`**
  - Parameters: `folderName` (string) - Name for the new folder
  - Description: Enters a folder name in the new folder dialog

- **`When I click OK in the folder name dialog`**
  - Parameters: none
  - Description: Confirms the folder name dialog

- **`When I expand the {string} folder in the sidebar`**
  - Parameters: `folderName` (string) - Name of the folder to expand
  - Description: Expands a folder in the main sidebar

- **`When I wait {int} seconds to see the app state`**
  - Parameters: `seconds` (number) - Number of seconds to wait
  - Description: Waits for a specified number of seconds (for debugging/observation)

### Then Steps

- **`Then the import modal should be open`**
  - Parameters: none
  - Description: Verifies the import modal is visible

- **`Then the import modal should be closed`**
  - Parameters: none
  - Description: Verifies the import modal is not visible

- **`Then I should see import preview results`**
  - Parameters: none
  - Description: Verifies the import preview section is visible with items

- **`Then I should not see import preview results`**
  - Parameters: none
  - Description: Verifies the import preview section is hidden or empty

- **`Then I should see new items in the sidebar`**
  - Parameters: none
  - Description: Verifies new items appear in the sidebar after import

- **`Then I should see search results`**
  - Parameters: none
  - Description: Verifies search results are visible

- **`Then the first result should contain {string}`**
  - Parameters: `text` (string) - Text that should be contained in the first result
  - Description: Verifies the first search result contains the specified text

- **`Then a tab containing {string} should be open`**
  - Parameters: `tabText` (string) - Text that should be in the tab title
  - Description: Verifies a tab with the specified text is open

- **`Then the destination dropdown should show the root node`**
  - Parameters: none
  - Description: Verifies the destination dropdown shows the root node

- **`Then the destination dropdown should show all imported folders`**
  - Parameters: none
  - Description: Verifies the destination dropdown shows imported folder structure

- **`Then the request tab should be open`**
  - Parameters: none
  - Description: Verifies a request tab is open with URL container visible

- **`Then the URL tooltip should be {string}`**
  - Parameters: `expectedUrl` (string) - Expected URL in the tooltip
  - Description: Verifies the URL container tooltip matches the expected URL

- **`Then the folder {string} should be visible in the destination dropdown`**
  - Parameters: `folderName` (string) - Name of the folder to check
  - Description: Verifies a folder is visible in the destination dropdown

- **`Then the folder {string} should be selected`**
  - Parameters: `folderName` (string) - Name of the folder that should be selected
  - Description: Verifies a folder is selected in the destination dropdown

- **`Then the folder {string} should exist in the sidebar`**
  - Parameters: `folderPath` (string) - Folder name or path (e.g., "Test/Swagger Petstore")
  - Description: Verifies a folder exists in the sidebar

- **`Then I should see the subfolder {string} in the sidebar`**
  - Parameters: `folderName` (string) - Name of the subfolder to check
  - Description: Verifies a subfolder is visible in the sidebar

---

## Open Folder Steps

**File:** `bdd/open-folder/steps/open-folder.steps.ts`

### Given Steps

- **`Given the folder is loaded`**
  - Parameters: none
  - Description: Verifies the folder is loaded by checking for "Swagger Petstore" folder

### Then Steps

- **`Then I should see {string} folder`**
  - Parameters: `folderName` (string) - Name of the folder to check
  - Description: Verifies a folder is visible in the sidebar

- **`Then I should see exactly {int} folders`**
  - Parameters: `count` (number) - Expected number of folders
  - Description: Verifies exactly the specified number of folders are visible

---

## Search Steps

**File:** `bdd/search/steps/search.steps.ts`

### Given Steps

- **`Given the file is loaded`**
  - Parameters: none
  - Description: Verifies the file is loaded by checking for tree items

### When Steps

- **`When I open the search bar`**
  - Parameters: none
  - Description: Opens the search bar by clicking on it

- **`When I search for {string}`**
  - Parameters: `query` (string) - Search query
  - Description: Types a search query into the search input

- **`When I click on the first search result`**
  - Parameters: none
  - Description: Clicks on the first search result item

- **`When I hover over the first search result`**
  - Parameters: none
  - Description: Hovers over the first search result to trigger tooltip

- **`When I wait {int} seconds`**
  - Parameters: `seconds` (number) - Number of seconds to wait
  - Description: Waits for a specified number of seconds

- **`When I close the file`**
  - Parameters: none
  - Description: Closes the current file via File > Close menu

### Then Steps

- **`Then I should see search results`**
  - Parameters: none
  - Description: Verifies search results are visible

- **`Then the first result should contain {string}`**
  - Parameters: `text` (string) - Text that should be contained in the first result
  - Description: Verifies the first search result contains the specified text

- **`Then a tab containing {string} should be open`**
  - Parameters: `tabText` (string) - Text that should be in the tab title
  - Description: Verifies a tab with the specified text is open

- **`Then a tooltip should be visible`**
  - Parameters: none
  - Description: Verifies a tooltip is visible (for search result hover)

- **`Then the number of results should be {int}`**
  - Parameters: `expectedCount` (number) - Expected number of search results
  - Description: Verifies the exact number of search results

- **`Then I should see no search results`**
  - Parameters: none
  - Description: Verifies no search results are displayed

---

## Save Operations Steps

**File:** `bdd/save-operations/steps/save-operations.steps.ts`

### Given Steps

- **`Given the file is loaded`**
  - Parameters: none
  - Description: Verifies the file is loaded by checking for "Swagger Petstore" folder

### When Steps

- **`When I open the File menu`**
  - Parameters: none
  - Description: Opens the File menu

- **`When I click on {string}`**
  - Parameters: `text` (string) - Text of the menu item to click
  - Description: Clicks on a menu item with the specified text

- **`When I select Folder mode`**
  - Parameters: none
  - Description: Selects Folder mode in the save options modal

- **`When I select YAML format`**
  - Parameters: none
  - Description: Selects YAML format in the save options modal

- **`When I click the Save button`**
  - Parameters: none
  - Description: Clicks the Save button in the save options modal

- **`When I enable confirmation dialog auto-confirm`**
  - Parameters: none
  - Description: Enables auto-confirmation for dialog boxes (for tests)

- **`When I expand {string} in sidebar`**
  - Parameters: `folderName` (string) - Name of the folder to expand
  - Description: Expands a folder in the sidebar

- **`When I right-click on {string} in sidebar`**
  - Parameters: `itemName` (string) - Name of the item to right-click
  - Description: Right-clicks on an item in the sidebar to open context menu

- **`When I click {string} in context menu`**
  - Parameters: `text` (string) - Text of the context menu item to click
  - Description: Clicks on a context menu item

- **`When I confirm the deletion`**
  - Parameters: none
  - Description: Confirms deletion in a deletion confirmation modal

- **`When I confirm the deletion in modal`**
  - Parameters: none
  - Description: Confirms deletion in a modal dialog

- **`When I click on {string} in sidebar`**
  - Parameters: `itemName` (string) - Name of the item to click
  - Description: Clicks on an item in the sidebar

- **`When I click on the breadcrumb name`**
  - Parameters: none
  - Description: Clicks on the breadcrumb name to enter rename mode

- **`When I rename it to {string}`**
  - Parameters: `newName` (string) - New name for the item
  - Description: Renames an item via breadcrumb input

- **`When I press Ctrl+S`**
  - Parameters: none
  - Description: Saves the file using Ctrl+S keyboard shortcut

### Then Steps

- **`Then the save options modal should be open`**
  - Parameters: none
  - Description: Verifies the save options modal is visible

- **`Then the folder structure should match the reference`**
  - Parameters: none
  - Description: Compares the saved folder structure with the reference structure

- **`Then the tab should contain {string}`**
  - Parameters: `text` (string) - Text that should be in the tab title
  - Description: Verifies a tab contains the specified text

- **`Then the final folder structure should match the second reference`**
  - Parameters: none
  - Description: Compares the final folder structure with a second reference structure

---

## Handlebars Steps

**File:** `bdd/handlebars/steps/handlebars.steps.ts`

### Given Steps

- **`Given the Test API folder is expanded`**
  - Parameters: none
  - Description: Expands the "Test API" folder in the sidebar

### When Steps

- **`When I click on the {string} request`**
  - Parameters: `requestName` (string) - Name of the request to click
  - Description: Clicks on a request and waits for URL resolution

- **`When I change the path param {string} from {string} to {string}`**
  - Parameters: `paramName` (string) - Path parameter name, `oldValue` (string) - Current value, `newValue` (string) - New value
  - Description: Changes a path parameter value from old to new value

### Then Steps

- **`Then the URL tooltip should contain {string}`**
  - Parameters: `expectedText` (string) - Text that should be in the URL tooltip
  - Description: Verifies the URL tooltip contains the specified text

- **`Then the URL tooltip should not contain {string}`**
  - Parameters: `unexpectedText` (string) - Text that should not be in the URL tooltip
  - Description: Verifies the URL tooltip does not contain the specified text

---

## Dirty State Steps

**File:** `bdd/dirty-state/steps/dirty-state.steps.ts`

### Given Steps

- **`Given the file is loaded`**
  - Parameters: none
  - Description: Verifies the file is loaded by checking for "Swagger Petstore" folder

- **`Given the title does not contain {string}`**
  - Parameters: `text` (string) - Text that should not be in the title
  - Description: Verifies the page title does not contain the specified text

### When Steps

- **`When I click on {string} folder`**
  - Parameters: `folderName` (string) - Name of the folder to click
  - Description: Clicks on a folder to open it in a tab

- **`When I click on the Notes inner tab`**
  - Parameters: none
  - Description: Clicks on the Notes tab within a folder tab

- **`When I type {string} in the editor`**
  - Parameters: `text` (string) - Text to type in the editor
  - Description: Types text into the Notes editor

- **`When I undo multiple times`**
  - Parameters: none
  - Description: Performs multiple undo operations (Ctrl+Z 20 times)

- **`When I modify an input field`**
  - Parameters: none
  - Description: Modifies an input field to trigger dirty state

### Then Steps

- **`Then a tab should be open`**
  - Parameters: none
  - Description: Verifies at least one tab is open

- **`Then the tab should not have a dirty indicator`**
  - Parameters: none
  - Description: Verifies the tab does not show a dirty indicator

- **`Then the tab should have a dirty indicator`**
  - Parameters: none
  - Description: Verifies the tab shows a dirty indicator

- **`Then the title should contain {string}`**
  - Parameters: `text` (string) - Text that should be in the page title
  - Description: Verifies the page title contains the specified text

- **`Then the title should not contain {string}`**
  - Parameters: `text` (string) - Text that should not be in the page title
  - Description: Verifies the page title does not contain the specified text

---

## Parameter Types

### String Parameters
- `{string}` - A quoted string value (e.g., `"My Folder"`, `"GET /users"`)

### Integer Parameters
- `{int}` - An integer value (e.g., `5`, `10`)

---

## Notes

- All steps use Playwright-BDD for implementation
- Steps are organized by feature area in separate files
- Some steps may have timeouts configured internally
- Steps automatically wait for UI elements to be ready before interacting
- Screenshots may be taken during certain steps for debugging purposes
