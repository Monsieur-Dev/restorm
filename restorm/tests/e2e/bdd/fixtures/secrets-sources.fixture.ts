import { servicesWorkerFixture, type StartedServices } from '../../helpers/testcontainers/services'
import { test as base } from 'playwright-bdd'
import { _electron as electron, type ElectronApplication, type Page, expect } from '@playwright/test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import electronPath from 'electron'
import { installSystemModalsMockingForE2E } from 'electron-core-ui/testing'
import { withE2ECoverageEnv } from '../../helpers/coverage'
import { createIsolatedUserDataDir } from '../../helpers/userdata-isolation'
import { collectBlockingRendererMessages, summariseBlockingMessages } from '../../helpers/renderer-log-guard'

export const SECRETS_SOURCES_TEMP_DIR = resolve(__dirname, '../../.tmp/secrets-sources')
const RESTORM_ROOT = resolve(__dirname, '../../../..')

/**
 * The plaintext the `envVar` source resolves to. The fixture exposes the
 * NAME `RESTORM_E2E_SECRET` in the persisted file; this VALUE is injected
 * into the spawned main process's `process.env` (never persisted, never
 * rendered) so a test can assert it reached the echo endpoint AND never
 * leaked into the variables-table / request DOM.
 */
export const SECRET_ENV_VAR_NAME = 'RESTORM_E2E_SECRET'
export const SECRET_PLAINTEXT = 's3cr3t-RESOLVED-value-7Qm'

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
}

export interface SecretsSourcesFixtures {
  restormRoot: string
  launchApp: () => Promise<LaunchedApp>
}

export const test = base.extend<SecretsSourcesFixtures, { services: StartedServices }>({
  // The suite runs its OWN auth-service container (worker-scoped, ephemeral port).
  services: servicesWorkerFixture(['auth-service']),
  restormRoot: [RESTORM_ROOT, { option: true }],

  launchApp: async ({ restormRoot }, use, testInfo) => {
    const launched: { app: ElectronApplication; logs: string[] }[] = []

    rmSync(SECRETS_SOURCES_TEMP_DIR, { recursive: true, force: true })
    mkdirSync(SECRETS_SOURCES_TEMP_DIR, { recursive: true })

    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')

    const isolatedUserDataDir = createIsolatedUserDataDir(restormRoot)
    // Inject the secret value into the spawned main process. The `envVar`
    // resolver reads `process.env[RESTORM_E2E_SECRET]` at hydration time.
    const baseEnv = {
      ...withE2ECoverageEnv(restormRoot, process.env),
      NODE_ENV: 'development',
      RESTORM_USER_DATA_OVERRIDE: isolatedUserDataDir,
      ECUI_DISABLE_GPU: '1',
      [SECRET_ENV_VAR_NAME]: SECRET_PLAINTEXT
    }

    const launcher = async (): Promise<LaunchedApp> => {
      const bootstrap = await electron.launch({
        executablePath: electronExePath,
        args: ['--no-sandbox', '--ozone-platform=x11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', mainJsPath, '--clear-settings'],
        env: baseEnv
      })
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
      await installSystemModalsMockingForE2E(app)
      await page.evaluate(() => {
        window.confirm = () => true
        window.alert = () => undefined
      })
      await page.waitForTimeout(1500)

      launched.push({ app, logs })
      return { app, page }
    }

    ;(globalThis as unknown as { __secretsSourcesLaunched?: typeof launched }).__secretsSourcesLaunched = launched

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
  const launched = (globalThis as unknown as { __secretsSourcesLaunched?: { app: ElectronApplication }[] }).__secretsSourcesLaunched ?? []
  const current = launched[launched.length - 1]
  return current?.app ?? null
}

export { expect }
