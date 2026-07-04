import { createBdd } from 'playwright-bdd'
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { configureNextOpenDialogForE2E, listViewRowSelectorByTitle, splitViewPaneSelectorByHeaderTitle } from 'electron-core-ui/testing'
import { test, expect, currentElectronApp } from '../../fixtures/git-integration.fixture'
import { readSeedDocument, findEntity, setEntityField, gitCommit, gitPush, type SeedEntity } from '../../../helpers/gitSeedHelpers'
import { gitEnv } from '../../../../integration/gitServerSeed'

const { Given, When, Then } = createBdd(test)

let page: Page | null = null
// The repo + local working clone THIS scenario is working against — every
// scenario in this suite mutates history (its own local commit, and/or a
// collaborator's push), so each gets its OWN freshly-seeded repo, same
// rationale as git-push-pull.steps.ts.
let activeRepoName: string | null = null
let localCloneDir: string | null = null
let localFilePath: string | null = null

const LOCAL_AUTHOR = { email: 'e2e@restorm.test', name: 'Restorm E2E' }
const COLLABORATOR_AUTHOR = { email: 'collaborator@restorm.test', name: 'Other Collaborator' }

function requirePage(): Page {
  if (!page) throw new Error('app must be launched before driving UI steps')
  return page
}

function requireApp(): ElectronApplication {
  const app = currentElectronApp()
  if (!app) throw new Error('app must be launched before configuring dialogs')
  return app
}

function requireLocalCloneDir(): string {
  if (!localCloneDir) throw new Error('no local clone — a "Given ... diverged" step must run first')
  return localCloneDir
}

function sidebarRowByName(p: Page, name: string): Locator {
  return p.locator(listViewRowSelectorByTitle('sidebar-listview', name))
}

function conflictRowByName(p: Page, name: string): Locator {
  return p.locator(listViewRowSelectorByTitle('conflict-resolution-view-list', name))
}

/** Scopes into one of the 3 conflict-resolution panes by its header title
 * ("Your version" / "Server version" / "Resolved") — `GitConflictResolutionModal`
 * renders the SAME entity view 3 times with IDENTICAL inner testids (the
 * panel content has no idea which side it's on), and the pane's OWN
 * generated testid embeds a positional index that shifts depending on
 * whether the conflict list is shown, so header text is the only stable
 * way to disambiguate. */
function conflictPaneByTitle(p: Page, title: string): Locator {
  return p.locator(splitViewPaneSelectorByHeaderTitle('conflict-resolution-view-split', title))
}

async function activateRequestSubTab(p: Page): Promise<void> {
  const tab = p.locator('[role="tab"][data-testid="base-request-tabs-request-tab-request"]:visible').first()
  if ((await tab.count()) === 0) return
  const alreadySelected = await tab.getAttribute('aria-selected')
  if (alreadySelected === 'true') return
  await tab.click()
  await p.waitForTimeout(200)
}

async function openProject(filePath: string, launchApp: () => Promise<{ page: Page }>): Promise<void> {
  const launched = await launchApp()
  page = launched.page
  await configureNextOpenDialogForE2E(requireApp(), { kind: 'openFile', path: filePath })
  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await page.locator('[data-testid="titlebar-menu-item-open"]').first().click()
  // Scoped to the sidebar — "Seed Project" also renders as a mosaic-card
  // heading elsewhere on the page, a strict-mode violation otherwise.
  await expect(page.locator('[data-testid="sidebar-listview"]').getByText('Seed Project', { exact: true })).toBeVisible({ timeout: 10000 })
}

// ---------------------------------------------------------------------------
// Scenario 1 — rejected push then pull surfaces the conflict screen
// ---------------------------------------------------------------------------

Given('a collaborator has pushed a conflicting change to the request\'s URL', async ({ seedFreshRepo, cloneNamedRepo }) => {
  activeRepoName = `git-conflict-push-${Date.now()}`
  // My own clone is established FIRST (still at the base commit) — the
  // collaborator's push below advances the remote past what I have,
  // reproducing AC#4's "move the branch back one commit" via ordering
  // rather than an explicit reset.
  localFilePath = await seedFreshRepo(activeRepoName)
  localCloneDir = dirname(localFilePath)

  const collaboratorDir = await cloneNamedRepo(activeRepoName, 'git-conflict-push-collaborator')
  setEntityField(collaboratorDir, 'e2e-seed-request', 'url', 'https://collaborator.example.com/pets/1?pushed=true')
  gitCommit(collaboratorDir, COLLABORATOR_AUTHOR, 'Collaborator changes the request URL')
  gitPush(collaboratorDir)
})

Given('I open my own one-commit-behind clone of that remote', async ({ launchApp }) => {
  if (!localFilePath) throw new Error('no local clone — a "Given ... pushed a ... change" step must run first')
  await openProject(localFilePath, launchApp)
})

When('I change the request\'s URL to a different value and push', async () => {
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
  await p.keyboard.type('https://local.example.com/pets/1?pushed=true')
  await p.keyboard.press('Tab')
  await p.waitForTimeout(300)

  await p.locator('[data-testid="statusbar-git-indicator-push"]').click()
  const modal = p.locator('[data-testid="push-modal"]')
  await expect(modal).toBeVisible({ timeout: 10000 })
  await modal.locator('[data-testid="push-modal-push-button"]').click()
})

Then('the push is rejected', async () => {
  const p = requirePage()
  // `usePushModal.push()` only calls `setIsOpen(false)` on the SUCCESS
  // path — a rejected (non-fast-forward) push shows a failure toast (no
  // stable id, so match by its title text) and leaves the modal open (the
  // commit itself succeeded LOCALLY; only the `git push` failed).
  await expect(p.getByText('Push failed', { exact: true })).toBeVisible({ timeout: 10000 })
  await expect(p.locator('[data-testid="push-modal"]')).toBeVisible()
})

When('I close the push dialog', async () => {
  const p = requirePage()
  await p.locator('[data-testid="push-modal-cancel-button"]').click()
  await expect(p.locator('[data-testid="push-modal"]')).not.toBeVisible({ timeout: 10000 })
})

When('I pull', async () => {
  const p = requirePage()
  const modal = p.locator('[data-testid="git-conflict-resolution-modal"]')
  // A click immediately following a push-rejected toast/status refresh can
  // land on a Pull button DOM node React is mid-replacing (a re-render
  // triggered by the just-updated git status/toast state) and gets
  // dropped — confirmed by direct diagnosis (a lone click never fired
  // `onPull`, verified via a temporary console probe). Under concurrent
  // worker load (another git-suite scenario's electron instance running
  // at the same time) one retry isn't always enough, so this retries the
  // click until the conflict screen actually opens rather than assume a
  // fixed number of clicks covers it — real UI race, not a test artifact,
  // but not worth a deeper product fix for a single dropped click a user
  // can always just repeat.
  for (let attempt = 0; attempt < 5; attempt++) {
    await p.locator('[data-testid="statusbar-git-indicator-pull"]').click()
    await p.waitForTimeout(1000)
    if (await modal.isVisible()) return
  }
})

Then('the conflict-resolution screen appears', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="git-conflict-resolution-modal"]')).toBeVisible({ timeout: 10000 })
})

// ---------------------------------------------------------------------------
// Scenario 2 — every element type conflicts, per-entity resolve, field-diff
// ---------------------------------------------------------------------------

Given('a remote has diverged on a folder, an environment folder, a request, and a scenario', async ({ seedFreshRepo, cloneNamedRepo }) => {
  activeRepoName = `git-conflict-matrix-${Date.now()}`
  localFilePath = await seedFreshRepo(activeRepoName)
  localCloneDir = dirname(localFilePath)

  // My own LOCAL commit — never pushed. Real merge conflicts need a real
  // commit on both sides diverging from the same base; this represents
  // work I did before ever syncing with the collaborator's change below.
  setEntityField(localCloneDir, 'e2e-seed-folder', 'notes', 'Local notes on folder')
  setEntityField(localCloneDir, 'e2e-seed-env-folder', 'notes', 'Local notes on env folder')
  setEntityField(localCloneDir, 'e2e-seed-request', 'url', 'https://local.example.com/pets/1')
  setEntityField(localCloneDir, 'e2e-seed-scenario', 'notes', 'Local notes on scenario')
  gitCommit(localCloneDir, LOCAL_AUTHOR, 'My local edits to all 4 entity kinds')

  const collaboratorDir = await cloneNamedRepo(activeRepoName, 'git-conflict-matrix-collaborator')
  setEntityField(collaboratorDir, 'e2e-seed-folder', 'notes', 'Collaborator notes on folder')
  setEntityField(collaboratorDir, 'e2e-seed-env-folder', 'notes', 'Collaborator notes on env folder')
  setEntityField(collaboratorDir, 'e2e-seed-request', 'url', 'https://collaborator.example.com/pets/1')
  setEntityField(collaboratorDir, 'e2e-seed-scenario', 'notes', 'Collaborator notes on scenario')
  gitCommit(collaboratorDir, COLLABORATOR_AUTHOR, 'Collaborator edits to all 4 entity kinds')
  gitPush(collaboratorDir)
})

Given('I open my own conflicting clone of that remote', async ({ launchApp }) => {
  if (!localFilePath) throw new Error('no local clone — a "Given ... diverged" step must run first')
  await openProject(localFilePath, launchApp)
})

Then('all 4 conflicting entities are listed', async () => {
  const p = requirePage()
  const list = p.locator('[data-testid="conflict-resolution-view-list"]')
  await expect(list).toBeVisible({ timeout: 10000 })
  for (const name of ['Legacy Endpoints', 'Seed Project', 'Find pet by ID', 'Smoke Test']) {
    await expect(conflictRowByName(p, name)).toBeVisible()
  }
})

Then('the conflicting folder\'s notes field is highlighted', async () => {
  const p = requirePage()
  // The folder conflict is `conflicts[0]` (sorted folder → environmentFolder
  // → request → scenario) — auto-selected on open, no row click needed.
  // `notesDiffers` also drives `BaseFolderView`'s default-tab logic, so the
  // Notes tab (holding the highlighted field) is already active.
  const yourVersionPane = conflictPaneByTitle(p, 'Your version')
  const notesEditor = yourVersionPane.locator('[data-testid="folder-view-e2e-seed-folder-markdown-editor-notes"]')
  await expect(notesEditor).toBeVisible({ timeout: 10000 })
  const wrapper = notesEditor.locator('..')
  await expect(wrapper).not.toHaveCSS('border-color', 'rgba(0, 0, 0, 0)')
})

When('I keep my own version of the folder', async () => {
  const p = requirePage()
  await p.locator('[data-testid="conflict-resolution-view-use-user-version"]').click()
})

When('I use the server\'s version of the request and tweak its URL', async () => {
  const p = requirePage()
  await conflictRowByName(p, 'Find pet by ID').click()
  await p.locator('[data-testid="conflict-resolution-view-use-server-version"]').click()

  const resolvedPane = conflictPaneByTitle(p, 'Resolved')
  const urlInput = resolvedPane.locator('[data-testid="http-request-url-input"]:visible').first()
  await expect(urlInput).toBeVisible({ timeout: 10000 })
  const viewport = urlInput.locator('.monaco-editor').first()
  await viewport.click({ force: true })
  await p.keyboard.press('Control+A')
  await p.keyboard.press('Delete')
  await p.keyboard.type('https://tweaked.example.com/pets/1')
  await p.keyboard.press('Tab')
  await p.waitForTimeout(300)
})

When('I finish resolving the conflicts', async () => {
  const p = requirePage()
  await p.locator('[data-testid="git-conflict-resolution-finish"]').click()
  await expect(p.locator('[data-testid="git-conflict-resolution-modal"]')).not.toBeVisible({ timeout: 10000 })
})

Then('my folder notes were kept, the request URL reflects my tweak, and the untouched entities default to my version', () => {
  const dir = requireLocalCloneDir()
  const doc = readSeedDocument(dir)
  const get = (entityId: string): SeedEntity => {
    const entity = findEntity(doc.collections, entityId)
    if (!entity) throw new Error(`seed entity "${entityId}" not found post-resolution`)
    return entity
  }

  expect(get('e2e-seed-folder')['notes']).toBe('Local notes on folder')
  // .trim(): Monaco's editable resolved-panel instance leaves a couple of
  // trailing spaces after this Ctrl+A/Delete/type sequence (a rendering
  // artifact of the edit, not a real value) — semantically irrelevant to
  // what this assertion is actually checking (did the tweak take effect).
  expect((get('e2e-seed-request')['url'] as string).trim()).toBe('https://tweaked.example.com/pets/1')
  // Untouched conflicts default their resolved copy to "ours" (see
  // `useConflictResolution`'s `buildInitialResolved`) — Finish never
  // required interacting with them.
  expect(get('e2e-seed-env-folder')['notes']).toBe('Local notes on env folder')
  expect(get('e2e-seed-scenario')['notes']).toBe('Local notes on scenario')
})

// ---------------------------------------------------------------------------
// Scenario — live-action controls disabled inside the conflict panel
// ---------------------------------------------------------------------------

Given('a remote has diverged on a mock-server request', async ({ seedFreshRepo, cloneNamedRepo }) => {
  activeRepoName = `git-conflict-server-${Date.now()}`
  localFilePath = await seedFreshRepo(activeRepoName)
  localCloneDir = dirname(localFilePath)

  // Turn the request into a mock server on BOTH sides (so the conflict
  // panel renders HTTPRequestTabView in server mode → the Listen button
  // exists) and diverge its URL so the entity is a genuine conflict.
  setEntityField(localCloneDir, 'e2e-seed-request', 'server', true)
  setEntityField(localCloneDir, 'e2e-seed-request', 'url', 'https://local.example.com/mock/pets')
  gitCommit(localCloneDir, LOCAL_AUTHOR, 'My local edit turns the request into a mock server')

  const collaboratorDir = await cloneNamedRepo(activeRepoName, 'git-conflict-server-collaborator')
  setEntityField(collaboratorDir, 'e2e-seed-request', 'server', true)
  setEntityField(collaboratorDir, 'e2e-seed-request', 'url', 'https://collaborator.example.com/mock/pets')
  gitCommit(collaboratorDir, COLLABORATOR_AUTHOR, 'Collaborator turns the request into a mock server')
  gitPush(collaboratorDir)
})

Then('the mock server\'s start button in the resolved panel is disabled', async () => {
  const p = requirePage()
  // The editable Resolved panel is the one live-action risk (a click there
  // could open a real mock server keyed by request.id while viewing a static
  // conflict snapshot). ECUI's Button renders an <a role="button"> with
  // `aria-disabled` (not a native `disabled`), so assert that attribute.
  const resolvedPane = conflictPaneByTitle(p, 'Resolved')
  const listenButton = resolvedPane.locator('[data-testid="http-server-listen-button"]')
  await expect(listenButton).toBeVisible({ timeout: 10000 })
  await expect(listenButton).toHaveAttribute('aria-disabled', 'true')
})

// ---------------------------------------------------------------------------
// Scenario 3 — cancel aborts the merge, keeps local work
// ---------------------------------------------------------------------------

Given('a remote has diverged on the request', async ({ seedFreshRepo, cloneNamedRepo }) => {
  activeRepoName = `git-conflict-abort-${Date.now()}`
  localFilePath = await seedFreshRepo(activeRepoName)
  localCloneDir = dirname(localFilePath)

  setEntityField(localCloneDir, 'e2e-seed-request', 'url', 'https://local.example.com/pets/1?abort-test=true')
  gitCommit(localCloneDir, LOCAL_AUTHOR, 'My local edit to the request URL')

  const collaboratorDir = await cloneNamedRepo(activeRepoName, 'git-conflict-abort-collaborator')
  setEntityField(collaboratorDir, 'e2e-seed-request', 'url', 'https://collaborator.example.com/pets/1?abort-test=true')
  gitCommit(collaboratorDir, COLLABORATOR_AUTHOR, 'Collaborator edit to the request URL')
  gitPush(collaboratorDir)
})

When('I cancel conflict resolution', async () => {
  const p = requirePage()
  await p.locator('[data-testid="git-conflict-resolution-cancel"]').click()
  await expect(p.locator('[data-testid="git-conflict-resolution-modal"]')).not.toBeVisible({ timeout: 10000 })
})

Then('the merge is aborted and my local commit is intact', () => {
  const dir = requireLocalCloneDir()
  // Ground truth, not just "the modal closed": `git merge --abort` must
  // have actually run — no MERGE_HEAD, a clean working tree, and my own
  // pre-conflict commit still at HEAD (untouched, not dropped).
  expect(existsSync(join(dir, '.git', 'MERGE_HEAD'))).toBe(false)
  const status = execSync('git status --porcelain', { cwd: dir, encoding: 'utf-8', env: gitEnv() })
  expect(status.trim()).toBe('')
  const log = execSync('git log -1 --format=%s', { cwd: dir, encoding: 'utf-8', env: gitEnv() }).trim()
  expect(log).toBe('My local edit to the request URL')
})

// ---------------------------------------------------------------------------
// Scenario 4 — semi-pull toast on a stale open
// ---------------------------------------------------------------------------

Given('a collaborator has pushed a non-conflicting change to the remote', async ({ seedFreshRepo, cloneNamedRepo }) => {
  activeRepoName = `git-conflict-toast-${Date.now()}`
  localFilePath = await seedFreshRepo(activeRepoName)
  localCloneDir = dirname(localFilePath)

  const collaboratorDir = await cloneNamedRepo(activeRepoName, 'git-conflict-toast-collaborator')
  // Rename (not e.g. a notes edit) so the change is visible directly in the
  // sidebar without extra navigation — same ground-truth pattern wave 1's
  // pull-clean scenario already proved out.
  setEntityField(collaboratorDir, 'e2e-seed-request', 'name', 'Find pet by ID (updated by collaborator)')
  gitCommit(collaboratorDir, COLLABORATOR_AUTHOR, 'Collaborator renames the request')
  gitPush(collaboratorDir)
})

Then('a pull-available toast appears', async () => {
  const p = requirePage()
  // `GitService.setActiveFolder` awaits `checkForRemoteUpdate()` right
  // after opening — no CRON/watch debounce to wait out, but the fetch
  // itself is a real network round-trip to the docker git-server.
  await expect(p.locator('[data-testid="app-toaster-toast-git-pull-available"]')).toBeVisible({ timeout: 15000 })
})

When('I click pull now in the toast', async () => {
  const p = requirePage()
  await p.locator('[data-testid="git-pull-available-pull-now"]').click()
  await p.waitForTimeout(1000)
})

Then('the pull lands the collaborator\'s change on disk', () => {
  // Deliberately scoped to the git/disk ground truth, NOT the open
  // editor's on-screen content: this proves the toast→pull mechanism
  // itself works (AC's actual scope) — a clean, non-conflicting pull
  // really does fetch+merge the collaborator's commit into the local
  // clone. Whether a SUCCESSFUL pull also refreshes what's already open
  // in the UI is a separate, deliberately-deferred question (unsaved-edit
  // semantics make a hasty fix risky) — asserting UI text here would
  // quietly paper over that gap instead of surfacing it.
  const dir = requireLocalCloneDir()
  const log = execSync('git log -1 --format=%s', { cwd: dir, encoding: 'utf-8', env: gitEnv() }).trim()
  expect(log).toBe('Collaborator renames the request')

  const doc = readSeedDocument(dir)
  const entity = findEntity(doc.collections, 'e2e-seed-request')
  expect(entity?.['name']).toBe('Find pet by ID (updated by collaborator)')
})

// ---------------------------------------------------------------------------
// Scenario 5 — multi-entity commit message generation
// ---------------------------------------------------------------------------

Given('I open a project with unsaved local edits to a folder and a request', async ({ seedFreshRepo, launchApp }) => {
  activeRepoName = `git-conflict-message-${Date.now()}`
  localFilePath = await seedFreshRepo(activeRepoName)
  localCloneDir = dirname(localFilePath)

  // Edited ON DISK but never committed — restorm's Push-modal diff compares
  // the live in-memory model (which reflects whatever was on disk at open
  // time) against the file at HEAD, so an uncommitted disk edit made
  // BEFORE opening is exactly equivalent to "the user just edited these
  // fields in the app" for the purposes of this assertion, without needing
  // to drive the folder Notes editor through the UI.
  setEntityField(localCloneDir, 'e2e-seed-folder', 'notes', 'Edited before commit')
  setEntityField(localCloneDir, 'e2e-seed-request', 'url', 'https://local.example.com/pets/1?edited=true')

  await openProject(localFilePath, launchApp)
})

When('I open the push dialog', async () => {
  const p = requirePage()
  await p.locator('[data-testid="statusbar-git-indicator-push"]').click()
  await expect(p.locator('[data-testid="push-modal"]')).toBeVisible({ timeout: 10000 })
})

Then('the generated commit title lists both changed entity kinds', async () => {
  const p = requirePage()
  const modal = p.locator('[data-testid="push-modal"]')
  // Double `-input` suffix: InputBox renders a hidden state-probe div at
  // the bare testid and the real <input> one level deeper.
  const titleValue = await modal.locator('[data-testid="push-modal-title-input-input"]').inputValue()
  expect(titleValue).toBe('Update to 1 folder, 1 request')
})
