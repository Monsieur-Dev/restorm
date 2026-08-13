import { test, expect, type Page, type Locator } from '@playwright/test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { configureNextOpenDialogForE2E } from 'electron-core-ui/testing'
import { launchRestormElectronApp, writeAppLogs } from '../helpers/launch-restorm'
import { loginViaLoopback } from '../helpers/workos-login'
import { setupReferenceWorkingCopy } from '../bdd/scenario-runlog/runLogShared'

/**
 * STAGE-ONLY entitlement-gating lifecycle e2e — a non-regression guard for the
 * WHOLE gating cycle end-to-end, against the REAL dev backend (dev WorkOS +
 * dev Supabase). It is NOT part of the per-PR / pre-push suite: it is included
 * in the Playwright config only when `RESTORM_E2E_STAGE=1`, so a normal run
 * never sees it. Drive it deliberately:
 *
 *   RESTORM_E2E_STAGE=1 \
 *   E2E_LOGIN_EMAIL=… E2E_LOGIN_PASSWORD=… \
 *   xvfb-run -a pnpm exec playwright test --project stage-gating
 *
 * The flow, on a real opened project/scenario:
 *   1. Signed out (Community): plan badge = Community; step-debug gated;
 *      MCP-Pro gated.
 *   2. Log in the dev test user (real WorkOS email/password) — Pro on dev.
 *   3. Signed in (Pro): badge = Pro; step-debug ungated; MCP-Pro open.
 *   4. Sign out via the account card → confirm.
 *   5. Signed out (Community) again: everything re-gated.
 *
 * The app is pointed at the DEV backend via `RESTORM_E2E_BACKEND_VERSION`: a
 * real preview build carries a `-preview` package version (→ dev Supabase via
 * `resolveChannel`), but the unpackaged e2e build can't read that version, so we
 * pin a `-preview` version to force the dev/preview channel.
 *
 * Login automation: the app normally opens the WorkOS auth URL in the SYSTEM
 * browser (which Playwright can't drive). In this unpackaged run we set
 * `RESTORM_E2E_AUTH_URL_FILE`, which makes the app write the auth URL to a file
 * instead of opening a browser (see authComposition `makeLoginOpenExternal`).
 * We read that URL, open it in a SEPARATE Playwright chromium context, fill the
 * WorkOS form, and submit — the app's loopback server captures the redirect and
 * exchanges the code for a session exactly as in production.
 *
 * The test user's org must be Pro on dev (provisioned once out-of-band). This
 * test performs NO plan writes — only a real login + logout.
 */

/** Reference-project tree path to a leaf scenario (opens the scenario editor,
 * whose inspector toolbar hosts the gated step-debug control). */
const SCENARIO_TREE_PATH = ['Auth Service', 'Pet API', 'Main']
const LEAF_SCENARIO = 'Logs'

function sidebarRowByName(p: Page, name: string): Locator {
  return p
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText(name, { exact: true }) })
    .first()
}

async function expandRowIfCollapsed(p: Page, name: string): Promise<void> {
  const row = sidebarRowByName(p, name)
  await expect(row).toBeVisible({ timeout: 15000 })
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click()
}

// ---- gating assertions (a single scenario editor stays open throughout) -----

async function expectPlanBadge(page: Page, plan: 'Community' | 'Pro'): Promise<void> {
  // The plan rides the statusbar cell's label text: `Restorm v<ver> - <Plan>`.
  await expect(page.locator('[data-testid="app-statusbar-version-plan-label"]')).toHaveText(
    new RegExp(` - ${plan}$`),
    { timeout: 60000 }
  )
}

async function expectStepDebugGated(page: Page, gated: boolean): Promise<void> {
  const gate = page.locator('[data-testid="scenario-inspector-step-gate"]')
  if (gated) {
    // Community: GatedControl wraps the button in its locked `data-gated` shell.
    await expect(gate).toHaveAttribute('data-gated', 'true', { timeout: 30000 })
  } else {
    // Pro: GatedControl is transparent — the wrapper is gone, the button remains.
    await expect(gate).toHaveCount(0, { timeout: 30000 })
    await expect(page.locator('[data-testid="scenario-inspector-step"]')).toBeVisible()
  }
}

async function expectMcpProGated(page: Page, gated: boolean): Promise<void> {
  await page.locator('[data-testid="statusbar-mcp-indicator"]').click()
  await expect(page.locator('[data-testid="statusbar-mcp-popover"]')).toBeVisible({ timeout: 10000 })
  const upsell = page.locator('[data-testid="statusbar-mcp-pro-upsell"]')
  if (gated) {
    await expect(upsell).toBeVisible({ timeout: 10000 })
  } else {
    await expect(upsell).toHaveCount(0, { timeout: 10000 })
  }
  // Dismiss the popover so it never overlays the next interaction.
  await page.keyboard.press('Escape')
}

test.describe.configure({ mode: 'serial' })

test('entitlement gating flips across the full login/logout lifecycle', async () => {
  // Dev test-user credentials — sourced from the environment so the secret is
  // never committed. Fail fast (not a silent skip) when unset; the throw also
  // narrows both to `string` for the rest of the test.
  const email = process.env.E2E_LOGIN_EMAIL
  const password = process.env.E2E_LOGIN_PASSWORD
  if (email === undefined || email.length === 0 || password === undefined || password.length === 0) {
    throw new Error(
      'E2E_LOGIN_EMAIL and E2E_LOGIN_PASSWORD must be set (dev WorkOS test user) — stage-gating hits the real dev backend'
    )
  }

  const restormRoot = process.cwd()
  const workDir = mkdtempSync(join(tmpdir(), 'restorm-stage-gating-'))
  const authUrlFile = join(workDir, 'auth-url.txt')

  const app = await launchRestormElectronApp({
    restormRoot,
    extraEnv: {
      ECUI_DISABLE_GPU: '1',
      RESTORM_E2E_AUTH_URL_FILE: authUrlFile,
      // The built (unpackaged) app can't read the `-preview` package version, so
      // pin it to the DEV/preview channel — this test must hit the dev backend.
      RESTORM_E2E_BACKEND_VERSION: '0.0.0-preview'
    }
  })

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('load')

    // Open the reference project + a leaf scenario so the inspector toolbar
    // (which hosts the gated step-debug control) is on screen.
    const project = setupReferenceWorkingCopy(workDir)
    await configureNextOpenDialogForE2E(app, { kind: 'openFile', path: project })
    await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
    await page.locator('[data-testid="titlebar-menu-item-open"]').first().click()
    await expect(sidebarRowByName(page, 'Auth Service')).toBeVisible({ timeout: 15000 })
    for (const folder of SCENARIO_TREE_PATH) await expandRowIfCollapsed(page, folder)
    await sidebarRowByName(page, LEAF_SCENARIO).click()
    await expect(page.locator('[data-testid="scenario-editor"]')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('[data-testid="scenario-inspector-toolbar"]')).toBeVisible({ timeout: 15000 })

    // 1) Signed out → Community, everything gated.
    await expectPlanBadge(page, 'Community')
    await expectStepDebugGated(page, true)
    await expectMcpProGated(page, true)

    // 2) Trigger login from the account card and complete the hosted AuthKit
    //    form in a separate headless browser (see helpers/workos-login).
    await loginViaLoopback(page, { authUrlFile, email, password })

    // 3) Signed in → Pro, everything ungated (auto-refresh flips the gates).
    await expectPlanBadge(page, 'Pro')
    await expectStepDebugGated(page, false)
    await expectMcpProGated(page, false)

    // 4) Sign out via the account card → confirm dialog → Oui.
    await page.locator('[data-testid="titlebar-account-button"]').click()
    await page.locator('[data-testid="account-card-sign-out"]').click()
    await expect(page.locator('[data-testid="account-sign-out-confirm"]')).toBeVisible({ timeout: 10000 })
    await page.locator('[data-testid="account-sign-out-confirm-yes"]').click()

    // 5) Signed out again → Community, everything re-gated.
    await expectPlanBadge(page, 'Community')
    await expectStepDebugGated(page, true)
    await expectMcpProGated(page, true)
  } finally {
    writeAppLogs(app, join(restormRoot, 'test-results', 'stage-gating'))
    // Kill rather than graceful-close: a still-pending loopback login keeps the
    // main process busy, so `app.close()` would hang to the test cap.
    try { app.process().kill('SIGKILL') } catch { /* already gone */ }
    await app.close().catch(() => undefined)
    rmSync(workDir, { recursive: true, force: true })
  }
})
