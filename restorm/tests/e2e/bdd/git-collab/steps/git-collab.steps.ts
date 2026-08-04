import { createBdd } from 'playwright-bdd'
import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { configureNextSaveFileDialogForE2E, configureNextOpenDialogForE2E, configureNextConfirmationDialogForE2E } from 'electron-core-ui/testing'
import { test, expect } from '../../fixtures/git-collab.fixture'
import { gitEnv } from '../../../../integration/gitServerSeed'

const { Given, When, Then } = createBdd(test)

const SIDEBAR_ROWS = '[data-testid="sidebar-listview"] .list-view-row'

/** Expand every collapsed sidebar folder via its chevron (never the row
 * itself — a row click also opens a tab, which this helper must not do). */
async function expandAllSidebarRows(p: Page): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const collapsed = p.locator(`${SIDEBAR_ROWS}[data-is-expanded="false"]`)
    if ((await collapsed.count()) === 0) return
    // Short click timeout + retry: the sidebar re-renders while git
    // status / hydration settles, so a row matched a moment ago can be
    // swapped out from under a long-waiting click.
    try {
      await collapsed.first().locator('.list-view-expander').click({ timeout: 2000 })
    } catch { /* re-resolve on the next lap */ }
    await p.waitForTimeout(150)
  }
  const shot = p.getByTestId('sidebar-listview')
  const html = await shot.evaluate((el) => el.outerHTML).catch(() => '<gone>')
  throw new Error(`sidebar still has collapsed rows after 60 laps: ${html.slice(0, 1500)}`)
}

function sidebarRowByName(p: Page, name: string): ReturnType<Page['locator']> {
  return p
    .locator(SIDEBAR_ROWS)
    .filter({ has: p.getByText(name, { exact: true }) })
    .first()
}

/** Open the title-bar Git menu, tolerating the transient states the menu
 * bar goes through right after another interaction (a just-closed menu, a
 * toast sliding in over it). A single click can sit there unactionable
 * for the whole timeout; short attempts + a re-try get through. */
async function openGitMenu(p: Page): Promise<void> {
  // A modal that has just been dismissed leaves its overlay on screen for
  // the length of the close animation, and that overlay spans the title
  // bar — every click on the menu bar during that window is swallowed.
  // Wait it out rather than clicking into a void.
  await expect(p.locator('.ecu-modal-overlay.ecu-modal-closing')).toHaveCount(0, { timeout: 15000 })

  const menubarItem = p.locator('[data-testid="titlebar-menubar-item-git"]')
  const anyItem = p.locator('[data-testid="titlebar-menu-item-git-push"]').first()
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await menubarItem.click({ timeout: 4000 })
      await expect(anyItem).toBeVisible({ timeout: 3000 })
      return
    } catch { /* still settling — try again */ }
  }
  // A narrow window collapses the tail of the menu bar into an overflow
  // button; Git is far enough right to land there, and it then renders as
  // a SUBMENU of that button rather than as a top-level item.
  if ((await menubarItem.count()) === 0) {
    await p.locator('[data-testid="titlebar-menubar-overflow-button"]').click({ timeout: 10000 })
    const overflowed = p.locator('[data-testid="titlebar-menubar-item-git-overflow"]')
    await expect(overflowed).toBeVisible({ timeout: 10000 })
    await overflowed.click()
    await expect(anyItem).toBeVisible({ timeout: 10000 })
    return
  }
  await menubarItem.click({ timeout: 10000 })
  await expect(anyItem).toBeVisible({ timeout: 10000 })
}

// ── Harness ───────────────────────────────────────────────────────────

Given('an empty shared git remote', ({ collab }) => {
  collab.createRemote()
})

Given('{string} has a local repository connected to the remote', ({ collab }, actor: string) => {
  collab.initRepo(actor)
})

Given('{string} launches restorm', async ({ collab }, actor: string) => {
  await collab.launch(actor)
})

// ── File creation / import / open ─────────────────────────────────────

When('{string} creates the project file {string} in his repository', async ({ collab }, actor: string, fileName: string) => {
  const p = collab.pageOf(actor)
  const filePath = join(collab.repoDirOf(actor), fileName)
  await configureNextSaveFileDialogForE2E(collab.appOf(actor), { kind: 'saveFile', path: filePath })

  await p.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await p.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  await expect(() => { expect(existsSync(filePath)).toBe(true) }).toPass({ timeout: 10000 })
  // First-save → file-opened → hydrate settles.
  await p.waitForTimeout(500)
})

When('{string} imports the Petstore from {string}', async ({ collab }, actor: string, url: string) => {
  const p = collab.pageOf(actor)

  await p.keyboard.press('Control+I')
  const modal = p.locator('[data-testid="import-modal"]')
  await expect(modal).toBeVisible({ timeout: 10000 })

  const input = modal.locator('textarea, input[type="text"]').first()
  await input.fill(url)
  await expect(modal.locator('.import-preview-section')).toBeVisible({ timeout: 15000 })

  const importButton = modal.locator('[role="button"]:has-text("Import")[aria-disabled="false"]')
  await expect(importButton).toBeVisible({ timeout: 15000 })
  await importButton.click()
  await expect(modal).toBeHidden({ timeout: 30000 })

  // The imported tree lands in the sidebar.
  await expect(p.locator(SIDEBAR_ROWS).first()).toBeVisible({ timeout: 15000 })
})

When('{string} clones the remote into his workspace', ({ collab }, actor: string) => {
  collab.cloneRepo(actor)
})

When('{string} opens the project file {string} from his workspace', async ({ collab }, actor: string, fileName: string) => {
  const p = collab.pageOf(actor)
  const filePath = join(collab.repoDirOf(actor), fileName)
  expect(existsSync(filePath), `cloned file must exist: ${filePath}`).toBe(true)

  await configureNextOpenDialogForE2E(collab.appOf(actor), { kind: 'openFile', path: filePath })
  await p.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await p.locator('[data-testid="titlebar-menu-item-open"]').first().click()

  await expect(p.locator(SIDEBAR_ROWS).first()).toBeVisible({ timeout: 15000 })
})

// ── Sidebar content ───────────────────────────────────────────────────

Then(
  '{string} sees {int} environment folder(s), {int} folder(s) and {int} request(s) in the sidebar',
  async ({ collab }, actor: string, envCount: number, folderCount: number, requestCount: number) => {
    const p = collab.pageOf(actor)
    await expandAllSidebarRows(p)

    // Environment folders sit at the tree root; plain folders are nested
    // non-leaf rows; requests are the leaves.
    const envFolders = p.locator(`${SIDEBAR_ROWS}[data-is-leaf="false"][data-depth="0"]`)
    const nestedFolders = p.locator(`${SIDEBAR_ROWS}[data-is-leaf="false"]:not([data-depth="0"])`)
    const requests = p.locator(`${SIDEBAR_ROWS}[data-is-leaf="true"]`)

    await expect(envFolders).toHaveCount(envCount, { timeout: 10000 })
    await expect(nestedFolders).toHaveCount(folderCount, { timeout: 10000 })
    await expect(requests).toHaveCount(requestCount, { timeout: 10000 })
  }
)

// ── Push / pull flags (statusbar pastilles AND Git menu pastilles) ────

async function assertFlag(p: Page, kind: 'push' | 'pull', on: boolean): Promise<void> {
  const statusbarPastille = p.locator(`[data-testid="statusbar-git-indicator-${kind}-pastille"]`)
  if (on) {
    await expect(statusbarPastille, `statusbar ${kind} pastille should be ON`).toBeVisible({ timeout: 20000 })
  } else {
    await expect(statusbarPastille, `statusbar ${kind} pastille should be OFF`).toHaveCount(0, { timeout: 20000 })
  }
}

Then('{string} sees the push flag {word} and the pull flag {word}', async ({ collab }, actor: string, pushState: string, pullState: string) => {
  const p = collab.pageOf(actor)
  const pushOn = pushState === 'ON'
  const pullOn = pullState === 'ON'

  // 1) Statusbar pastilles (poll — autosave + git status refresh land async).
  await assertFlag(p, 'push', pushOn)
  await assertFlag(p, 'pull', pullOn)

  // 2) Git menu pastilles — same truth, second surface.
  await openGitMenu(p)
  const menuPushPastille = p.locator('[data-testid="titlebar-menu-item-git-push-pastille"]')
  const menuPullPastille = p.locator('[data-testid="titlebar-menu-item-git-pull-pastille"]')
  try {
    await expect(menuPushPastille).toHaveCount(pushOn ? 1 : 0, { timeout: 5000 })
  } catch {
    // The two surfaces read the SAME hook. A disagreement means one of
    // them is looking at stale state — say which, and what the statusbar
    // thinks right now, instead of just "count was 1".
    const statusbarNow = await p.locator('[data-testid="statusbar-git-indicator-push-pastille"]').count()
    const cwd = collab.repoDirOf(actor)
    const status = execSync('git status --porcelain', { cwd, env: gitEnv() }).toString().trim()
    const diff = execSync('git diff --stat', { cwd, env: gitEnv() }).toString().trim()
    throw new Error(
      `push pastille should be ${pushState}: menu=${String(await menuPushPastille.count())} statusbar=${String(statusbarNow)}\n` +
      `git status: ${status || '(clean)'}\ngit diff --stat: ${diff || '(none)'}`
    )
  }
  await expect(menuPullPastille, `menu pull pastille should be ${pullState}`).toHaveCount(pullOn ? 1 : 0, { timeout: 5000 })
  await p.keyboard.press('Escape')
  await expect(p.locator('[data-testid="titlebar-menu-item-git-push"]')).toBeHidden({ timeout: 5000 })
})

// ── Push ──────────────────────────────────────────────────────────────

When('{string} pushes his changes', async ({ collab }, actor: string) => {
  const p = collab.pageOf(actor)
  const pushIcon = p.locator('[data-testid="statusbar-git-indicator-push"]')
  // The icon is inert (aria-disabled, click silently ignored) until the
  // app's git status has caught up with the latest autosaved edit — wait
  // for the ENABLED state, not just the icon's presence.
  await expect(pushIcon).not.toHaveAttribute('aria-disabled', 'true', { timeout: 20000 })

  // The statusbar re-renders while git status settles; a click landing
  // mid-re-render is occasionally swallowed (icon remounts between
  // mousedown and mouseup) — retry like a user would.
  const modal = p.locator('[data-testid="push-modal"]')
  for (let attempt = 0; attempt < 3; attempt++) {
    await pushIcon.click()
    try {
      await expect(modal).toBeVisible({ timeout: 5000 })
      break
    } catch { /* re-click */ }
  }
  await expect(modal).toBeVisible({ timeout: 15000 })
  const pushButton = modal.locator('[data-testid="push-modal-push-button"]')
  await expect(pushButton).toBeEnabled({ timeout: 15000 })
  await pushButton.click()
  // The modal closes whatever happens next — success, failure, or the
  // update prompt taking over. What actually landed is asserted by the
  // steps that follow, against git itself: a success toast is NOT proof
  // (toasts accumulate, and `.first()` happily matches a stale one from
  // an earlier push in the same scenario — which is exactly how a push
  // that never reached the remote passed unnoticed here).
  await expect(modal).toBeHidden({ timeout: 60000 })
})

Then('{string} has nothing left to publish', async ({ collab }, actor: string) => {
  const cwd = collab.repoDirOf(actor)
  // Ground truth, straight from git: the branch carries no commit the
  // remote lacks, and the project file has no uncommitted change. This is
  // the assertion that catches "the push silently didn't land", which a
  // toast cannot.
  await expect(async () => {
    const unpushed = execSync('git rev-list --count @{u}..HEAD', { cwd, env: gitEnv() }).toString().trim()
    const dirty = execSync('git status --porcelain', { cwd, env: gitEnv() }).toString().trim()
    expect(`unpushed=${unpushed} dirty=${dirty}`).toBe('unpushed=0 dirty=')
  }).toPass({ timeout: 30000 })
})

// ── History ───────────────────────────────────────────────────────────

Then(
  '{string} sees {int} commit(s) in the history, the last by {string} mentioning {string}',
  async ({ collab }, actor: string, commitCount: number, email: string, mention: string) => {
    const p = collab.pageOf(actor)
    await p.locator('[data-testid="statusbar-git-indicator-history"]').click()

    const modal = p.locator('[data-testid="git-history-modal"]')
    await expect(modal).toBeVisible({ timeout: 15000 })

    const rows = modal.locator('[data-testid^="git-history-view-row-"]')
    await expect(rows).toHaveCount(commitCount, { timeout: 15000 })

    // Newest first: the FIRST row is the last commit.
    const first = rows.first()
    await expect(first).toContainText(mention)
    await first.click()
    const details = modal.locator('[data-testid="git-history-view-details"]')
    await expect(details).toBeVisible({ timeout: 5000 })
    await expect(details).toContainText(email)
    await expect(details).toContainText(mention)

    await p.keyboard.press('Escape')
    await expect(modal).toBeHidden({ timeout: 5000 })
  }
)

// ── Request edits (chapter 3) ─────────────────────────────────────────

When('{string} opens the request {string}', async ({ collab }, actor: string, requestName: string) => {
  const p = collab.pageOf(actor)
  const row = sidebarRowByName(p, requestName)
  if (!(await row.isVisible().catch(() => false))) {
    await expandAllSidebarRows(p)
  }
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.click()
  // Protocol-agnostic: each edit step asserts its own control before
  // acting, so opening only needs the tab mount to settle.
  await p.waitForTimeout(400)
})

When('{string} sets the path parameter value to {string}', async ({ collab }, actor: string, value: string) => {
  const p = collab.pageOf(actor)
  const table = p.locator('[data-testid="http-request-path-params-table"]:visible')
  // td layout: [drag, enabled, key, value, mode, description, trash]; the
  // swagger importer casts the petstore's `petId` to a Numeric value (a
  // spinbutton `<input>`, not the Handlebars-aware editor a default string
  // value would get).
  const input = table.locator('tbody tr').first().locator('td').nth(3).locator('input').first()
  await expect(input).toBeVisible({ timeout: 10000 })
  await input.fill(value)
  // Commit the edit (blur) so the debounced persistence sees it.
  await p.keyboard.press('Tab')
})

When('{string} turns off the follow redirects option', async ({ collab }, actor: string) => {
  const p = collab.pageOf(actor)
  // Let the previous edit's autosave/debounce cycle fully drain first —
  // when the toggle click rides an in-flight save, the new value leaks
  // to disk inside THAT save and the push flag lights for the wrong
  // reason, masking a toggle that fails to mark the document dirty.
  await p.waitForTimeout(1500)
  const toggle = p.locator('[data-testid="http-request-follow-redirects-toggle"]:visible')
  await expect(toggle).toBeVisible({ timeout: 10000 })
  await toggle.click()
})

// ── Refresh / pull (chapter 4) ────────────────────────────────────────

When('{string} refreshes the git state', async ({ collab }, actor: string) => {
  const p = collab.pageOf(actor)
  await p.locator('[data-testid="statusbar-git-indicator-refresh"]').click()
})

When('{string} pulls the changes', async ({ collab }, actor: string) => {
  const p = collab.pageOf(actor)
  const pullIcon = p.locator('[data-testid="statusbar-git-indicator-pull"]')
  await pullIcon.click()
  // No success toast exists for a clean pull — the pull-flag-OFF /
  // content assertions right after this step are the completion signal.
})

Then('{string} sees the follow redirects option {word} in the open request', async ({ collab }, actor: string, state: string) => {
  const p = collab.pageOf(actor)
  const toggle = p.locator('[data-testid="http-request-follow-redirects-toggle"]:visible')
  await expect(toggle).toBeVisible({ timeout: 10000 })
  // Asserted checked BEFORE the pull and unchecked AFTER it: the pulled
  // value must land in the LIVE, already-open view — not only in the
  // tree/model behind it. The data-testid sits on the container; the
  // checkable element is the inner role=checkbox.
  const expected = state === 'checked' ? 'true' : 'false'
  await expect(toggle.getByRole('checkbox')).toHaveAttribute('aria-checked', expected, { timeout: 15000 })
})

// ── Reactivity scenario (multi-protocol option edits) ─────────────────

/** One request per protocol family the reactive layer must track: kafka
 * (formerly fully unwrapped), websocket+MQTT (option keys), http (timeout). */
// The root folder carries an explicit id like every other entity: an
// id-less entity is assigned a fresh one on each load, so the two sides of
// a merge would never match it and the whole subtree would be duplicated.
const REACTIVITY_PROJECT_YAML = `fileFormatVersion: 1
_projectUuid: e2e-reactivity-project-uuid
collections:
  - folderType: environment
    id: e2e-reactivity-root
    name: Reactivity Lab
    tags: []
    configuration: {}
    environments: []
    items:
      - type: kafka
        id: e2e-reactivity-kafka
        name: Kafka sample
        tags: []
        url: localhost:9092
        clientId: restorm
        mode: produce
        topic: reactivity-test
        value: '{}'
        headers: []
      - type: websocket
        id: e2e-reactivity-mqtt
        name: MQTT sample
        tags: []
        url: mqtt://localhost:1883
        protocol: mqtt
        event: test/echo
        message: '{}'
        headers: []
      - type: http
        id: e2e-reactivity-http
        name: HTTP sample
        tags: []
        method: GET
        url: https://example.com/ping
        headers: []
        params: []
        pathParams: []
        quickConfigs:
          - id: qc-staging
            name: Staging
            requestId: e2e-reactivity-http
            storageTarget: project
            fields:
              url: https://staging.example/ping
              timeout: 1000
            createdAt: ''
            updatedAt: ''
`

Given('{string} has a committed multi-protocol project {string}', ({ collab }, actor: string, fileName: string) => {
  collab.seedCommittedProject(actor, fileName, REACTIVITY_PROJECT_YAML)
})

/** Two sibling folders + one request: the smallest project in which an
 * inter-folder move can conflict. */
const TWO_FOLDER_PROJECT_YAML = `fileFormatVersion: 1
_projectUuid: e2e-tree-project-uuid
collections:
  - folderType: environment
    id: e2e-tree-root
    name: Petstore Lab
    tags: []
    configuration: {}
    environments: []
    items:
      - id: e2e-tree-folder-a
        name: Dossier A
        tags: []
        configuration: {}
        items:
          - type: http
            id: e2e-tree-request
            name: Fiche animal
            tags: []
            method: GET
            url: https://example.com/pet/1
            headers: []
            params: []
            pathParams: []
      - id: e2e-tree-folder-b
        name: Dossier B
        tags: []
        configuration: {}
        items: []
      - id: e2e-tree-folder-c
        name: Dossier C
        tags: []
        configuration: {}
        items: []
`

Given('{string} has a committed two-folder project {string}', ({ collab }, actor: string, fileName: string) => {
  collab.seedCommittedProject(actor, fileName, TWO_FOLDER_PROJECT_YAML)
})

When('a colleague moves the request {string} into the folder {string} in {string}', ({ collab }, requestName: string, folderName: string, fileName: string) => {
  collab.collaboratorMovesRequest(fileName, requestName, folderName)
})

async function clickToggle(p: Page, testId: string): Promise<void> {
  const container = p.locator(`[data-testid="${testId}"]:visible`)
  await expect(container).toBeVisible({ timeout: 10000 })
  const checkbox = container.locator('[role="checkbox"]')
  await ((await checkbox.count()) > 0 ? checkbox.first() : container).click()
}

When('{string} toggles the kafka TLS option', async ({ collab }, actor: string) => {
  await clickToggle(collab.pageOf(actor), 'kafka-tls-toggle')
})

When('{string} toggles the MQTT subscribe option', async ({ collab }, actor: string) => {
  await clickToggle(collab.pageOf(actor), 'mqtt-subscribe-toggle')
})

When('{string} sets the request timeout to {string}', async ({ collab }, actor: string, value: string) => {
  const p = collab.pageOf(actor)
  // ECUI InputBox suffixes its testid: the editable element is `-input`.
  const input = p.locator('[data-testid="http-request-timeout-input-input"]:visible').first()
  await expect(input).toBeVisible({ timeout: 10000 })
  await input.fill(value)
  await p.keyboard.press('Tab')
})

// ── Update prompt (behind the server) ─────────────────────────────────

When(
  'a colleague pushes a change to {string} replacing {string} with {string}',
  ({ collab }, fileName: string, find: string, replace: string) => {
    collab.collaboratorPushes(fileName, find, replace)
  }
)

Then('{string} sees no update prompt', async ({ collab }, actor: string) => {
  const p = collab.pageOf(actor)
  // Nothing contested means the update is carried out without asking —
  // the prompt must never have appeared, not merely have been dismissed.
  const modal = p.locator('[data-testid="git-update-required-modal"]')
  if ((await modal.count()) > 0) {
    // Name the offender: "a prompt appeared" is useless on its own when
    // the whole point is WHICH entity was wrongly judged contested.
    const names = await modal.locator('[data-testid="git-update-required-modal-conflict-names"]').textContent()
    // Show WHAT our side actually changed against the commit it started
    // from: a wrongly-contested entity means our own save moved it.
    const cwd = collab.repoDirOf(actor)
    const log = execSync('git log --oneline --all --decorate', { cwd, env: gitEnv() }).toString()
    const stat = execSync('git diff HEAD --stat', { cwd, env: gitEnv() }).toString()
    throw new Error(
      `update prompt appeared though nothing should be contested — contested: ${names ?? '(none listed)'}\n` +
      `history:\n${log.slice(0, 1200)}\nour diff vs HEAD (stat): ${stat}`
    )
  }
  await expect(modal).toHaveCount(0)
})

Then(
  '{string} sees the update prompt reporting {int} conflicting item(s)',
  async ({ collab }, actor: string, count: number) => {
    const p = collab.pageOf(actor)
    const modal = p.locator('[data-testid="git-update-required-modal"]')
    await expect(modal).toBeVisible({ timeout: 20000 })
    // The announced number and the entities the resolution view lists come
    // from one computation — assert the number the user actually reads.
    await expect(modal.locator('[data-testid="git-update-required-modal-conflict-count"]'))
      .toContainText(String(count))
  }
)

/** Commit count on the actor's branch, read straight from git — the only
 * trustworthy witness that nothing was committed behind the user's back. */
function commitCount(collab: { repoDirOf: (a: string) => string }, actor: string): number {
  const out = execSync('git rev-list --count HEAD', { cwd: collab.repoDirOf(actor), env: gitEnv() })
  return Number(out.toString().trim())
}

const commitCountsBefore = new Map<string, number>()

Then('{string} has no new local commit', ({ collab }, actor: string) => {
  const current = commitCount(collab, actor)
  const previous = commitCountsBefore.get(actor)
  if (previous === undefined) {
    // First observation in this scenario: remember it, so the NEXT check
    // (after cancelling) compares against the pre-prompt state.
    commitCountsBefore.set(actor, current)
    return
  }
  // THE guarantee of this flow: reaching — or backing out of — the prompt
  // must never leave a commit the user did not ask for.
  expect(current).toBe(previous)
})

When('{string} cancels the update prompt', async ({ collab }, actor: string) => {
  const p = collab.pageOf(actor)
  await p.locator('[data-testid="git-update-required-modal-cancel-button"]').click()
  await expect(p.locator('[data-testid="git-update-required-modal"]')).toHaveCount(0, { timeout: 10000 })
})

When('{string} chooses to keep his version in the update prompt', async ({ collab }, actor: string) => {
  const p = collab.pageOf(actor)
  await p.locator('[data-testid="git-update-required-modal-keep-mine-button"]').click()
  await expect(p.locator('[data-testid="git-update-required-modal"]')).toHaveCount(0, { timeout: 20000 })
})

When('{string} resets to the server version from the Git menu', async ({ collab }, actor: string) => {
  const p = collab.pageOf(actor)
  await openGitMenu(p)
  const menuItem = p.locator('[data-testid="titlebar-menu-item-git-reset-to-server"]').first()
  await expect(menuItem).toBeVisible({ timeout: 10000 })
  await menuItem.click()
  // Wait for the menu to actually go away before touching the dialog it
  // opened. They overlap on screen, and a retry-click on the dialog's
  // button lands on the MENU ITEM underneath once the dialog closes —
  // silently re-opening it. (That is a test-harness trap, not a product
  // bug: the reset itself had already run.)
  await expect(menuItem).toBeHidden({ timeout: 10000 })

  const confirm = p.locator('[data-testid="git-reset-to-server-confirm"]')
  await expect(confirm).toBeVisible({ timeout: 10000 })
  await confirm.locator('[data-testid="git-reset-to-server-confirm-confirm-button"]').click()
  // Wait on the OUTCOME, not on the dialog's own animation/mount
  // mechanics: the reset is done when git says the working tree matches
  // the server again. Asserting the modal's visibility instead made this
  // step hostage to how the modal unmounts, which is not what it tests.
  const cwd = collab.repoDirOf(actor)
  await expect(async () => {
    const dirty = execSync('git status --porcelain', { cwd, env: gitEnv() }).toString().trim()
    expect(dirty).toBe('')
  }).toPass({ timeout: 30000 })
})

Then('{string} sees the request timeout is {string}', async ({ collab }, actor: string, value: string) => {
  const p = collab.pageOf(actor)
  const input = p.locator('[data-testid="http-request-timeout-input-input"]:visible').first()
  await expect(input).toBeVisible({ timeout: 15000 })
  await expect(input).toHaveValue(value, { timeout: 15000 })
})

Then('{string} sees the request {string} in the sidebar', async ({ collab }, actor: string, name: string) => {
  const p = collab.pageOf(actor)
  await expandAllSidebarRows(p)
  try {
    await expect(sidebarRowByName(p, name)).toBeVisible({ timeout: 15000 })
  } catch (error) {
    // Separate "the merge dropped it" from "the merge kept it but the UI
    // never refreshed" — the fix is in a different place for each.
    const onDisk = readFileSync(join(collab.repoDirOf(actor), 'shared.restorm'), 'utf-8')
    throw new Error(
      `"${name}" is not in the sidebar. On disk the name IS ${onDisk.includes(name) ? 'PRESENT (UI refresh problem)' : 'ABSENT (merge dropped it)'}.\n` +
      String(error).slice(0, 300)
    )
  }
})

// ── Quick settings ────────────────────────────────────────────────────

When('{string} saves the quick setting named {string}', async ({ collab }, actor: string, name: string) => {
  const p = collab.pageOf(actor)
  await p.locator('[data-testid="quick-settings-open-button"]:visible').first().click()
  const popover = p.locator('[data-testid="quick-settings-popover"]')
  await expect(popover).toBeVisible({ timeout: 10000 })

  // Saving under an EXISTING name overwrites that configuration — the
  // natural way a user updates one, and what makes both sides diverge on
  // the same config rather than adding a second one.
  // The configuration must be stored WITH THE PROJECT: a user-settings
  // one never travels in the file, so it could not conflict at all.
  const storageToggle = popover.locator('[data-testid="quick-settings-storage-toggle"] [role="checkbox"]').first()
  if ((await storageToggle.getAttribute('aria-checked')) !== 'true') {
    await storageToggle.click()
  }

  const nameInput = popover.locator('[data-testid="quick-settings-name-input-input"]').first()
  await expect(nameInput).toBeVisible({ timeout: 10000 })
  await nameInput.fill(name)
  await popover.locator('[data-testid="quick-settings-save-button"]').click()

  // Overwriting asks for confirmation. Wait for it rather than sampling
  // visibility once — the dialog animates in.
  const confirm = p.locator('[data-testid="quick-settings-confirm-modal"]')
  await expect(async () => {
    expect(await confirm.isVisible()).toBe(true)
  }).toPass({ timeout: 5000 }).catch(() => undefined)
  if (await confirm.isVisible().catch(() => false)) {
    await p.locator('[data-testid="quick-settings-confirm-ok"]').click()
    await expect(confirm).toBeHidden({ timeout: 10000 })
  }

  // The popover does not close itself on save; toggle it shut with the
  // same button that opened it, so it cannot sit over the statusbar
  // controls the next steps click.
  await p.locator('[data-testid="quick-settings-open-button"]:visible').first().click()
  await expect(popover).toBeHidden({ timeout: 10000 })
})

// ── Conflict resolution reached from the update prompt ────────────────

When('{string} opens the conflict resolution from the update prompt', async ({ collab }, actor: string) => {
  const p = collab.pageOf(actor)
  await p.locator('[data-testid="git-update-required-modal-resolve-button"]').click()
  await expect(p.locator('[data-testid="git-conflict-resolution-modal"]')).toBeVisible({ timeout: 20000 })
})

Then('{string} sees the conflict entry {string}', async ({ collab }, actor: string, label: string) => {
  const p = collab.pageOf(actor)
  // The list pairs the request name with the saved configuration's — the
  // request name alone would be ambiguous across several of its configs.
  await expect(p.getByText(label, { exact: true }).first()).toBeVisible({ timeout: 15000 })
})

Then('{string} sees the conflict is announced on the quick setting {string}', async ({ collab }, actor: string, name: string) => {
  const p = collab.pageOf(actor)
  const banner = p.locator('[data-testid="git-conflict-quick-config-banner"]')
  await expect(banner).toBeVisible({ timeout: 15000 })
  await expect(banner).toContainText(name)
})

When('{string} keeps the server version of the selected conflict', async ({ collab }, actor: string) => {
  const p = collab.pageOf(actor)
  await p.locator('[data-testid="conflict-resolution-view-use-server-version"]').first().click()
})

When('{string} finishes the conflict resolution', async ({ collab }, actor: string) => {
  const p = collab.pageOf(actor)
  const finish = p.locator('[data-testid="git-conflict-resolution-finish"]')
  await expect(finish).toBeEnabled({ timeout: 15000 })
  await finish.click()
  await expect(p.locator('[data-testid="git-conflict-resolution-modal"]')).toBeHidden({ timeout: 30000 })
})

When('{string} selects the conflict entry {string}', async ({ collab }, actor: string, label: string) => {
  const p = collab.pageOf(actor)
  // Click the ROW, not the label span: the label carries its own hover
  // tooltip anchor, which intercepts the click.
  const row = p
    .locator('.conflict-resolution-view .list-view-row')
    .filter({ has: p.getByText(label, { exact: true }) })
    .first()
  await expect(row).toBeVisible({ timeout: 15000 })
  await row.click()
  // Give the panels a beat to re-render against the newly selected entry.
  await p.waitForTimeout(300)
})

// ── Renaming, and the name as a conflict field ────────────────────────

When('{string} renames the request {string} to {string}', async ({ collab }, actor: string, from: string, to: string) => {
  const p = collab.pageOf(actor)
  const row = sidebarRowByName(p, from)
  if (!(await row.isVisible().catch(() => false))) {
    await expandAllSidebarRows(p)
  }
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.click()
  // F2 is the ListView's rename shortcut, handled on the list root — the
  // rows themselves aren't focusable, and clicking one also opens its
  // editor tab, so focus has to be put back on the list before pressing.
  const list = p.locator('[data-testid="sidebar-listview"] .list-view[tabindex="0"]:visible').first()
  await expect(list).toBeVisible({ timeout: 10000 })
  await list.press('F2')
  const input = p.locator('.list-view-rename-input:visible').first()
  await expect(input).toBeVisible({ timeout: 10000 })
  await input.fill(to)
  await p.keyboard.press('Enter')
  await expect(sidebarRowByName(p, to)).toBeVisible({ timeout: 10000 })
  // Let the rename reach the autosave that the push step depends on.
  await p.waitForTimeout(1500)
})

Then('{string} sees the name {string} on the user side', async ({ collab }, actor: string, name: string) => {
  const p = collab.pageOf(actor)
  const input = p.locator('[data-testid="conflict-panel-user-name-input-input"]')
  await expect(input).toBeVisible({ timeout: 15000 })
  await expect(input).toHaveValue(name)
})

Then('{string} sees the name {string} on the server side', async ({ collab }, actor: string, name: string) => {
  const p = collab.pageOf(actor)
  const input = p.locator('[data-testid="conflict-panel-server-name-input-input"]')
  await expect(input).toBeVisible({ timeout: 15000 })
  await expect(input).toHaveValue(name)
})

Then('{string} cannot edit the name on the user side', async ({ collab }, actor: string) => {
  const p = collab.pageOf(actor)
  // The comparison columns show what each side chose; only the resolved
  // column is an editor.
  const input = p.locator('[data-testid="conflict-panel-user-name-input-input"]')
  await expect(input).toHaveJSProperty('readOnly', true)
})

When('{string} types {string} as the resolved name', async ({ collab }, actor: string, name: string) => {
  const p = collab.pageOf(actor)
  const input = p.locator('[data-testid="conflict-panel-resolved-name-input-input"]')
  await expect(input).toBeVisible({ timeout: 15000 })
  await input.fill(name)
  // The box is fed from the resolved copy, so it only keeps the typed value
  // if the rename actually landed in state.
  await expect(input).toHaveValue(name)
  await p.waitForTimeout(300)
})

Then('{string} has {int} request(s) named {string} in {string} on disk', ({ collab }, actor: string, count: number, name: string, fileName: string) => {
  // The sidebar can only be trusted once the file itself is known good —
  // a merge that duplicated or dropped an entity looks like a display bug
  // otherwise.
  const content = readFileSync(join(collab.repoDirOf(actor), fileName), 'utf-8')
  const occurrences = content.split(`name: ${name}`).length - 1
  expect(occurrences).toBe(count)
})

Then('{string} sees the request {string} in his sidebar', async ({ collab }, actor: string, name: string) => {
  const p = collab.pageOf(actor)
  const row = sidebarRowByName(p, name)
  if (!(await row.isVisible().catch(() => false))) {
    await expandAllSidebarRows(p)
  }
  await expect(row).toBeVisible({ timeout: 15000 })
})

// ── Deletions, tags and tree structure ────────────────────────────────

/** Repository-level fixture the app cannot produce on its own: the
 * colleague works in a scratch clone, so their side of the merge exists
 * without a second instance. The project CONTENT still comes from the app
 * — this only removes a block that the app itself wrote. */
When('a colleague deletes the request {string} from {string}', ({ collab }, requestName: string, fileName: string) => {
  collab.collaboratorDeletesRequest(fileName, requestName)
})

When('{string} tags the open request with {string}', async ({ collab }, actor: string, tag: string) => {
  const p = collab.pageOf(actor)
  // Tags are the bookmark ribbons on the workbench tab header: the "+"
  // opens an inline field, Enter (or the confirm button) commits.
  const add = p.locator('[data-testid$="-bookmarks-add"]:visible').first()
  await expect(add).toBeVisible({ timeout: 15000 })
  await add.click()
  const input = p.locator('[data-testid$="-bookmarks-add-input-input"]:visible').first()
  await expect(input).toBeVisible({ timeout: 10000 })
  await input.fill(tag)
  await p.locator('[data-testid$="-bookmarks-add-confirm"]:visible').first().click()
  // Let the new tag reach the autosave the push step depends on.
  await p.waitForTimeout(1500)
})

When('a colleague tags the request {string} with {string} in {string}', ({ collab }, requestName: string, tag: string, fileName: string) => {
  collab.collaboratorTagsRequest(fileName, requestName, tag)
})

When('{string} pulls', async ({ collab }, actor: string) => {
  const p = collab.pageOf(actor)
  await openGitMenu(p)
  await p.locator('[data-testid="titlebar-menu-item-git-pull"]').click()
  // The pull saves, fetches, merges and re-opens the project; wait for the
  // tree to settle rather than racing the next assertion.
  await p.waitForTimeout(2500)
})

Then('{string} does not see the request {string} in his sidebar', async ({ collab }, actor: string, name: string) => {
  const p = collab.pageOf(actor)
  await expandAllSidebarRows(p)
  await expect(sidebarRowByName(p, name)).toHaveCount(0, { timeout: 15000 })
})

Then('{string} sees the tags tab as the only tab', async ({ collab }, actor: string) => {
  const p = collab.pageOf(actor)
  const userPanel = p.locator('[data-testid="conflict-panel-user"]')
  await expect(userPanel).toBeVisible({ timeout: 15000 })
  // Nothing else diverges, so the strip carries the tag tab alone.
  await expect(userPanel.locator('[role="tab"]')).toHaveCount(1, { timeout: 15000 })
  await userPanel.locator('[role="tab"]').first().click()
  await p.waitForTimeout(500)
})

Then('{string} sees the tag {string} on the user side', async ({ collab }, actor: string, tag: string) => {
  const p = collab.pageOf(actor)
  const panel = p.locator('[data-testid="conflict-panel-user"]')
  await expect(panel.locator('input[data-testid$="-input-0-input"]').first()).toHaveValue(tag, { timeout: 15000 })
})

Then('{string} sees the tags tab', async ({ collab }, actor: string) => {
  const p = collab.pageOf(actor)
  const userPanel = p.locator('[data-testid="conflict-panel-user"]')
  await expect(userPanel).toBeVisible({ timeout: 15000 })
  const tab = userPanel.getByRole('tab', { name: /tags|étiquettes/i })
  await expect(tab).toBeVisible({ timeout: 15000 })
  // A tab's content only mounts once selected, and the selection is shared
  // across the three columns — one click puts every side on the tag list.
  await tab.click()
  await p.waitForTimeout(500)
})

Then('{string} sees the tag {string} on the server side', async ({ collab }, actor: string, tag: string) => {
  const p = collab.pageOf(actor)
  const panel = p.locator('[data-testid="conflict-panel-server"]')
  // The tag panel's testid carries its mode, so its inputs read
  // `conflict-tags-<mode>-input-<n>`; scoping by column disambiguates the
  // two read-only sides.
  // ECUI's InputBox suffixes the real <input> with `-input` again, so the
  // tag row's field is `conflict-tags-<mode>-input-<n>-input`.
  await expect(panel.locator('input[data-testid$="-input-0-input"]').first()).toHaveValue(tag, { timeout: 15000 })
})

// ── Tree structure (inter-folder moves) ───────────────────────────────

// MIME marking a ListView item drag — must match LIST_VIEW_DRAG_MIME in ECUI.
const LIST_VIEW_DRAG_MIME = 'application/x-listview-item'

/**
 * Drag a sidebar row onto a folder row. A manual HTML5 sequence sharing one
 * `DataTransfer` (the same approach `sidebar-split-drop` uses): Playwright's
 * mouse-based dragTo is unreliable for HTML5 DnD under xvfb, and the real
 * `DataTransfer` payload is what the sidebar's drop handler reads.
 */
When('{string} moves the request {string} into the folder {string}', async ({ collab }, actor: string, requestName: string, folderName: string) => {
  const p = collab.pageOf(actor)
  await expandAllSidebarRows(p)
  const row = sidebarRowByName(p, requestName)
  await expect(row).toBeVisible({ timeout: 10000 })
  const itemId = await row.getAttribute('data-item-id')
  if (itemId === null) throw new Error(`sidebar row "${requestName}" has no data-item-id`)
  const folderRow = sidebarRowByName(p, folderName)
  await expect(folderRow).toBeVisible({ timeout: 10000 })
  const folderId = await folderRow.getAttribute('data-item-id')
  if (folderId === null) throw new Error(`sidebar row "${folderName}" has no data-item-id`)

  await p.evaluate(async ({ itemId, folderId, mime }) => {
    const inSidebar = (id: string): Element | null =>
      document.querySelector(`[data-testid="sidebar-listview"] [data-item-id="${id}"]`)
    const source = inSidebar(itemId)
    const target = inSidebar(folderId)
    if (!source) throw new Error(`drag source not found for item ${itemId}`)
    if (!target) throw new Error(`drop target not found for folder ${folderId}`)
    const rect = target.getBoundingClientRect()
    const clientX = Math.round(rect.left + rect.width / 2)
    const clientY = Math.round(rect.top + rect.height / 2)
    const dt = new DataTransfer()
    dt.setData('text/plain', itemId)
    dt.setData(mime, itemId)
    const fire = (node: Element, type: string): void => {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX, clientY })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      node.dispatchEvent(ev)
    }
    // The ListView records its drag source in React state on `dragstart`,
    // so the drop must land in a LATER tick — fired in the same one, the
    // drop handler still reads "no source" and silently does nothing.
    fire(source, 'dragstart')
    await new Promise((resolve) => setTimeout(resolve, 100))
    fire(target, 'dragenter')
    fire(target, 'dragover')
    await new Promise((resolve) => setTimeout(resolve, 50))
    fire(target, 'drop')
  }, { itemId, folderId, mime: LIST_VIEW_DRAG_MIME })
  // Let the move reach the autosave the push step depends on.
  await p.waitForTimeout(2000)

  // A silently-ignored drop would surface three steps later as "nothing to
  // push", which says nothing about the cause. Check the tree here.
  const parentOnDisk = await p.evaluate(({ itemId, folderId }) => {
    const row = document.querySelector(`[data-testid="sidebar-listview"] [data-item-id="${itemId}"]`)
    const target = document.querySelector(`[data-testid="sidebar-listview"] [data-item-id="${folderId}"]`)
    return {
      itemDepth: row?.getAttribute('data-depth') ?? null,
      folderDepth: target?.getAttribute('data-depth') ?? null
    }
  }, { itemId, folderId })
  expect(
    parentOnDisk.itemDepth !== null && parentOnDisk.folderDepth !== null &&
    Number(parentOnDisk.itemDepth) === Number(parentOnDisk.folderDepth) + 1,
    `the drag did not reparent "${requestName}" under "${folderName}" ` +
    `(item depth ${String(parentOnDisk.itemDepth)}, folder depth ${String(parentOnDisk.folderDepth)})`
  ).toBe(true)
})

Then('{string} sees the tree-structure conflict listing {string} as moved', async ({ collab }, actor: string, requestName: string) => {
  const p = collab.pageOf(actor)
  const userPanel = p.locator('[data-testid="conflict-panel-user-tree"]')
  await expect(userPanel).toBeVisible({ timeout: 15000 })
  // Rendered through the sidebar's own ListView, so the row carries the
  // same id attribute the sidebar uses.
  const row = userPanel.locator('.list-view-row').filter({ has: p.getByText(requestName, { exact: true }) })
  await expect(row.first()).toBeVisible({ timeout: 15000 })
  // The outline is a scoped rule naming exactly the contested ids.
  const rule = await userPanel.locator('style').first().textContent()
  const itemId = await row.first().getAttribute('data-item-id')
  expect(rule ?? '').toContain(`[data-item-id="${itemId ?? ''}"]`)
})

// ── The file rewritten outside the app (terminal checkout) ────────────

When(
  'the branch {string} renaming {string} to {string} is checked out from a terminal in {string}',
  ({ collab }, branch: string, oldName: string, newName: string, fileName: string) => {
    // Stands in for the user running git in another terminal while the
    // project is open: the branch is built, then checked out, so the
    // working tree changes under a running app that knows nothing of it.
    const dir = collab.repoDirOf('Yoann')
    const file = join(dir, fileName)
    execSync(`git checkout -b ${branch}`, { cwd: dir, stdio: 'ignore', env: gitEnv() })
    writeFileSync(file, readFileSync(file, 'utf-8').replace(`name: ${oldName}`, `name: ${newName}`), 'utf-8')
    execSync('git commit -am "renommage sur la branche"', { cwd: dir, stdio: 'ignore', env: gitEnv() })
    execSync(`git checkout ${branch}`, { cwd: dir, stdio: 'ignore', env: gitEnv() })
  }
)

const EXTERNAL_CHANGE_BUTTON_KEYS = ['file.externalChange.reload', 'file.externalChange.keepMine'] as const

When(
  '{string} will answer {string} to the file-changed-on-disk question',
  async ({ collab }, actor: string, answer: string) => {
    // The prompt is a native message box, so it can only be driven
    // through the system-modals mock — configured one-shot, before the
    // save that raises it.
    await configureNextConfirmationDialogForE2E(collab.appOf(actor), {
      buttonKeys: EXTERNAL_CHANGE_BUTTON_KEYS,
      choiceKey: answer === 'reload' ? 'file.externalChange.reload' : 'file.externalChange.keepMine'
    })
  }
)

When('{string} saves his project', async ({ collab }, actor: string) => {
  const p = collab.pageOf(actor)
  await p.keyboard.press('Control+s')
  await p.waitForTimeout(2000)
})
