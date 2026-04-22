import { test as base } from 'playwright-bdd'
import { _electron as electron, type ElectronApplication, type Page, expect } from '@playwright/test'
import { mkdirSync, readFileSync, existsSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import electronPath from 'electron'
import { installSystemModalsMockingForE2E, configureNextSaveFileDialogForE2E } from 'electron-core-ui/testing'
import { withE2ECoverageEnv } from '../../helpers/coverage'

// Credentials for this test live in a gitignored file so the secret
// never hits the repo. Test is skipped gracefully when the file is
// absent (e.g. on CI without the creds). Creds sit in
// `tests/e2e/fixtures/dynamics-creds.json` — two directories up
// from this file (`tests/e2e/bdd/fixtures/`).
export const DYNAMICS_CREDS_PATH = resolve(__dirname, '../../fixtures/dynamics-creds.json')

export interface DynamicsCreds {
  tenantId: string
  clientId: string
  clientSecret: string
  scope: string
  metadataUrl: string
  tokenUrl: string
}

export function loadDynamicsCredsOrSkip(): DynamicsCreds {
  if (!existsSync(DYNAMICS_CREDS_PATH)) {
    throw new Error(
      `[odata-dynamics-import] creds file missing: ${DYNAMICS_CREDS_PATH} — skip this test or drop a dynamics-creds.json with tenantId/clientId/clientSecret/scope/metadataUrl/tokenUrl.`
    )
  }
  return JSON.parse(readFileSync(DYNAMICS_CREDS_PATH, 'utf-8')) as DynamicsCreds
}

export const ODATA_DYNAMICS_TEMP_DIR = resolve(__dirname, '../../.tmp/odata-dynamics-import')
const RESTORM_ROOT = resolve(__dirname, '../../../..')

export interface OdataDynamicsFixtures {
  restormRoot: string
  launchApp: () => Promise<{ app: ElectronApplication; page: Page }>
}

export const test = base.extend<OdataDynamicsFixtures>({
  restormRoot: [RESTORM_ROOT, { option: true }],

  launchApp: async ({ restormRoot }, use, testInfo) => {
    const apps: { app: ElectronApplication; logs: string[] }[] = []

    rmSync(ODATA_DYNAMICS_TEMP_DIR, { recursive: true, force: true })
    mkdirSync(ODATA_DYNAMICS_TEMP_DIR, { recursive: true })

    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')

    const launcher = async (): Promise<{ app: ElectronApplication; page: Page }> => {
      const bootstrap = await electron.launch({
        executablePath: electronExePath,
        args: ['--no-sandbox', '--ozone-platform=x11', mainJsPath, '--clear-settings'],
        env: { ...withE2ECoverageEnv(restormRoot, process.env), NODE_ENV: 'development' }
      })
      bootstrap.process().kill('SIGKILL')
      await new Promise((r) => setTimeout(r, 300))

      const app = await electron.launch({
        executablePath: electronExePath,
        args: ['--no-sandbox', '--ozone-platform=x11', mainJsPath],
        env: { ...withE2ECoverageEnv(restormRoot, process.env), NODE_ENV: 'development' }
      })

      const logs: string[] = []
      app.process().stdout?.on('data', (d: Buffer) => { logs.push(d.toString().trim()) })
      app.process().stderr?.on('data', (d: Buffer) => { logs.push(d.toString().trim()) })

      const page = await app.firstWindow()
      await page.waitForLoadState('load')
      await installSystemModalsMockingForE2E(app)
      // Auto-accept any JS confirm/alert so an unsaved-changes dialog
      // or similar doesn't hang the run.
      await page.evaluate(() => { window.confirm = () => true; window.alert = () => undefined })
      await page.waitForTimeout(1500)

      apps.push({ app, logs })
      return { app, page }
    }

    await use(launcher)

    const { writeFileSync } = await import('fs')
    mkdirSync(testInfo.outputDir, { recursive: true })
    for (const { app, logs } of apps) {
      if (testInfo.status !== 'passed') {
        try {
          const p = await app.firstWindow().catch(() => null)
          if (p) {
            const shot = join(testInfo.outputDir, 'failure-state.png')
            await p.screenshot({ path: shot, fullPage: true })
            await testInfo.attach('failure-state-screenshot', { path: shot, contentType: 'image/png' })
          }
        } catch { /* ignore */ }
      }
      try {
        if (logs.length > 0) {
          const logFile = join(testInfo.outputDir, 'electron-logs.txt')
          writeFileSync(logFile, logs.join('\n'), 'utf-8')
          await testInfo.attach('electron-logs', { path: logFile, contentType: 'text/plain' })
        }
      } catch { /* ignore */ }
      try { app.process().kill('SIGKILL') } catch { /* ignore */ }
    }
  }
})

export { expect, configureNextSaveFileDialogForE2E }
