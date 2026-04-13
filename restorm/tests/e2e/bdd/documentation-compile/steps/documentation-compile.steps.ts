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
  // BaseFolderView renders the compiled root markdown in a
  // `folder-view-<id>-markdown-viewer-docs` element. We don't know the id
  // upfront, so match on the suffix.
  const docsViewer = page.locator('[data-testid$="-markdown-viewer-docs"]').first()
  // The Docs tab may not be active by default (Configuration is the default for
  // EnvironmentFolders) — activate it explicitly.
  const docsTab = page.locator('[role="tab"]').filter({ hasText: /^Docs$/ }).first()
  if (await docsTab.count() > 0) {
    await docsTab.click()
  }
  await expect(docsViewer).toBeVisible({ timeout: 10000 })
  // The compiled markdown always starts with the API title (`# Title`).
  // Check the rendered content has at least one H1 heading.
  const heading = docsViewer.locator('h1').first()
  await expect(heading).toBeVisible({ timeout: 10000 })
  const headingText = await heading.textContent()
  expect(headingText?.trim().length ?? 0).toBeGreaterThan(0)
})
