import { test as base } from 'playwright-bdd'
import { type ElectronApplication, type Page, expect } from '@playwright/test'
import { cpSync, mkdirSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { installSystemModalsMockingForE2E } from 'electron-core-ui/testing'
import { launchRestormElectronApp, writeAppLogs } from '../../helpers/launch-restorm'

export const DOC_SHOTS_TEMP_DIR = resolve(__dirname, '../../.tmp/doc-shots')
const RESTORM_ROOT = resolve(__dirname, '../../../..')

/**
 * Documentation-screenshot harness fixture — NOT a regression suite. The app
 * launches once per scenario with `RESTORM_DOC_CAPTURE=1`, which pins the
 * welcome screen's decorative surfaces (wallpaper variant, wordmark, vignette
 * frame) to fixed, static variants so captures are reproducible run-over-run.
 *
 * Environment contract (see the `doc-shots` project gate in
 * playwright.config.ts for the full run recipe):
 * - `DOC_SHOTS_EMAIL` / `DOC_SHOTS_PASSWORD` (required): the demo account,
 *   logged in through the REAL loopback flow against the channel selected by
 *   `DOC_SHOTS_VERSION` (default `1.0.0` → production backend).
 * - `DOC_SHOTS_OUT` (optional): output root, default the VERSIONED
 *   `screenshots/` directory at the monorepo root — captures are committed so
 *   CI can pick them up (Snap Store listing, website docs). Files land in
 *   `<out>/<locale-lowercase>/<slug>.png`; an unchanged screenshot produces
 *   no git diff.
 * - `DOC_SHOTS_LOCALES` (optional): comma-separated subset (e.g. `fr,en`) for
 *   fast iterations; every shipped locale when unset.
 * - `DOC_SHOTS_USERDATA` (optional): path to a SEED userData profile that
 *   already holds a signed-in session. It is COPIED into the run's temp dir
 *   (the app mutates its profile — recents, window state — and the seed must
 *   stay pristine so the welcome capture keeps its empty recents list), and
 *   the sign-in step skips the interactive login when the session is live.
 *   This is the workaround for WorkOS Radar challenging the headless login
 *   browser on production ("are you human") — seed once interactively, reuse.
 */
export interface DocShotsFixtures {
  restormRoot: string
  /** Output root for captured PNGs. */
  outRoot: string
  /** Locale subset parsed from `DOC_SHOTS_LOCALES`; empty = every locale. */
  localesFilter: string[]
  /** Path the app writes the WorkOS auth URL to (`RESTORM_E2E_AUTH_URL_FILE`). */
  authUrlFile: string
  launchApp: () => Promise<{ app: ElectronApplication; page: Page }>
}

export const test = base.extend<DocShotsFixtures>({
  restormRoot: [RESTORM_ROOT, { option: true }],

  outRoot: async ({}, use) => {
    await use(process.env.DOC_SHOTS_OUT ?? resolve(RESTORM_ROOT, '../screenshots'))
  },

  localesFilter: async ({}, use) => {
    const raw = process.env.DOC_SHOTS_LOCALES?.split(',').map((l) => l.trim()).filter((l) => l.length > 0)
    await use(raw ?? [])
  },

  authUrlFile: [join(DOC_SHOTS_TEMP_DIR, 'auth-url.txt'), { option: true }],

  launchApp: async ({ restormRoot, authUrlFile }, use, testInfo) => {
    const apps: ElectronApplication[] = []

    rmSync(DOC_SHOTS_TEMP_DIR, { recursive: true, force: true })
    mkdirSync(DOC_SHOTS_TEMP_DIR, { recursive: true })

    // A seed profile (already signed in) is copied per run: the app mutates
    // its profile as it drives, and the seed must stay pristine.
    const seedProfile = process.env.DOC_SHOTS_USERDATA
    let userDataOverride: string | undefined
    if (seedProfile !== undefined && seedProfile.length > 0) {
      userDataOverride = join(DOC_SHOTS_TEMP_DIR, 'userdata')
      cpSync(seedProfile, userDataOverride, { recursive: true })
    }

    const launcher = async (): Promise<{ app: ElectronApplication; page: Page }> => {
      const app = await launchRestormElectronApp({
        restormRoot,
        extraEnv: {
          ECUI_DISABLE_GPU: '1',
          RESTORM_DOC_CAPTURE: '1',
          RESTORM_E2E_AUTH_URL_FILE: authUrlFile,
          // Channel pin: the unpackaged run can't read the package version, so
          // this selects both the backend the login talks to AND the version
          // the statusbar displays. Default: the production channel.
          RESTORM_E2E_BACKEND_VERSION: process.env.DOC_SHOTS_VERSION ?? '1.0.0',
          // Pin the MCP instance name: the statusbar shows it in every capture,
          // and the default draws a random adjective-animal per boot.
          RESTORM_MCP_SESSION_NAME: 'docs',
          ...(userDataOverride !== undefined ? { RESTORM_USER_DATA_OVERRIDE: userDataOverride } : {})
        }
      })
      apps.push(app)

      const page = await app.firstWindow()
      await page.waitForLoadState('load')

      // Fixed capture geometry — every window (the boot splash owns index 0
      // early), then again once the real window is revealed.
      const resize = async (): Promise<void> => {
        await app.evaluate(({ BrowserWindow }) => {
          for (const win of BrowserWindow.getAllWindows()) {
            win.setSize(1600, 1000)
            win.center()
          }
        })
      }
      await resize()
      await installSystemModalsMockingForE2E(app)
      await page.waitForTimeout(1500)
      await resize()

      // Drive in English so driving selectors stay stable; captures switch the
      // language themselves and restore `en` afterwards.
      await page.evaluate(async () => { await window.api.settings.set('appearance:language', 'en') })

      // The crash-report consent toast shows on first run — settle it (consent
      // stays ON: it only affects THIS throwaway profile) so no capture shows it.
      const consentSave = page.locator('[data-testid="crash-consent-toast-save"]')
      if (await consentSave.isVisible({ timeout: 3000 }).catch(() => false)) {
        await consentSave.click()
        await expect(page.locator('[data-testid="crash-consent-toast"]')).not.toBeVisible({ timeout: 5000 })
      }

      return { app, page }
    }

    await use(launcher)

    for (const app of apps) {
      writeAppLogs(app, testInfo.outputDir)
      try { app.process().kill('SIGKILL') } catch { /* already gone */ }
      await app.close().catch(() => undefined)
    }
  }
})

export { expect }
