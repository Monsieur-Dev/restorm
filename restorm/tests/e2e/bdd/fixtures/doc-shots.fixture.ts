import { test as base } from 'playwright-bdd'
import { type ElectronApplication, type Page, expect } from '@playwright/test'
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
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
  /** Output root for the captures that illustrate the website documentation. */
  websiteOut: string
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

  /**
   * Where the WEBSITE's documentation images live. The account card and the
   * tokens modal illustrate documentation pages, so they land straight in the
   * site's assets — the site stays self-contained (its build needs no
   * credentials and clones nothing else), and an unchanged capture produces no
   * git diff because these shots are byte-identical run over run.
   *
   * The other captures keep going to `screenshots/` in this repo: they feed the
   * store listings, not the docs.
   */
  websiteOut: async ({}, use) => {
    await use(
      process.env.DOC_SHOTS_WEBSITE_OUT ??
        resolve(RESTORM_ROOT, '../../website/src/assets/docs')
    )
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
      // Normalise the copied profile so captures are reproducible regardless of
      // the seed's accumulated state: an empty recent-files list (the welcome
      // vignette must be empty, per the harness contract) and a fixed window
      // size. We edit the persisted config rather than teaching the library any
      // doc-capture behaviour.
      const cfgPath = join(userDataOverride, 'config.json')
      try {
        const cfg = existsSync(cfgPath)
          ? (JSON.parse(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>)
          : {}
        cfg.restorm_recent = []
        const windows = (cfg.windows ?? {}) as Record<string, unknown>
        windows.main = { width: 1280, height: 1000, x: 0, y: 0, fullscreen: false }
        cfg.windows = windows
        writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
      } catch {
        // A malformed/missing config just means the app falls back to defaults;
        // the capture still succeeds, only its determinism may suffer.
      }
    }

    const launcher = async (): Promise<{ app: ElectronApplication; page: Page }> => {
      const app = await launchRestormElectronApp({
        restormRoot,
        extraEnv: {
          ECUI_DISABLE_GPU: '1',
          RESTORM_DOC_CAPTURE: '1',
          // Turns on the documentation-capture seam (feature `docs.captureSeam`,
          // `Environment: dev`, so it cannot exist in a packaged build) AND the
          // dev-only entitlement seed. Together they make the account-gated
          // surfaces render with fixed sample data and no cloud round trip:
          // the run needs no login, and two runs produce identical pixels.
          RESTORM_DOC_SHOTS: '1',
          RESTORM_E2E_ENTITLEMENT_PLAN: 'pro',
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

      // Reduced motion, for a concrete reason rather than tidiness: this window
      // is offscreen under xvfb and produces no compositor frames, so a CSS
      // transition never advances. A popover that fades in stays at opacity 0
      // for ever — its screenshot is a picture of the screen behind it, and
      // every visibility assertion still passes.
      await page.emulateMedia({ reducedMotion: 'reduce' })
      // …and disable transitions outright, because the media emulation alone
      // did NOT take effect here: the tooltip host was still measured with
      // `opacity: 1` inline, `data-is-positioned="true"`, and a COMPUTED
      // opacity of 0 — a transition that had started and could never advance,
      // since an offscreen window composites no frames. Belt and braces, with
      // the belt stated: without this, popovers photograph as empty screens
      // and every assertion still passes.
      await page.addStyleTag({
        content: '*, *::before, *::after { transition: none !important; animation: none !important; }'
      })

      // Fixed capture geometry — every window (the boot splash owns index 0
      // early), then again once the real window is revealed.
      const resize = async (): Promise<void> => {
        await app.evaluate(({ BrowserWindow }) => {
          for (const win of BrowserWindow.getAllWindows()) {
            win.setSize(1280, 1000)
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
