import { createBdd } from 'playwright-bdd'
import type { ElectronApplication, Page } from '@playwright/test'
import { configureNextOpenDialogForE2E } from 'electron-core-ui/testing'
import { test, expect, currentElectronApp } from '../../fixtures/git-integration.fixture'

const { Given, Then } = createBdd(test)

let page: Page | null = null

function requirePage(): Page {
  if (!page) throw new Error('app must be launched before driving UI steps')
  return page
}

function requireApp(): ElectronApplication {
  const app = currentElectronApp()
  if (!app) throw new Error('app must be launched before configuring dialogs')
  return app
}

Given('I open a project cloned from the seed git remote', async ({ launchApp, cloneSeedRepo }) => {
  const launched = await launchApp()
  page = launched.page

  const filePath = await cloneSeedRepo('git-status-open')
  await configureNextOpenDialogForE2E(requireApp(), { kind: 'openFile', path: filePath })
  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await page.locator('[data-testid="titlebar-menu-item-open"]').first().click()

  // "Find pet by ID" is the seed project's one request — its presence in the
  // sidebar confirms the git-tracked file actually loaded, not just that the
  // open dialog resolved.
  await expect(page.getByText('Find pet by ID', { exact: true })).toBeVisible({ timeout: 10000 })
})

Then('the status-bar GIT entry is visible and enabled', async () => {
  const p = requirePage()
  // `GatedControl` renders a transparent `<>{children}</>` passthrough (no
  // wrapper markup, so no `[data-testid="statusbar-git-indicator-gate"]`
  // element exists at all) when `locked=false` — see GatedControl.tsx.
  // "Enabled" is therefore asserted straight on the inner ECUI indicator's
  // own test id, which only mounts once the 3-state gate resolves to
  // enabled (Pro + a real git repo — never "Pro + no-repo" or "Community").
  const pushButton = p.locator('[data-testid="statusbar-git-indicator-push"]')
  await expect(pushButton).toBeVisible({ timeout: 10000 })
})
