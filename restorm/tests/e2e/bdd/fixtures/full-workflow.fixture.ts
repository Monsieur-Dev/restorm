import { test as base } from 'playwright-bdd'
import { _electron as electron, type ElectronApplication, type Page, expect } from '@playwright/test'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import electronPath from 'electron'
import { installSystemModalsMockingForE2E } from 'electron-core-ui/testing'
import { withE2ECoverageEnv } from '../../helpers/coverage'
import { createIsolatedUserDataDir } from '../../helpers/userdata-isolation'
import { collectBlockingRendererMessages, summariseBlockingMessages } from '../../helpers/renderer-log-guard'

/**
 * Project-local scratch directory for files the scenario creates
 * (collections saved via File → New, mocked save-dialog targets, …).
 * Lives under `restorm/tests/e2e/.tmp/` and is wiped at the start of
 * each scenario. Gitignored.
 */
export const FULL_WORKFLOW_TEMP_DIR = resolve(__dirname, '../../.tmp/full-workflow')

function resetTempDir(): void {
  rmSync(FULL_WORKFLOW_TEMP_DIR, { recursive: true, force: true })
  mkdirSync(FULL_WORKFLOW_TEMP_DIR, { recursive: true })
}

export interface SavedWindowBounds {
  x: number
  y: number
  width: number
  height: number
  fullscreen?: boolean
}

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  configPath: string
}

export interface LaunchOptions {
  /** Pre-seed config.json with this data. Ignored when `relaunch: true`. */
  seed?: { windows?: Record<string, SavedWindowBounds> }
  /**
   * Skip the bootstrap / clear-settings / seed step and launch directly
   * against the userData that a previous `launchApp` call discovered.
   * Use this to verify state that should have survived a restart.
   */
  relaunch?: boolean
}

export interface FullWorkflowFixtures {
  restormRoot: string
  /**
   * Launch an Electron app. On the first call (or when `relaunch` is
   * false) runs a bootstrap launch with `--clear-settings` to discover
   * the userData path, writes `seed` to `config.json`, then starts the
   * real app. On a relaunch call, re-uses the previously-discovered
   * userData without touching it.
   */
  launchApp: (options?: LaunchOptions) => Promise<LaunchedApp>
  /** Returns the concatenated log buffer for every app launched so far. */
  getLogs: () => string[]
}

export const test = base.extend<FullWorkflowFixtures>({
  restormRoot: [resolve(__dirname, '../../../..'), { option: true }],

  launchApp: async ({ restormRoot }, use, testInfo) => {
    const launched: { app: ElectronApplication; logs: string[] }[] = []
    const state: { configPath: string | null } = { configPath: null }

    // Each scenario starts with a clean scratch dir.
    resetTempDir()

    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')

    // Per-scenario userData isolation. The same dir is
    // shared by the bootstrap launch, the real launch, and any
    // `relaunch: true` follow-ups — that's exactly what we want for
    // close-then-reopen flows. Different scenarios get different dirs
    // (and parallel agents get different dirs too) so nothing leaks
    // across runs and the developer's real userData is never touched.
    const isolatedUserDataDir = createIsolatedUserDataDir(restormRoot)
    const baseEnv = {
      ...withE2ECoverageEnv(restormRoot, process.env),
      NODE_ENV: 'development',
      RESTORM_USER_DATA_OVERRIDE: isolatedUserDataDir
    }

    const startApp = async (): Promise<LaunchedApp> => {
      if (!state.configPath) {
        throw new Error('startApp requires the userData path to have been discovered first')
      }
      const app = await electron.launch({
        executablePath: electronExePath,
        args: ['--no-sandbox', '--ozone-platform=x11', mainJsPath],
        env: baseEnv
      })

      // Capture everything visible in DevTools: main process stdout/stderr,
      // renderer console messages, and uncaught page errors.
      const logs: string[] = []
      app.process().stdout?.on('data', (data: Buffer) => {
        for (const line of data.toString().split('\n')) {
          const trimmed = line.trim()
          if (trimmed) logs.push(`[main:out] ${trimmed}`)
        }
      })
      app.process().stderr?.on('data', (data: Buffer) => {
        for (const line of data.toString().split('\n')) {
          const trimmed = line.trim()
          if (trimmed) logs.push(`[main:err] ${trimmed}`)
        }
      })
      app.on('window', (p) => {
        p.on('console', (msg) => {
          logs.push(`[renderer:${msg.type()}] ${msg.text()}`)
        })
        p.on('pageerror', (err) => {
          logs.push(`[renderer:pageerror] ${err.message}\n${err.stack ?? ''}`)
        })
        // Auto-accept native `window.confirm` / `alert` dialogs so the
        // workflow doesn't stall.
        p.on('dialog', (dialog) => { void dialog.accept() })
      })

      const page = await app.firstWindow()
      await page.waitForLoadState('load')
      // Install the electron-core-ui system modals mock in strict mode —
      // any unconfigured native dialog (showOpenDialog / showSaveDialog /
      // showMessageBox) now throws loudly so the test author can't miss
      // an unexpected confirmation / file picker.
      await installSystemModalsMockingForE2E(app)
      // Stub native confirm/alert: Electron renderer doesn't always route
      // them through Playwright's `dialog` event, so overriding the
      // window methods is the reliable path for favourite confirmation
      // flows and similar.
      await page.evaluate(() => {
        window.confirm = () => true
        window.alert = () => undefined
      })
      // Wait for the deferred setBounds (ready-to-show + setBounds timing).
      await page.waitForTimeout(1500)

      launched.push({ app, logs })
      return { app, page, configPath: state.configPath }
    }

    const launcher = async (options?: LaunchOptions): Promise<LaunchedApp> => {
      if (options?.relaunch) {
        if (!state.configPath) {
          throw new Error('launchApp called with relaunch:true before first launch — no known userData path')
        }
        return startApp()
      }

      // Bootstrap launch with --clear-settings to discover the userData path
      // and start from a known-clean state, then write the seed and launch
      // the app for real.
      const bootstrap = await electron.launch({
        executablePath: electronExePath,
        args: ['--no-sandbox', '--ozone-platform=x11', mainJsPath, '--clear-settings'],
        env: baseEnv
      })
      const userDataPath = await bootstrap.evaluate(({ app }) => app.getPath('userData'))
      state.configPath = join(userDataPath, 'config.json')
      bootstrap.process().kill('SIGKILL')
      // Give the OS a beat to release locks before we overwrite the config.
      await new Promise((r) => setTimeout(r, 300))

      // `--clear-settings` only resets `config.json`; the drafts
      // directory accumulates orphans across runs. Wipe it here so
      // the "drafts directory should be empty" assertion can
      // compare against an empty baseline — otherwise stragglers
      // from previous sessions look like legitimate orphans even
      // after the fix lands.
      const draftsRoot = join(userDataPath, 'drafts')
      rmSync(draftsRoot, { recursive: true, force: true })

      if (options?.seed) {
        mkdirSync(userDataPath, { recursive: true })
        writeFileSync(state.configPath, JSON.stringify(options.seed, null, 2), 'utf-8')
      }

      return startApp()
    }

    ;(globalThis as unknown as { __fullWorkflowLaunched?: typeof launched }).__fullWorkflowLaunched = launched

    await use(launcher)

    // Teardown: attach logs for each launched app and kill the process.
    mkdirSync(testInfo.outputDir, { recursive: true })

    // Collect blocking renderer errors across every app instance so a
    // scenario that secretly emits `Maximum update depth exceeded` /
    // `getSnapshot should be cached` no longer slips past green. See
    // `helpers/renderer-log-guard.ts` for allow-list rationale.
    const blockingErrors: string[] = []
    for (const { app, logs } of launched) {
      blockingErrors.push(...collectBlockingRendererMessages(logs))
      try {
        if (logs.length > 0) {
          const logFile = join(testInfo.outputDir, 'electron-logs.txt')
          writeFileSync(logFile, logs.join('\n'), 'utf-8')
          await testInfo.attach('electron-logs', { path: logFile, contentType: 'text/plain' })
        }
      } catch {
        // ignore
      }
      try {
        app.process().kill('SIGKILL')
      } catch {
        // ignore
      }
    }

    // Only fail for renderer errors if the test would otherwise have
    // passed — a test that already failed surfaces its own error, and
    // re-raising here would just bury the real cause in noise.
    if (blockingErrors.length > 0 && testInfo.status === 'passed') {
      const logFile = join(testInfo.outputDir, 'renderer-errors.txt')
      writeFileSync(logFile, blockingErrors.join('\n\n'), 'utf-8')
      await testInfo.attach('renderer-errors', { path: logFile, contentType: 'text/plain' })
      throw new Error(summariseBlockingMessages(blockingErrors))
    }
  },

  getLogs: async ({ launchApp }, use) => {
    // Force launchApp to initialise — its fixture publishes the shared
    // `__fullWorkflowLaunched` registry we read here.
    void launchApp
    await use(() => {
      const launched = (globalThis as unknown as { __fullWorkflowLaunched?: { logs: string[] }[] }).__fullWorkflowLaunched ?? []
      return launched.flatMap((entry) => entry.logs)
    })
  }
})

/**
 * Helper that hands the currently-running ElectronApplication to callers
 * that want to invoke the `configureNext*DialogForE2E` helpers from
 * `electron-core-ui/testing`. Returns null if no app has been launched.
 */
export function currentElectronApp(): ElectronApplication | null {
  const launched = (globalThis as unknown as { __fullWorkflowLaunched?: { app: ElectronApplication }[] }).__fullWorkflowLaunched ?? []
  const current = launched[launched.length - 1]
  return current?.app ?? null
}

/**
 * Read `windows.main` from the seeded config.json. Returns null if the
 * file or key is missing. Safe to call after the app has been closed.
 */
export function readSavedMainBounds(configPath: string): SavedWindowBounds | null {
  if (!existsSync(configPath)) return null
  const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as { windows?: Record<string, SavedWindowBounds> }
  return raw.windows?.main ?? null
}

export { expect }
