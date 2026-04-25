import { createBdd } from 'playwright-bdd'
import { copyFileSync } from 'fs'
import { join, resolve } from 'path'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import {
  configureNextOpenDialogForE2E,
  configureNextSaveFileDialogForE2E
} from 'electron-core-ui/testing'
import { test, expect, AUTH_LOGIN_TEMP_DIR } from '../../fixtures/auth-login.fixture'

const SAMPLES_DIR = resolve(__dirname, '../../../samples')
const AUTH_LOGIN_SAMPLE = join(SAMPLES_DIR, 'auth-login-sample.restorm')
const AUTH_SERVICE_BASE = 'http://localhost:5110'
const PET_SWAGGER_URL = `${AUTH_SERVICE_BASE}/swagger.json`
const VALID_CLIENT_ID = 'VALID_CLIENT_ID'

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null

function requirePage(): Page {
  if (!page) throw new Error('app must be launched before driving UI steps')
  return page
}

function requireApp(): ElectronApplication {
  if (!electronApp) throw new Error('app must be launched before configuring dialogs')
  return electronApp
}

function sidebarRowByName(currentPage: Page, name: string): Locator {
  return currentPage
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: currentPage.getByText(name, { exact: true }) })
    .first()
}

async function expandRowIfCollapsed(currentPage: Page, name: string): Promise<void> {
  const row = sidebarRowByName(currentPage, name)
  if (await row.count() === 0) return
  const expanded = await row.getAttribute('aria-expanded')
  if (expanded !== 'true') await row.click()
}

/**
 * POST a test-only endpoint on the auth-service with no body. Throws a
 * helpful error when the service is unreachable so the developer knows
 * to run `docker compose up -d auth-service` before the test.
 */
async function postToAuthService(path: string): Promise<void> {
  try {
    const res = await fetch(`${AUTH_SERVICE_BASE}${path}`, { method: 'POST' })
    if (!res.ok) {
      throw new Error(`${path} -> ${res.status} ${res.statusText}`)
    }
  } catch (err) {
    throw new Error(
      `Failed to reach auth-service at ${AUTH_SERVICE_BASE}${path}. ` +
      'Start the container with `docker compose -f restorm/tests/docker/docker-compose.yml up -d auth-service` ' +
      `before running this scenario. Underlying error: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

Given('I open the auth-login sample collection', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const workingCopy = join(AUTH_LOGIN_TEMP_DIR, 'auth-login-sample.restorm')
  copyFileSync(AUTH_LOGIN_SAMPLE, workingCopy)

  await configureNextOpenDialogForE2E(requireApp(), { kind: 'openFile', path: workingCopy })
  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await page.locator('[data-testid="titlebar-menu-item-open"]').first().click()

  await expect(sidebarRowByName(page, 'Auth Service')).toBeVisible({ timeout: 10000 })
})

Then('the sidebar should show the {string} auth request', async ({}, name: string) => {
  const p = requirePage()
  await expandRowIfCollapsed(p, 'Auth Service')
  await expect(sidebarRowByName(p, name)).toBeVisible({ timeout: 5000 })
})

Then('the sidebar should show the {string} folder', async ({}, name: string) => {
  const p = requirePage()
  await expandRowIfCollapsed(p, 'Auth Service')
  await expect(sidebarRowByName(p, name)).toBeVisible({ timeout: 5000 })
})

Then(
  'the sidebar should show the {string} request under {string}',
  async ({}, requestName: string, parentFolder: string) => {
    const p = requirePage()
    await expandRowIfCollapsed(p, 'Auth Service')
    await expandRowIfCollapsed(p, parentFolder)
    await expect(sidebarRowByName(p, requestName)).toBeVisible({ timeout: 5000 })
  }
)

// ──────────────────────────────────────────────────────────────────────
// Scenario 2 — import the pet swagger with inline auth setup
// ──────────────────────────────────────────────────────────────────────

Given('the auth service logs and tokens are cleared', async () => {
  // Fired BEFORE the app launches so the log store carries only
  // what the scenario itself produces. The fixture later posts
  // `/cleartokens` a second time if we need to force a retry-on-401
  // path — kept here just for the clean-slate invariant.
  await postToAuthService('/clear_logs')
  await postToAuthService('/cleartokens')
})

Given('I create a new empty restorm file', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const target = join(AUTH_LOGIN_TEMP_DIR, 'auth-login-import.restorm')
  await configureNextSaveFileDialogForE2E(requireApp(), { kind: 'saveFile', path: target })

  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(page.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  const saveOptionsModal = page.locator('[data-testid="save-options-modal"]')
  await expect(saveOptionsModal).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="save-mode-file"]').click()
  await page.locator('[data-testid="save-format-yaml"]').click()
  await page.locator('[data-testid="save-confirm-button"]').click()
  await expect(saveOptionsModal).not.toBeVisible({ timeout: 2000 })
  await page.waitForTimeout(500)
})

When('I open the import modal and paste the pet swagger URL', async () => {
  const p = requirePage()
  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 2000 })

  // InputBox's `data-testid` lands on a wrapper; the actual `<input>`
  // gets the same name suffixed with `-input`.
  await p.locator('[data-testid="source-input-input"]').fill(PET_SWAGGER_URL)
})

Then('the import modal should show a 401 error', async () => {
  const p = requirePage()
  const errorBox = p.locator('[data-testid="import-modal"] .import-error')
  await expect(errorBox).toBeVisible({ timeout: 10000 })
  // The server returns 401; the import fetcher surfaces the status
  // code (and/or body) in the error message.
  await expect(errorBox).toContainText('401', { timeout: 5000 })
})

When('I click the {string} button', async ({}, label: string) => {
  const p = requirePage()
  // We only have one button the scenarios use — match by its stable
  // testid rather than the i18n label.
  if (label === 'Add an authentication route') {
    await p.locator('[data-testid="import-add-auth-button"]').click()
    await expect(p.locator('[data-testid="authentication-setup-modal"]')).toBeVisible({ timeout: 3000 })
    return
  }
  throw new Error(`Unhandled click-button label: ${label}`)
})

When('I configure the login request with the valid client id', async () => {
  const p = requirePage()

  await p.locator('[data-testid="local-auth-form-url-input-input"]').fill(`${AUTH_SERVICE_BASE}/login`)

  // Switch body mode to x-www-form-urlencoded so we can fill a plain
  // `client_id` row via the KeyValueTable (the service accepts either
  // form or JSON). Monaco-via-keyboard is too flaky to rely on inside
  // Playwright-BDD.
  const bodyModeRadio = p.locator('[data-testid="local-auth-form-body-mode"]')
  await bodyModeRadio.getByText('x-www-form-urlencoded').click()

  const fieldsTable = p.locator('[data-testid="local-auth-form-body-fields-table"]')
  // First row is seeded empty — reuse it rather than adding a fresh
  // one on top.
  const firstRow = fieldsTable.locator('tbody tr').first()
  await firstRow.locator('td').nth(2).locator('input').first().fill('client_id')
  await firstRow.locator('td').nth(3).locator('input').first().fill(VALID_CLIENT_ID)
})

When('I send the inline authentication request', async () => {
  const p = requirePage()

  // The /login endpoint is gated — the response won't return until
  // we call /releaselogins. Fire Send, then release from the test
  // code. The inline Send button turns into a Cancel while in-flight;
  // we wait for it to flip back (or for the produced-headers table to
  // populate via auto-fill) to confirm the flow completed.
  await p.locator('[data-testid="local-auth-form-send-button"]').click()
  await p.waitForTimeout(200) // give the UI a moment to register in-flight state

  // Release — this unblocks every /login currently queued on the gate
  // (the auth-service returns 200 with the OAuth-shaped payload, and
  // the renderer's auto-fill populates the Configuration tab).
  const res = await fetch(`${AUTH_SERVICE_BASE}/releaselogins`)
  if (!res.ok) throw new Error(`/releaselogins -> ${res.status} ${res.statusText}`)

  // The auto-fill path switches the form to the Configuration tab and
  // mounts the produced-headers table — wait for that as the signal
  // that the send completed successfully and the response was parsed.
  await expect(p.locator('[data-testid="local-auth-form-produced-headers-table"]')).toBeVisible({ timeout: 10000 })
})

Then('the authentication Configuration tab should show an expiration expression', async () => {
  const p = requirePage()
  // The expiration field is a Monaco-backed `RestormVariableInputBox`;
  // its value lives in the editor model, not in a plain `<input>` or
  // `<textarea>` value attribute. Check the rendered text via
  // `toContainText` on the wrapper instead of the input value.
  const expiration = p.locator('[data-testid="local-auth-form-expiration"]')
  await expect(expiration).toContainText('{{expires_in}}', { timeout: 5000 })
})

Then('the authentication Configuration tab should carry an Authorization produced header', async () => {
  const p = requirePage()
  // Auto-fill appends a row with key "Authorization" and value
  // `{{token_type}} {{access_token}}`. KV-table key/value inputs are
  // React-controlled (`.value` DOM property, not `value` attribute),
  // so their text doesn't appear in textContent. The VALUE column
  // renders the template via a Monaco-backed `RestormVariableInputBox`
  // that DOES lay out the token as visible spans — we assert on that
  // as a reliable marker that the Authorization row was populated.
  const table = p.locator('[data-testid="local-auth-form-produced-headers-table"]')
  await expect(table).toContainText('{{token_type}} {{access_token}}', { timeout: 5000 })
})

When('I confirm the authentication setup', async () => {
  const p = requirePage()
  await p.locator('[data-testid="authentication-setup-attach"]').click()
  // The attach handler fires `api.prefetch` → another gated /login.
  // Release it so the modal can close and the import can re-run with
  // the resolved Bearer token.
  await p.waitForTimeout(300)
  const res = await fetch(`${AUTH_SERVICE_BASE}/releaselogins`)
  if (!res.ok) throw new Error(`/releaselogins -> ${res.status} ${res.statusText}`)
  await expect(p.locator('[data-testid="authentication-setup-modal"]')).not.toBeVisible({ timeout: 15000 })
})

Then('the import modal should show the pet swagger preview without error', async () => {
  const p = requirePage()
  // After the attach callback's prefetch returns, ImportModal re-runs
  // the URL fetch with the resolved Bearer token. /swagger.json is
  // not gated, so no further release is needed — just wait for the
  // preview list to mount.
  await expect(p.locator('[data-testid="preview-list"]')).toBeVisible({ timeout: 15000 })
  await expect(p.locator('[data-testid="import-modal"] .import-error')).not.toBeVisible()
})

When('I import the previewed routes', async () => {
  const p = requirePage()
  await p.locator('[data-testid="import-button"]').click()
  await expect(p.locator('[data-testid="import-modal"]')).not.toBeVisible({ timeout: 10000 })
  // Wait for the sidebar to settle on the imported tree — the pet
  // request row becomes the reliable anchor.
  await expect(sidebarRowByName(p, 'Find pet by ID')).toBeVisible({ timeout: 10000 })
})

async function openEnvFolderInWorkbench(p: Page): Promise<void> {
  // Click the imported env-folder row in the sidebar to mount the
  // EnvironmentFolderView in the workbench tab area. The view opens
  // on the "Home" tab by default — switch to "Configuration" so the
  // env list + variables table become reachable.
  const folderRow = sidebarRowByName(p, 'Auth Test Service — Pet API')
  await expect(folderRow).toBeVisible({ timeout: 5000 })
  await folderRow.click()
  await p.getByRole('tab', { name: 'Configuration' }).click()
  await expect(p.locator('[data-testid="environment-folder-sash-container"]')).toBeVisible({ timeout: 10000 })
}

async function selectEnvByName(p: Page, name: string): Promise<void> {
  const list = p.locator('[data-testid="environment-folder-environment-list"]')
  await list
    .locator('.list-view-row')
    .filter({ has: p.getByText(name, { exact: true }) })
    .first()
    .click()
}

async function renameSelectedEnv(p: Page, newName: string): Promise<void> {
  // F2 enters rename mode on the focused list row (per
  // EnvironmentFolderView.tsx context-menu wiring); the inline edit
  // input is whatever the ListView focuses after entering rename mode.
  await p.keyboard.press('F2')
  // After F2, the row swaps in an `<input>` for inline rename. Find
  // the focused input and replace its content.
  const editing = p.locator('[data-testid="environment-folder-environment-list"] input:focus').first()
  await expect(editing).toBeVisible({ timeout: 3000 })
  await p.keyboard.press('Control+A')
  await p.keyboard.press('Delete')
  await p.keyboard.type(newName, { delay: 5 })
  await p.keyboard.press('Enter')
}

When('I rename the imported environment to {string}', async ({}, name: string) => {
  const p = requirePage()
  await openEnvFolderInWorkbench(p)
  // The swagger 2.0 importer names the auto-created env after the
  // spec's `host` (without port). For our service that's "localhost".
  await selectEnvByName(p, 'localhost')
  await renameSelectedEnv(p, name)
  // Verify the row label flipped — the rename callback fires on Enter
  // and the list re-renders with the new name.
  await expect(sidebarRowByName(p, name)).toBeVisible({ timeout: 5000 }).catch(() => undefined)
  await expect(
    p.locator('[data-testid="environment-folder-environment-list"]')
      .locator('.list-view-row')
      .filter({ has: p.getByText(name, { exact: true }) })
      .first()
  ).toBeVisible({ timeout: 5000 })
})

When('I add a {string} variable with value {string}', async ({}, key: string, value: string) => {
  const p = requirePage()
  // The pane header sits over the add-variable button when the layout
  // has just been swapped from sidebar-only to sidebar+variables;
  // `force: true` bypasses Playwright's "element intercepts pointer
  // events" guard since the button itself is visible and enabled.
  await p.locator('[data-testid="environment-folder-add-variable-button"]').click({ force: true })
  // The new row is the last one — RestormKeyValueTable's InputBox cells
  // expose `${testId}-key-input` (wrapper) and `${testId}-key-input-input`
  // (the actual <input>). The wrapper accepts `fill()` too via Playwright's
  // input-element search, but `-input-input` is more explicit.
  const keyInputs = p.locator('[data-testid="environment-folder-variables-table-key-input-input"]')
  await keyInputs.last().fill(key)
  const valueInputs = p.locator('[data-testid="environment-folder-variables-table-value-input-string-input"]')
  await valueInputs.last().fill(value)
  // Settle the reactive emit (50 ms debounce) before the next step.
  await p.waitForTimeout(120)
})

When(
  'I add a sub-environment {string} with {string} set to {string}',
  async ({}, subName: string, key: string, value: string) => {
    const p = requirePage()
    // Right-click the renamed parent env to open its context menu.
    const list = p.locator('[data-testid="environment-folder-environment-list"]')
    const parentRow = list
      .locator('.list-view-row')
      .filter({ has: p.getByText('Valid environnement', { exact: true }) })
      .first()
    await parentRow.click({ button: 'right' })
    // ContextMenu items use the `role="menuitem"` aria role; the EN
    // label for `environment.addSub` is "Add sub-environment".
    await p.getByRole('menuitem', { name: 'Add sub-environment' }).click()
    // The new sub-env auto-names "New environment". Select + rename.
    await selectEnvByName(p, 'New environment')
    await renameSelectedEnv(p, subName)
    // Variables table now reflects the freshly-selected sub-env. Add
    // a single client_id row.
    // The pane header sits over the add-variable button when the layout
  // has just been swapped from sidebar-only to sidebar+variables;
  // `force: true` bypasses Playwright's "element intercepts pointer
  // events" guard since the button itself is visible and enabled.
  await p.locator('[data-testid="environment-folder-add-variable-button"]').click({ force: true })
    await p.locator('[data-testid="environment-folder-variables-table-key-input-input"]').last().fill(key)
    await p.locator('[data-testid="environment-folder-variables-table-value-input-string-input"]').last().fill(value)
    await p.waitForTimeout(120)
  }
)

When('I switch the imported authentication body client_id to the expression {string}', async ({}, expression: string) => {
  const p = requirePage()
  // Open the persisted auth route — `Authentication route` is the
  // default name the AuthenticationSetupModal stamps on the
  // ephemeral request before handing it back to the import.
  const authRow = sidebarRowByName(p, 'Authentication route')
  await expect(authRow).toBeVisible({ timeout: 5000 })
  await authRow.click()
  // Body fields table is `http-request-body-fields-table` (auth uses
  // HTTPRequestTabView). The first row carries `client_id` →
  // `VALID_CLIENT_ID` from the inline form. Replace the value with
  // the handlebars expression so the env's `client_id` resolves at
  // dispatch.
  const valueInput = p.locator('[data-testid="http-request-body-fields-table-value-input-string-input"]').first()
  await expect(valueInput).toBeVisible({ timeout: 10000 })
  await valueInput.fill(expression)
  await p.waitForTimeout(120)
})

When('I open the pet request in a tab', async () => {
  const p = requirePage()
  // Expand the env folder + any default `Other` tag group the
  // swagger importer creates for untagged operations.
  await expandRowIfCollapsed(p, 'Auth Test Service — Pet API')
  await expandRowIfCollapsed(p, 'Other')
  const row = sidebarRowByName(p, 'Find pet by ID')
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click()
  // Wait for the request tab's Path Params pane (always mounted on
  // the Request tab, unlike the URL bar which is a Monaco editor we
  // can't `fill()` reliably).
  const pathParamsTable = p.locator('[data-testid="http-request-path-params-table"]')
  await expect(pathParamsTable).toBeVisible({ timeout: 10000 })
  // Fill the `id` path param. The imported URL is
  // `{{baseUrl}}/pet/{{id}}` — `{{baseUrl}}` resolves via the env
  // folder (scheme=http, host=localhost:5110, basePath=/), and
  // `{{id}}` picks up the path-param value we set here. td layout:
  // [drag, enabled, key, value, mode, description, trash]; the plain
  // "abc" mode uses a regular `<input>` the tests can target.
  const idRow = pathParamsTable.locator('tbody tr').first()
  await idRow.locator('td').nth(3).locator('input').first().fill('1')
})

When('I send the pet request twice', async () => {
  const p = requirePage()
  const sendBtn = p.locator('[data-testid="http-request-send-button"]:visible')
  const body = p.locator('[data-testid="http-response-body-editor"]:visible')

  // 1st send: auth cache is cold for this (persisted) auth request id
  // → HTTPExecutionService fires /login first. Give the IPC a moment
  // to reach the gate, then release.
  await sendBtn.click()
  await p.waitForTimeout(400)
  await fetch(`${AUTH_SERVICE_BASE}/releaselogins`)
  await expect(body).toContainText('Rex', { timeout: 15000 })

  // 2nd send: auth cache hit — no /login should fire. Release is a
  // no-op when nothing is waiting on the gate.
  await sendBtn.click()
  await expect(body).toContainText('Rex', { timeout: 15000 })
})

Then('the pet response body should contain {string}', async ({}, expected: string) => {
  const p = requirePage()
  await expect(p.locator('[data-testid="http-response-body-editor"]:visible')).toContainText(expected, { timeout: 5000 })
})

When('I clear the issued tokens', async () => {
  // Empties the service-side token store. Every previously-issued
  // Bearer token the app is holding in its auth cache is now stale —
  // the next downstream pet call will 401, triggering the auth-error-
  // code retry path (invalidate cache + refresh + re-fire request).
  await postToAuthService('/cleartokens')
})

When('I re-send the pet request', async () => {
  const p = requirePage()
  // Kick off the pet retry. DON'T release yet — the test wants to
  // observe the statusbar "running" feedback while /login sits on the
  // gate. The release comes in the follow-up step.
  await p.locator('[data-testid="http-request-send-button"]:visible').click()
})

Then('the statusbar auth indicator should show the running feedback', async () => {
  const p = requirePage()
  // `StatusbarAuthSelector` paints its element with inline
  // `background-color: #f97316` on the `auth:running` event's
  // `started` phase. Wait for that computed style to match — the
  // /login is gated, so the phase stays `started` until we release.
  const statusbar = p.locator('[data-testid="statusbar-auth-selector"]')
  await expect(statusbar).toHaveCSS('background-color', 'rgb(249, 115, 22)', { timeout: 10000 })
})

When('I release the pending login', async () => {
  const res = await fetch(`${AUTH_SERVICE_BASE}/releaselogins`)
  if (!res.ok) throw new Error(`/releaselogins -> ${res.status} ${res.statusText}`)
})

Then('the pet response body should still contain {string}', async ({}, expected: string) => {
  const p = requirePage()
  await expect(p.locator('[data-testid="http-response-body-editor"]:visible')).toContainText(expected, { timeout: 15000 })
})

When('I focus the {string} request tab', async ({}, tabName: string) => {
  const p = requirePage()
  const tab = p
    .locator('[role="tab"]')
    .filter({ has: p.getByText(tabName, { exact: true }) })
    .first()
  await expect(tab).toBeVisible({ timeout: 5000 })
  await tab.click()
  // Give the workbench a moment to flip the active-tab modifier so
  // the statusbar env selector reflects the newly-focused tab's env.
  await p.waitForTimeout(150)
})

When(
  'I select the {string} environment for the active tab without apply-to-all',
  async ({}, envName: string) => {
    const p = requirePage()
    await p.locator('[data-testid="statusbar-env-selector"]').click()
    const popover = p.locator('[data-testid="statusbar-env-selector-listview"]')
    await expect(popover).toBeVisible({ timeout: 5000 })
    // Uncheck apply-to-all if checked — we want the env to land only
    // on the focused tab. The checkbox is checked by default.
    const applyToAll = popover.locator('[data-testid="statusbar-env-selector-apply-to-all-input"]')
    if (await applyToAll.isChecked()) {
      await applyToAll.click()
    }
    await popover
      .locator('[role="option"]')
      .filter({ has: p.getByText(envName, { exact: true }) })
      .first()
      .click()
    await p.waitForTimeout(200)
  }
)

When(
  'I switch the active environment to the {string} sub-env with apply-to-all',
  async ({}, subEnvName: string) => {
    const p = requirePage()
    // Open the statusbar env selector popover.
    await p.locator('[data-testid="statusbar-env-selector"]').click()
    const popover = p.locator('[data-testid="statusbar-env-selector-listview"]')
    await expect(popover).toBeVisible({ timeout: 5000 })
    // Make sure "Apply to all" is checked — earlier steps in the
    // scenario may have toggled it off to set per-tab envs. Re-checking
    // is a no-op when it was already on.
    const applyToAll = popover.locator('[data-testid="statusbar-env-selector-apply-to-all-input"]')
    if (!(await applyToAll.isChecked())) {
      await applyToAll.click()
    }
    await expect(applyToAll).toBeChecked()
    // Click the env item by visible name. `[role="option"]` filters to
    // the env rows (skipping the apply-to-all label).
    await popover
      .locator('[role="option"]')
      .filter({ has: p.getByText(subEnvName, { exact: true }) })
      .first()
      .click()
    // Popover closes on selection — the StatusbarElement tooltip is
    // dismissed when its body fires a click. Give a beat for the env
    // change to ripple through to providers.
    await p.waitForTimeout(200)
  }
)

Then('the pet response should fail with a 401', async () => {
  const p = requirePage()
  // The Infos pane carries a stable status-code line. The body may
  // still hold the previous Rex payload if the response panel doesn't
  // render error JSON inline, so inspect the Infos tab text.
  const infos = p.locator('[data-testid="base-request-tabs-response"]:visible').first()
  await expect(infos).toContainText('401', { timeout: 15000 })
})

Then('an authentication-failure toast should appear with a link to the auth route', async () => {
  const p = requirePage()
  // Toast renders inside the global `app` toaster. Wait for our
  // dedicated body wrapper to mount, then verify the open-link is
  // present.
  const toast = p.locator('[data-testid="auth-failure-toast"]:visible').first()
  await expect(toast).toBeVisible({ timeout: 15000 })
  await expect(p.locator('[data-testid="auth-failure-toast-open-link"]:visible').first()).toBeVisible()
})

When('I click the {string} link in the toast', async ({}, _label: string) => {
  const p = requirePage()
  await p.locator('[data-testid="auth-failure-toast-open-link"]:visible').first().click()
})

Then('the authentication route tab should become active', async () => {
  const p = requirePage()
  // The active workbench tab carries the `tab-active` modifier (set by
  // the Workbench component). The auth route tab's title is
  // "Authentication route" — assert that label sits inside the
  // currently-active tab.
  const activeTab = p.locator('.tab.tab-active, .tab[aria-selected="true"]').first()
  await expect(activeTab).toContainText('Authentication route', { timeout: 5000 })
})

Then('the authentication-failure toast should disappear', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="auth-failure-toast"]')).toHaveCount(0, { timeout: 5000 })
})

When('I send the authentication request directly', async () => {
  const p = requirePage()
  // We're now on the auth route tab — the visible Send button
  // belongs to that tab. The request is `POST /login` and goes
  // through `http.execute` WITHOUT touching the auth cache (the auth
  // route doesn't authenticate itself), so this should NOT fire any
  // `auth:failed` event.
  await p.locator('[data-testid="http-request-send-button"]:visible').click()
  // Brief wait for the IPC to reach the gate before the test releases
  // it in the next step.
  await p.waitForTimeout(300)
})

Then('no authentication-failure toast should appear', async () => {
  const p = requirePage()
  // Wait for the auth response to land (status 401 in the visible
  // Infos pane confirms the call round-tripped).
  await expect(p.locator('[data-testid="base-request-tabs-response"]:visible').first())
    .toContainText('401', { timeout: 15000 })
  // Then assert the toast hasn't reappeared. Wait a fixed window so a
  // late event would have fired by now.
  await p.waitForTimeout(800)
  await expect(p.locator('[data-testid="auth-failure-toast"]')).toHaveCount(0)
})
