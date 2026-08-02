import { createBdd } from 'playwright-bdd'
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { configureNextOpenDialogForE2E, listViewRowSelectorByTitle, conflictResolutionPanelSelector, type ConflictResolutionSide } from 'electron-core-ui/testing'
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

/** Scopes into one of the conflict-resolution version columns by side —
 * `GitConflictResolutionModal` renders the SAME entity view in all three
 * columns with IDENTICAL inner testids (the panel content has no idea which
 * side it's on), so the column's stable side-based testid is the only way to
 * disambiguate. */
function conflictPaneBySide(p: Page, side: ConflictResolutionSide): Locator {
  return p.locator(conflictResolutionPanelSelector('conflict-resolution-view', side))
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
  // The resolved column mounts when a version is picked, so Monaco is in
  // the DOM a beat before it has been laid out — clicking a zero-size
  // editor fails even with `force`. Wait for real geometry.
  await expect.poll(async () => (await viewport.boundingBox())?.width ?? 0, { timeout: 10000 }).toBeGreaterThan(0)
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

Then('I am told an update is required', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="git-update-required-modal-overlay"]')).toBeVisible({ timeout: 15000 })
})

When('I open the conflict resolution from the update prompt', async () => {
  const p = requirePage()
  await p.locator('[data-testid="git-update-required-modal-resolve-button"]').click()
})

Then('the push is rejected', async () => {
  const p = requirePage()
  // A rejected (non-fast-forward) push shows a failure toast AND closes the
  // modal — the toaster renders under the modal overlay, so the modal now
  // closes on failure too or the user would never see the error. (The
  // commit itself succeeded LOCALLY; only the `git push` failed.)
  await expect(p.getByText('Push failed', { exact: true })).toBeVisible({ timeout: 10000 })
  await expect(p.locator('[data-testid="push-modal"]')).not.toBeVisible()
})

When('I close the push dialog', async () => {
  const p = requirePage()
  // The modal already closes itself on a rejected push — only click Cancel
  // when it is still up (e.g. a flow that reaches here without an error).
  const cancel = p.locator('[data-testid="push-modal-cancel-button"]')
  if (await cancel.isVisible()) {
    await cancel.click()
  }
  await expect(p.locator('[data-testid="push-modal"]')).not.toBeVisible({ timeout: 10000 })
})

When('I pull', async () => {
  const p = requirePage()
  const modal = p.locator('[data-testid="git-conflict-resolution-modal"]')
  const updatePrompt = p.locator('[data-testid="git-update-required-modal-resolve-button"]')
  // A CONTESTED pull doesn't open the resolution screen directly: it
  // raises the same update-required prompt the push flow uses, and
  // resolving from there is one click further in.
  await p.locator('[data-testid="statusbar-git-indicator-pull"]').click()
  await expect(modal.or(updatePrompt)).toBeVisible({ timeout: 20000 })
  if (await updatePrompt.isVisible().catch(() => false)) {
    await updatePrompt.click()
    await expect(modal).toBeVisible({ timeout: 20000 })
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
  const yourVersionPane = conflictPaneBySide(p, 'user')
  const notesEditor = yourVersionPane.locator('[data-testid="folder-view-e2e-seed-folder-markdown-editor-notes"]')
  await expect(notesEditor).toBeVisible({ timeout: 10000 })
  const wrapper = notesEditor.locator('..')
  await expect(wrapper).not.toHaveCSS('border-color', 'rgba(0, 0, 0, 0)')
})

When('I keep my own version of the folder', async () => {
  const p = requirePage()
  await p.locator('[data-testid="conflict-resolution-view-use-user-version"]').click()
})

When('I keep my own version of every conflict still undecided', async () => {
  const p = requirePage()
  // Finishing is gated on EVERY conflict being decided — an untouched one
  // no longer silently defaults to our side, because that let a user
  // publish our version of conflicts they never opened. Walk the list and
  // pick for whatever is left.
  const rows = p.locator('[data-testid="conflict-resolution-view-list"] .list-view-row')
  const count = await rows.count()
  for (let index = 0; index < count; index++) {
    await rows.nth(index).click()
    await p.waitForTimeout(200)
    const finish = p.locator('[data-testid="git-conflict-resolution-finish"]')
    if (await finish.getAttribute('aria-disabled') !== 'true') break
    // "Undecided" is the placeholder being up — NOT the absence of a green
    // check. A conflict resolved by hand-editing matches neither side, so
    // it has no green check while being very much decided; picking for it
    // here would silently throw the user's edit away.
    const undecided = await p.locator('[data-testid="conflict-resolved-placeholder"]').isVisible().catch(() => false)
    if (undecided) {
      await p.locator('[data-testid="conflict-resolution-view-use-user-version"]').click()
      await p.waitForTimeout(200)
    }
  }
})

When('I use the server\'s version of the request and tweak its URL', async () => {
  const p = requirePage()
  await conflictRowByName(p, 'Find pet by ID').click()
  await p.locator('[data-testid="conflict-resolution-view-use-server-version"]').click()

  const resolvedPane = conflictPaneBySide(p, 'resolved')
  const urlInput = resolvedPane.locator('[data-testid="http-request-url-input"]:visible').first()
  await expect(urlInput).toBeVisible({ timeout: 10000 })
  const viewport = urlInput.locator('.monaco-editor').first()
  // The resolved column mounts when a version is picked, so Monaco is in
  // the DOM a beat before it has been laid out — clicking a zero-size
  // editor fails even with `force`. Wait for real geometry.
  await expect.poll(async () => (await viewport.boundingBox())?.width ?? 0, { timeout: 10000 }).toBeGreaterThan(0)
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
// Scenario — a KV-section conflict auto-expands + highlights the differing rows
// ---------------------------------------------------------------------------

Given('a remote has diverged on the request\'s headers', async ({ seedFreshRepo, cloneNamedRepo }) => {
  activeRepoName = `git-conflict-headers-${Date.now()}`
  localFilePath = await seedFreshRepo(activeRepoName)
  localCloneDir = dirname(localFilePath)

  // Same key changes value on both sides (a real conflict on `X-Trace`); a
  // second header is identical on both sides (`X-Common`) — so exactly one of
  // the two rows should light up.
  setEntityField(localCloneDir, 'e2e-seed-request', 'headers', [
    { key: 'X-Trace', value: 'ours' },
    { key: 'X-Common', value: 'same' }
  ])
  gitCommit(localCloneDir, LOCAL_AUTHOR, 'My local edit to the request headers')

  const collaboratorDir = await cloneNamedRepo(activeRepoName, 'git-conflict-headers-collaborator')
  setEntityField(collaboratorDir, 'e2e-seed-request', 'headers', [
    { key: 'X-Trace', value: 'theirs' },
    { key: 'X-Common', value: 'same' }
  ])
  gitCommit(collaboratorDir, COLLABORATOR_AUTHOR, 'Collaborator edit to the request headers')
  gitPush(collaboratorDir)
})

Then('the headers section is expanded in the your-version panel', async () => {
  const p = requirePage()
  // A collapsed pane renders no body, so a visible header key cell proves the
  // conflicting section auto-expanded. The header key cell is the
  // Handlebars-aware VariableInputBox (a Monaco editor); its root carries the
  // bare testid (no `-input`/`-container` suffix — that's the plain
  // InputBox's own convention, not shared by the variable-aware editor).
  const keyCell = conflictPaneBySide(p, 'user').locator('[data-testid="http-request-headers-table-key-input"]').first()
  await expect(keyCell).toBeVisible({ timeout: 10000 })
})

Then('the changed header row is highlighted but the unchanged one is not', async () => {
  const p = requirePage()
  // Each row's key cell is wrapped in an explicit `-key-diff` div (only
  // rendered inside the conflict view) that carries the diff border directly
  // — read its own computed border rather than walking parent elements. The
  // cell's text lives in Monaco's `.view-line` spans (a Handlebars-aware
  // VariableInputBox, not a plain `<input>`).
  // Monaco paints its `.view-line`s asynchronously after mount, so a
  // single-shot read can land on an editor that is up but still blank. Poll
  // the whole read+assert until both rows have their text.
  await expect(async () => {
    const cells = await conflictPaneBySide(p, 'user')
      .locator('[data-testid="http-request-headers-table-key-diff"]')
      .evaluateAll((els) =>
        els.map((el) => {
          const value = Array.from(el.querySelectorAll('.view-line'))
            .map((line) => line.textContent.trim())
            .join('')
          const borderColor = getComputedStyle(el).borderColor
          return { value, borderColor }
        })
      )
    const changed = cells.find((c) => c.value === 'X-Trace')
    const unchanged = cells.find((c) => c.value === 'X-Common')
    expect(changed, 'changed header row present').toBeTruthy()
    expect(unchanged, 'unchanged header row present').toBeTruthy()
    // A transparent border computes to rgba(0, 0, 0, 0); the diff border is a
    // solid (non-transparent) colour.
    expect(changed?.borderColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(unchanged?.borderColor).toBe('rgba(0, 0, 0, 0)')
  }).toPass({ timeout: 10000 })
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
  const resolvedPane = conflictPaneBySide(p, 'resolved')
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
})

Then('the pull lands the collaborator\'s change on disk', async () => {
  // Deliberately scoped to the git/disk ground truth, NOT the open
  // editor's on-screen content: this proves the toast→pull mechanism
  // itself works (AC's actual scope) — a clean, non-conflicting pull
  // really does fetch+merge the collaborator's commit into the local
  // clone. Whether a SUCCESSFUL pull also refreshes what's already open
  // in the UI is a separate, deliberately-deferred question (unsaved-edit
  // semantics make a hasty fix risky) — asserting UI text here would
  // quietly paper over that gap instead of surfacing it.
  const dir = requireLocalCloneDir()
  // The pull itself (fetch + merge over IPC) is async — poll for the
  // commit to land rather than assume it already has the instant the
  // click resolves.
  await expect
    .poll(
      () => execSync('git log -1 --format=%s', { cwd: dir, encoding: 'utf-8', env: gitEnv() }).trim(),
      { timeout: 25000 },
    )
    .toBe('Collaborator renames the request')

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

// ---------------------------------------------------------------------------
// Equality-derived side checks + identity band

/** The span wrapping one side's "use this version" check — `.picked` on it
 * is what paints the check green (equality-derived, see
 * `useConflictResolution.pickedSideById`). */
function useActionWrapper(p: Page, side: 'user' | 'server'): Locator {
  return p.locator(`span.conflict-resolution-use-action:has([data-testid="conflict-resolution-view-use-${side}-version"])`)
}

Then('the identity band shows the conflicting request', async () => {
  const p = requirePage()
  const band = p.locator('[data-testid="git-conflict-entity-band"]')
  await expect(band).toBeVisible({ timeout: 10000 })
  await expect(band.locator('[data-testid="git-conflict-entity-breadcrumb"]')).toContainText('Find pet by ID')
})

When('I use my version', async () => {
  const p = requirePage()
  await p.locator('[data-testid="conflict-resolution-view-use-user-version"]').click()
})

Then('the your-version check is green and the server-version check is not', async () => {
  const p = requirePage()
  // A session starts with NOTHING resolved, so the user side greens only
  // after the pick — the check reports equality, it does not assume it.
  await expect(useActionWrapper(p, 'user')).toHaveClass(/picked/, { timeout: 10000 })
  await expect(useActionWrapper(p, 'server')).not.toHaveClass(/picked/)
})

When("I use the server's version", async () => {
  const p = requirePage()
  await p.locator('[data-testid="conflict-resolution-view-use-server-version"]').click()
})

Then('the server-version check is green and the your-version check is not', async () => {
  const p = requirePage()
  await expect(useActionWrapper(p, 'server')).toHaveClass(/picked/, { timeout: 10000 })
  await expect(useActionWrapper(p, 'user')).not.toHaveClass(/picked/)
})

When("I tweak the resolved request's URL", async () => {
  const p = requirePage()
  const resolvedPane = conflictPaneBySide(p, 'resolved')
  const urlInput = resolvedPane.locator('[data-testid="http-request-url-input"]:visible').first()
  await expect(urlInput).toBeVisible({ timeout: 10000 })
  const viewport = urlInput.locator('.monaco-editor').first()
  // The resolved column mounts when a version is picked, so Monaco is in
  // the DOM a beat before it has been laid out — clicking a zero-size
  // editor fails even with `force`. Wait for real geometry.
  await expect.poll(async () => (await viewport.boundingBox())?.width ?? 0, { timeout: 10000 }).toBeGreaterThan(0)
  await viewport.click({ force: true })
  await p.keyboard.press('Control+A')
  await p.keyboard.press('Delete')
  await p.keyboard.type('https://neither.example.com/pets/1')
  await p.keyboard.press('Tab')
  await p.waitForTimeout(300)
})

Then('neither side check is green', async () => {
  const p = requirePage()
  await expect(useActionWrapper(p, 'user')).not.toHaveClass(/picked/, { timeout: 10000 })
  await expect(useActionWrapper(p, 'server')).not.toHaveClass(/picked/)
})
