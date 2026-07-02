import { test as base } from 'playwright-bdd'
import { _electron as electron, type ElectronApplication, type Page, expect } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import electronPath from 'electron'
import { installSystemModalsMockingForE2E } from 'electron-core-ui/testing'
import { withE2ECoverageEnv } from '../../helpers/coverage'
import { createIsolatedUserDataDir } from '../../helpers/userdata-isolation'
import { collectBlockingRendererMessages, summariseBlockingMessages } from '../../helpers/renderer-log-guard'
import { GIT_SERVER_URL, seedFreshRepo, gitServerUrlFor, gitEnv } from '../../../integration/gitServerSeed'

/**
 * Scratch root for this suite's per-scenario git working copies. Wiped on
 * every scenario start (mirrors `DIRTY_STATE_TEMP_DIR`'s wipe-on-launch
 * lifecycle) — lives in the OS temp dir, NOT under this repo, as secondary
 * hygiene (unlike `DIRTY_STATE_TEMP_DIR`, which never runs git commands
 * against its contents). This is NOT the real defense, though: the actual
 * incident (see `gitServerSeed.ts`'s doc comment) was a git HOOK
 * (pre-commit/pre-push) leaking `GIT_DIR`/`GIT_INDEX_FILE` into this
 * process's env, which redirects EVERY `git` subprocess here regardless of
 * cwd/`-C`/workdir location — `run()` below scrubs that env via `gitEnv()`
 * on every invocation, which is what actually makes the collaborator
 * `git add`/`commit`/`push` (git-push-pull.steps.ts) and the clones below
 * safe under a hook.
 */
export const GIT_INTEGRATION_TEMP_DIR = join(tmpdir(), 'restorm-git-integration')
const RESTORM_ROOT = resolve(__dirname, '../../../..')

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  configPath: string
}

export interface GitIntegrationFixtures {
  restormRoot: string
  launchApp: () => Promise<LaunchedApp>
  /** Clone the SHARED, read-only `seed-project.git` remote into a fresh
   * directory under `GIT_INTEGRATION_TEMP_DIR` (one clone per call, named
   * `dirName`) and return the absolute path to its `.restorm` file —
   * restorm's git surfaces track "the folder containing the open file",
   * so this is the one path every scenario needs to open. ONLY safe for
   * scenarios that never push/mutate the remote (e.g. "detect repo" status
   * checks) — see `seedFreshRepo` for anything that writes. */
  cloneSeedRepo: (dirName: string) => Promise<string>
  /** Seed a FRESH, scenario-scoped remote (named `repoName`) and clone it
   * into `GIT_INTEGRATION_TEMP_DIR/<repoName>`, returning the `.restorm`
   * path to open. Every scenario that pushes, or that has a collaborator
   * push a conflicting change, MUST use its own fresh repo via this rather
   * than the shared `cloneSeedRepo` — two mutating scenarios racing on the
   * SAME remote is real cross-test contamination, not hypothetical (it's
   * what broke the first live run of this suite: a collaborator-renamed
   * request from one scenario leaked into another's "open the seed
   * project" assertion). */
  seedFreshRepo: (repoName: string) => Promise<string>
  /** Clone an EXISTING repo (already seeded via `seedFreshRepo` earlier in
   * the SAME scenario) into a new directory, returning the clone dir (not
   * the `.restorm` path — callers that mutate raw files, e.g. a
   * collaborator step, want the dir). Used both for "a second, independent
   * clone standing in for another collaborator" AND for "restorm's own
   * clone of a repo a prior step already seeded" (the pull scenario's
   * ordering: collaborator seeds + mutates FIRST, restorm opens the SAME
   * repo second). */
  cloneNamedRepo: (repoName: string, dirName: string) => Promise<string>
}

function run(command: string, cwd?: string): void {
  execSync(command, { cwd, stdio: 'ignore', env: gitEnv() })
}

/**
 * Shared launcher — identical bootstrap→kill→relaunch recipe as
 * `dirty-state.fixture.ts` (see that file for the full rationale). Kept as
 * its own copy rather than importing dirty-state's: the two suites'
 * temp-dir wiping must stay independent so a parallel run of both doesn't
 * race-delete each other's workspace.
 */
export const test = base.extend<GitIntegrationFixtures>({
  restormRoot: [RESTORM_ROOT, { option: true }],

  cloneSeedRepo: async ({}, use) => {
    await use((dirName: string) => {
      const workingCopy = join(GIT_INTEGRATION_TEMP_DIR, dirName)
      rmSync(workingCopy, { recursive: true, force: true })
      run(`git clone "${GIT_SERVER_URL}" "${workingCopy}"`)
      return Promise.resolve(join(workingCopy, 'api.restorm'))
    })
  },

  seedFreshRepo: async ({}, use) => {
    await use((repoName: string) => {
      const url = seedFreshRepo(repoName)
      const workingCopy = join(GIT_INTEGRATION_TEMP_DIR, repoName)
      rmSync(workingCopy, { recursive: true, force: true })
      run(`git clone "${url}" "${workingCopy}"`)
      return Promise.resolve(join(workingCopy, 'api.restorm'))
    })
  },

  cloneNamedRepo: async ({}, use) => {
    await use((repoName: string, dirName: string) => {
      const workingCopy = join(GIT_INTEGRATION_TEMP_DIR, dirName)
      rmSync(workingCopy, { recursive: true, force: true })
      run(`git clone "${gitServerUrlFor(repoName)}" "${workingCopy}"`)
      return Promise.resolve(workingCopy)
    })
  },

  launchApp: async ({ restormRoot }, use, testInfo) => {
    const launched: { app: ElectronApplication; logs: string[] }[] = []
    let configPath: string | null = null

    rmSync(GIT_INTEGRATION_TEMP_DIR, { recursive: true, force: true })
    mkdirSync(GIT_INTEGRATION_TEMP_DIR, { recursive: true })

    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')

    const isolatedUserDataDir = createIsolatedUserDataDir(restormRoot)
    const baseEnv = {
      ...withE2ECoverageEnv(restormRoot, process.env),
      NODE_ENV: 'development',
      RESTORM_USER_DATA_OVERRIDE: isolatedUserDataDir,
      ECUI_DISABLE_GPU: '1',
      // The entire git surface is Pro-gated (`git.client`) — seed the
      // dev-only Pro entitlement so the gate passes in this harness (dead
      // code in packaged builds; mirrors mcp-server.fixture.ts's identical
      // need for `mcp.pro`).
      RESTORM_E2E_ENTITLEMENT_PLAN: 'pro'
    }

    const launcher = async (): Promise<LaunchedApp> => {
      const bootstrap = await electron.launch({
        executablePath: electronExePath,
        args: ['--no-sandbox', '--ozone-platform=x11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', mainJsPath, '--clear-settings'],
        env: baseEnv
      })
      const userDataPath = await bootstrap.evaluate(({ app }) => app.getPath('userData'))
      configPath = join(userDataPath, 'config.json')
      bootstrap.process().kill('SIGKILL')
      await new Promise((r) => setTimeout(r, 300))

      const app = await electron.launch({
        executablePath: electronExePath,
        args: ['--no-sandbox', '--ozone-platform=x11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', mainJsPath],
        env: baseEnv
      })

      const logs: string[] = []
      app.process().stdout?.on('data', (d: Buffer) => {
        for (const line of d.toString().split('\n')) {
          const trimmed = line.trim()
          if (trimmed) logs.push(`[main:out] ${trimmed}`)
        }
      })
      app.process().stderr?.on('data', (d: Buffer) => {
        for (const line of d.toString().split('\n')) {
          const trimmed = line.trim()
          if (trimmed) logs.push(`[main:err] ${trimmed}`)
        }
      })
      app.on('window', (p) => {
        p.on('console', (msg) => { logs.push(`[renderer:${msg.type()}] ${msg.text()}`) })
        p.on('pageerror', (err) => {
          logs.push(`[renderer:pageerror] ${err.message}\n${err.stack ?? ''}`)
        })
        p.on('dialog', (dialog) => { void dialog.accept() })
      })

      const page = await app.firstWindow()
      await page.waitForLoadState('load')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await installSystemModalsMockingForE2E(app)
      await page.evaluate(() => {
        window.confirm = () => true
        window.alert = () => undefined
      })
      await page.waitForTimeout(1500)

      launched.push({ app, logs })
      if (!configPath) throw new Error('userData path discovery failed')
      return { app, page, configPath }
    }

    ;(globalThis as unknown as { __gitIntegrationLaunched?: typeof launched }).__gitIntegrationLaunched = launched

    await use(launcher)

    mkdirSync(testInfo.outputDir, { recursive: true })

    const blockingErrors: string[] = []
    for (const { app, logs } of launched) {
      blockingErrors.push(...collectBlockingRendererMessages(logs))
      try {
        if (logs.length > 0) {
          const logFile = join(testInfo.outputDir, 'electron-logs.txt')
          writeFileSync(logFile, logs.join('\n'), 'utf-8')
          await testInfo.attach('electron-logs', { path: logFile, contentType: 'text/plain' })
        }
      } catch { /* ignore */ }
      try { app.process().kill('SIGKILL') } catch { /* ignore */ }
    }

    if (blockingErrors.length > 0 && testInfo.status === 'passed') {
      const logFile = join(testInfo.outputDir, 'renderer-errors.txt')
      writeFileSync(logFile, blockingErrors.join('\n\n'), 'utf-8')
      await testInfo.attach('renderer-errors', { path: logFile, contentType: 'text/plain' })
      throw new Error(summariseBlockingMessages(blockingErrors))
    }
  }
})

export function currentElectronApp(): ElectronApplication | null {
  const launched = (globalThis as unknown as { __gitIntegrationLaunched?: { app: ElectronApplication }[] }).__gitIntegrationLaunched ?? []
  const current = launched[launched.length - 1]
  return current?.app ?? null
}

export { expect }
