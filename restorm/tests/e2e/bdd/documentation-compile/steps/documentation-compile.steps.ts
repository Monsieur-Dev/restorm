import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/import.fixture'

const bdd = createBdd(test)
const { When, Then } = bdd

// Menubar + system-modals steps come in via the shared `import` step file,
// which this project pulls in as a co-loaded step source (see
// `playwright.config.ts`).

// Steps here deliberately share test-ids with the existing `import` feature so
// that no duplication is introduced. Any helper step (import button, source
// input, etc.) comes in via the import.steps.ts file loaded alongside this
// module in playwright.config.

When('I select the imported root folder', async ({ page }) => {
  // The root folder is the first `folder-library` icon in the sidebar — each
  // EnvironmentFolder is rendered with that icon. Clicking selects it and
  // activates its view in the workbench.
  const rootItem = page.locator('[role="tree"] [role="treeitem"]').first()
  await expect(rootItem).toBeVisible({ timeout: 10000 })
  await rootItem.click()
})

Then('the folder Docs tab should be populated with compiled markdown', async ({ page }) => {
  // Scope to the folder-view tab bar (data-testid prefix
  // `folder-view-<id>-tabs`) to avoid matching the request-view Docs tab
  // that can stick around from a previous scenario.
  const folderTabs = page.locator('[data-testid^="folder-view-"][data-testid$="-tabs"]').first()
  const docsTab = folderTabs.locator('[role="tab"]').filter({ hasText: /^Docs$/ }).first()
  if (await docsTab.count() > 0) {
    await docsTab.click()
  }
  const docsViewer = page.locator('[data-testid$="-markdown-viewer-docs"]').first()
  await expect(docsViewer).toBeVisible({ timeout: 10000 })
  // The compiled markdown always starts with the API title (`# Title`).
  // Check the rendered content has at least one H1 heading.
  const heading = docsViewer.locator('h1').first()
  await expect(heading).toBeVisible({ timeout: 10000 })
  const headingText = await heading.textContent()
  expect(headingText?.trim().length ?? 0).toBeGreaterThan(0)
})
