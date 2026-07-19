import { createBdd } from 'playwright-bdd'
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { configureNextOpenDialogForE2E, listViewRowSelectorByTitle } from 'electron-core-ui/testing'
import { test, expect, currentElectronApp } from '../../fixtures/git-integration.fixture'
import { gitServerUrlFor, gitEnv } from '../../../../integration/gitServerSeed'

const { Given, When, Then } = createBdd(test)

let page: Page | null = null
// The repo THIS scenario is working against. Both scenarios in this suite
// mutate the remote (push, or a collaborator pushing a conflicting change),
// so each gets its OWN freshly-seeded repo rather than sharing the single
// `seed-project.git` — two mutating scenarios racing on the same remote is
// real cross-test contamination (it's what broke the first live run: a
// collaborator-renamed request from the pull scenario leaked into the push
// scenario's "open the seed project" assertion). Each scenario's OWN first
// step sets this UNCONDITIONALLY (never inferred from leftover state, which
// would be fragile to Playwright reusing a worker's module instance across
// tests in the same file) — see the two distinctly-worded "Given" steps
// below, one per scenario, rather than a single shared/branching step.
let activeRepoName: string | null = null
// The on-disk working copy restorm opened, so the unsaved-edits scenario can
// read the file back and prove the edit was persisted (never clobbered).
let openedWorkingCopy: string | null = null
// A distinctive fragment typed into the request URL as an unsaved local edit.
const UNSAVED_EDIT_MARKER = 'unsaved-local-edit'

function requirePage(): Page {
  if (!page) throw new Error('app must be launched before driving UI steps')
  return page
}

function requireApp(): ElectronApplication {
  const app = currentElectronApp()
  if (!app) throw new Error('app must be launched before configuring dialogs')
  return app
}

function sidebarRowByName(p: Page, name: string): Locator {
  return p.locator(listViewRowSelectorByTitle('sidebar-listview', name))
}

Given('I open a project cloned from a freshly seeded git remote', async ({ launchApp, seedFreshRepo }) => {
  const launched = await launchApp()
  page = launched.page

  activeRepoName = `git-push-pull-${Date.now()}`
  const filePath = await seedFreshRepo(activeRepoName)

  await configureNextOpenDialogForE2E(requireApp(), { kind: 'openFile', path: filePath })
  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await page.locator('[data-testid="titlebar-menu-item-open"]').first().click()
  // Scoped to the sidebar — "Seed Project" also renders as a mosaic-card
  // heading elsewhere on the page, so the bare page-wide `getByText` is a
  // strict-mode violation (2 matches).
  await expect(page.locator('[data-testid="sidebar-listview"]').getByText('Seed Project', { exact: true })).toBeVisible({ timeout: 10000 })
})

Given('I open my own clone of that same remote', async ({ launchApp, cloneNamedRepo }) => {
  if (!activeRepoName) throw new Error('no active repo — a "...freshly seeded git remote" step must run first')
  const launched = await launchApp()
  page = launched.page

  const workingCopy = await cloneNamedRepo(activeRepoName, 'git-push-pull-open')
  const filePath = join(workingCopy, 'api.restorm')

  await configureNextOpenDialogForE2E(requireApp(), { kind: 'openFile', path: filePath })
  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await page.locator('[data-testid="titlebar-menu-item-open"]').first().click()
  // Scoped to the sidebar — "Seed Project" also renders as a mosaic-card
  // heading elsewhere on the page, so the bare page-wide `getByText` is a
  // strict-mode violation (2 matches).
  await expect(page.locator('[data-testid="sidebar-listview"]').getByText('Seed Project', { exact: true })).toBeVisible({ timeout: 10000 })
})

async function activateRequestSubTab(p: Page): Promise<void> {
  const tab = p.locator('[role="tab"][data-testid="base-request-tabs-request-tab-request"]:visible').first()
  if ((await tab.count()) === 0) return
  const alreadySelected = await tab.getAttribute('aria-selected')
  if (alreadySelected === 'true') return
  await tab.click()
  await p.waitForTimeout(200)
}

When('I change the request\'s URL and push', async () => {
  const p = requirePage()

  const row = sidebarRowByName(p, 'Find pet by ID')
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.click()
  await p.waitForTimeout(300)
  await activateRequestSubTab(p)

  const urlInput = p.locator('[data-testid="http-request-url-input"]:visible').first()
  await expect(urlInput).toBeVisible({ timeout: 5000 })
  const viewport = urlInput.locator('.monaco-editor').first()
  await viewport.click({ force: true })
  await p.keyboard.press('Control+A')
  await p.keyboard.press('Delete')
  await p.keyboard.type('https://petstore.example.com/pets/1?pushed=true')
  await p.keyboard.press('Tab')
  await p.waitForTimeout(300)

  await p.locator('[data-testid="statusbar-git-indicator-push"]').click()
  const modal = p.locator('[data-testid="push-modal"]')
  await expect(modal).toBeVisible({ timeout: 10000 })
  // The generated title is non-empty only when the diff actually found a
  // change — a regression guard against the URL edit silently not landing
  // before the diff ran. Note the double `-input` suffix: InputBox renders
  // a hidden state-probe div at the BARE test id and the real <input> one
  // level deeper, at `${dataTestId}-input`.
  const titleValue = await modal.locator('[data-testid="push-modal-title-input-input"]').inputValue()
  expect(titleValue).not.toBe('')
  await modal.locator('[data-testid="push-modal-push-button"]').click()
  // `usePushModal.push()` only calls `setIsOpen(false)` on the SUCCESS path
  // (a failed commit/push shows a toast and leaves the modal open) — the
  // modal closing IS the success signal, cross-checked against the remote
  // in the Then step below.
  await expect(modal).not.toBeVisible({ timeout: 10000 })
})

Then('the remote has the pushed change', async ({ gitIntegrationRoot }) => {
  if (!activeRepoName) throw new Error('no active repo — "I open a project..." must run first')
  const verifyDir = join(gitIntegrationRoot, 'push-verify-clone')
  rmSync(verifyDir, { recursive: true, force: true })
  execSync(`git clone "${gitServerUrlFor(activeRepoName)}" "${verifyDir}"`, { stdio: 'ignore', env: gitEnv() })
  const content = readFileSync(join(verifyDir, 'api.restorm'), 'utf-8')
  expect(content).toContain('pushed=true')
})

Given('another collaborator has pushed a change to a freshly seeded git remote', async ({ seedFreshRepo, cloneNamedRepo }) => {
  activeRepoName = `git-pull-${Date.now()}`
  await seedFreshRepo(activeRepoName) // establishes the repo; the "I open my own clone" step reuses it via `activeRepoName`

  const collaboratorDir = await cloneNamedRepo(activeRepoName, 'git-pull-collaborator')
  const projectFile = join(collaboratorDir, 'api.restorm')
  const content = readFileSync(projectFile, 'utf-8')
  writeFileSync(projectFile, content.replace('Find pet by ID', 'Find pet by ID (updated by collaborator)'), 'utf-8')
  execSync('git add api.restorm', { cwd: collaboratorDir, stdio: 'ignore', env: gitEnv() })
  execSync('git -c user.email=collaborator@restorm.test -c user.name="Other Collaborator" commit -m "Collaborator update"', { cwd: collaboratorDir, stdio: 'ignore', env: gitEnv() })
  execSync('git push origin main', { cwd: collaboratorDir, stdio: 'ignore', env: gitEnv() })
})

When('I pull', async () => {
  const p = requirePage()
  await p.locator('[data-testid="statusbar-git-indicator-pull"]').click()
  await p.waitForTimeout(1000)
})

Then('the collaborator\'s change is visible', async () => {
  const p = requirePage()
  await expect(p.getByText('Find pet by ID (updated by collaborator)', { exact: true })).toBeVisible({ timeout: 10000 })
})

Given('I have opened a clone of a freshly seeded git remote', async ({ launchApp, seedFreshRepo, cloneNamedRepo }) => {
  const launched = await launchApp()
  page = launched.page

  activeRepoName = `git-pull-refresh-${Date.now()}`
  await seedFreshRepo(activeRepoName)

  const workingCopy = await cloneNamedRepo(activeRepoName, 'git-pull-refresh-open')
  openedWorkingCopy = workingCopy
  const filePath = join(workingCopy, 'api.restorm')

  await configureNextOpenDialogForE2E(requireApp(), { kind: 'openFile', path: filePath })
  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await page.locator('[data-testid="titlebar-menu-item-open"]').first().click()
  // The clone is opened BEFORE any collaborator push, so at this point the
  // sidebar shows the ORIGINAL request name — the pull under test is what must
  // bring in the collaborator's rename.
  await expect(sidebarRowByName(page, 'Find pet by ID')).toBeVisible({ timeout: 10000 })
})

When('a collaborator pushes a change to that same remote', async ({ cloneNamedRepo }) => {
  if (!activeRepoName) throw new Error('no active repo — a "...opened a clone..." step must run first')
  const collaboratorDir = await cloneNamedRepo(activeRepoName, 'git-pull-refresh-collaborator')
  const projectFile = join(collaboratorDir, 'api.restorm')
  const content = readFileSync(projectFile, 'utf-8')
  writeFileSync(projectFile, content.replace('Find pet by ID', 'Find pet by ID (updated by collaborator)'), 'utf-8')
  execSync('git add api.restorm', { cwd: collaboratorDir, stdio: 'ignore', env: gitEnv() })
  execSync('git -c user.email=collaborator@restorm.test -c user.name="Other Collaborator" commit -m "Collaborator update"', { cwd: collaboratorDir, stdio: 'ignore', env: gitEnv() })
  execSync('git push origin main', { cwd: collaboratorDir, stdio: 'ignore', env: gitEnv() })
})

Then('the collaborator\'s change is visible without reopening the project', async () => {
  const p = requirePage()
  // The pulled rename must appear with NO manual reload — this is the whole
  // point of the fix. `getByText(exact)` fails if the sidebar is still stale
  // (old code left the pre-pull tree untouched).
  await expect(p.getByText('Find pet by ID (updated by collaborator)', { exact: true })).toBeVisible({ timeout: 10000 })
  // Exactly one matching row — the tree re-hydrated in place rather than
  // appending a duplicate row/tab (the row selector is a substring match, so
  // the renamed row still matches the pre-rename fragment).
  await expect(sidebarRowByName(p, 'Find pet by ID')).toHaveCount(1)
})

Given('I have the request open in a tab showing its original URL', async () => {
  const p = requirePage()
  const row = sidebarRowByName(p, 'Find pet by ID')
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.click()
  await p.waitForTimeout(300)
  await activateRequestSubTab(p)

  const urlInput = p.locator('[data-testid="http-request-url-input"]:visible').first()
  await expect(urlInput).toBeVisible({ timeout: 5000 })
  // The seed URL ends in /pets/1. Asserting it here pins the pre-pull state so
  // the post-pull assertion genuinely proves the OPEN tab re-read the model
  // (rather than the tab having shown /pets/3 all along).
  await expect(urlInput).toContainText('petstore.example.com/pets/1', { timeout: 5000 })
})

When('a collaborator pushes a URL change to that same remote', async ({ cloneNamedRepo }) => {
  if (!activeRepoName) throw new Error('no active repo — a "...opened a clone..." step must run first')
  const collaboratorDir = await cloneNamedRepo(activeRepoName, 'git-pull-tab-refresh-collaborator')
  const projectFile = join(collaboratorDir, 'api.restorm')
  const content = readFileSync(projectFile, 'utf-8')
  // Change the request's URL (petId 1 → 3) — the value shown in the OPEN tab's
  // URL editor, so the pull has to reach the editor, not just the sidebar.
  writeFileSync(projectFile, content.replace('pets/1', 'pets/3'), 'utf-8')
  execSync('git add api.restorm', { cwd: collaboratorDir, stdio: 'ignore', env: gitEnv() })
  execSync('git -c user.email=collaborator@restorm.test -c user.name="Other Collaborator" commit -m "Collaborator URL update"', { cwd: collaboratorDir, stdio: 'ignore', env: gitEnv() })
  execSync('git push origin main', { cwd: collaboratorDir, stdio: 'ignore', env: gitEnv() })
})

Then('the open request tab shows the pulled URL without reopening it', async () => {
  const p = requirePage()
  const urlInput = p.locator('[data-testid="http-request-url-input"]:visible').first()
  // The tab was opened BEFORE the pull and never closed/reopened; its URL
  // editor must now show the pulled value. The pre-fix behaviour kept /pets/1.
  await expect(urlInput).toContainText('petstore.example.com/pets/3', { timeout: 10000 })
  await expect(urlInput).not.toContainText('petstore.example.com/pets/1', { timeout: 5000 })
  // Exactly one URL editor visible — the refresh re-rendered the tab in place,
  // it did not spawn a duplicate tab.
  await expect(p.locator('[data-testid="http-request-url-input"]:visible')).toHaveCount(1)
})

Given('I have an unsaved local edit to the open request', async () => {
  const p = requirePage()
  const row = sidebarRowByName(p, 'Find pet by ID')
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.click()
  await p.waitForTimeout(300)
  await activateRequestSubTab(p)

  const urlInput = p.locator('[data-testid="http-request-url-input"]:visible').first()
  await expect(urlInput).toBeVisible({ timeout: 5000 })
  const viewport = urlInput.locator('.monaco-editor').first()
  await viewport.click({ force: true })
  await p.keyboard.press('Control+A')
  await p.keyboard.press('Delete')
  await p.keyboard.type(`https://petstore.example.com/pets/${UNSAVED_EDIT_MARKER}`)
  await p.keyboard.press('Tab')
  await p.waitForTimeout(300)
  // Deliberately NOT saved and NOT pushed — the point is that the pull is what
  // has to persist this edit (save-first) and must not lose it.
})

Then('my unsaved edit is preserved on disk', async () => {
  if (!openedWorkingCopy) throw new Error('no opened working copy — an "...opened a clone..." step must run first')
  // Pull saves first, so the edit must have been written to the .restorm file;
  // git then refuses to merge over it, so it survives on disk untouched.
  const onDisk = readFileSync(join(openedWorkingCopy, 'api.restorm'), 'utf-8')
  expect(onDisk).toContain(UNSAVED_EDIT_MARKER)
})

Then('I am told to push my changes before pulling', async () => {
  const p = requirePage()
  // The dedicated "you have unpushed changes — push first" toast, not the
  // generic pull-failed body.
  await expect(p.getByText('Push them first', { exact: false })).toBeVisible({ timeout: 10000 })
})

Then('the collaborator\'s change is not applied', async () => {
  const p = requirePage()
  // The refused pull merged nothing, so the sidebar still shows the original
  // name and never the collaborator's rename.
  await expect(p.getByText('Find pet by ID (updated by collaborator)', { exact: true })).toHaveCount(0)
  await expect(sidebarRowByName(p, 'Find pet by ID')).toHaveCount(1)
})
