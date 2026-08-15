import { test as base } from 'playwright-bdd'
import { _electron as electron, type ElectronApplication, type Page, expect } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import electronPath from 'electron'
import { installSystemModalsMockingForE2E } from 'electron-core-ui/testing'
import { withE2ECoverageEnv } from '../../helpers/coverage'
import { createIsolatedUserDataDir } from '../../helpers/userdata-isolation'
import { collectBlockingRendererMessages, summariseBlockingMessages } from '../../helpers/renderer-log-guard'
import { gitServerUrl, seedFreshRepo, gitServerUrlFor, gitEnv } from '../../../integration/gitServerSeed'
import { gitServerWorkerFixture, type StartedGitServer } from '../../helpers/testcontainers/gitServer'

const RESTORM_ROOT = resolve(__dirname, '../../../..')

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  configPath: string
}

export interface GitIntegrationFixtures {
  restormRoot: string
  /** A fresh, uniquely-named scratch root for THIS scenario's git working
   * copies (`mkdtempSync`, torn down after the scenario). Was previously
   * ONE fixed path shared across the whole run, wiped-and-recreated at
   * every scenario's start — safe for a single scenario in isolation, but
   * a real cross-worker incident once ≥2 git-suite projects run together
   * (the default `pnpm test:e2e`/CI/pre-push shape): scenario B starting
   * wipes the shared root out from under scenario A, still mid-flight in
   * a different worker, deleting its already-built clones. Per-test
   * isolation (same pattern as `gitServerSeed.ts`'s workDir fix) removes
   * the shared mutable state entirely — no scenario can ever touch
   * another's root, regardless of scheduling. */
  gitIntegrationRoot: string
  launchApp: () => Promise<LaunchedApp>
  /** Clone the SHARED, read-only `seed-project.git` remote into a fresh
   * directory under `gitIntegrationRoot` (one clone per call, named
   * `dirName`) and return the absolute path to its `.restorm` file —
   * restorm's git surfaces track "the folder containing the open file",
   * so this is the one path every scenario needs to open. ONLY safe for
   * scenarios that never push/mutate the remote (e.g. "detect repo" status
   * checks) — see `seedFreshRepo` for anything that writes. */
  cloneSeedRepo: (dirName: string) => Promise<string>
  /** Seed a FRESH, scenario-scoped remote (named `repoName`) and clone it
   * into `gitIntegrationRoot/<repoName>`, returning the `.restorm`
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
export const test = base.extend<GitIntegrationFixtures, { gitServer: StartedGitServer }>({
  // This suite runs its OWN git daemon (worker-scoped, ephemeral port,
  // mkdtemp repos dir) — the seed-module helpers are routed at it.
  gitServer: gitServerWorkerFixture(),
  restormRoot: [RESTORM_ROOT, { option: true }],

  gitIntegrationRoot: async ({ gitServer: _gitServer }, use) => {
    const root = mkdtempSync(join(tmpdir(), 'restorm-git-integration-'))
    await use(root)
    rmSync(root, { recursive: true, force: true })
  },

  cloneSeedRepo: async ({ gitIntegrationRoot }, use) => {
    await use((dirName: string) => {
      const workingCopy = join(gitIntegrationRoot, dirName)
      rmSync(workingCopy, { recursive: true, force: true })
      run(`git clone "${gitServerUrl()}" "${workingCopy}"`)
      return Promise.resolve(join(workingCopy, 'api.restorm'))
    })
  },

  seedFreshRepo: async ({ gitIntegrationRoot }, use) => {
    await use((repoName: string) => {
      const url = seedFreshRepo(repoName)
      const workingCopy = join(gitIntegrationRoot, repoName)
      rmSync(workingCopy, { recursive: true, force: true })
      run(`git clone "${url}" "${workingCopy}"`)
      return Promise.resolve(join(workingCopy, 'api.restorm'))
    })
  },

  cloneNamedRepo: async ({ gitIntegrationRoot }, use) => {
    await use((repoName: string, dirName: string) => {
      const workingCopy = join(gitIntegrationRoot, dirName)
      rmSync(workingCopy, { recursive: true, force: true })
      run(`git clone "${gitServerUrlFor(repoName)}" "${workingCopy}"`)
      return Promise.resolve(workingCopy)
    })
  },

  launchApp: async ({ restormRoot, gitServer: _gitServer }, use, testInfo) => {
    const launched: { app: ElectronApplication; logs: string[] }[] = []
    let configPath: string | null = null

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
      RESTORM_E2E_ENTITLEMENT_PLAN: 'pro',
      // The runner turns the remote check off for every suite, because it
      // otherwise toasts over the app whenever this checkout differs from its
      // remote. THIS suite is the one that tests the check, so it opts back
      // in — against its own docker git-server, not the developer's repo.
      ECUI_DISABLE_GIT_REMOTE_CHECK: '0'
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
