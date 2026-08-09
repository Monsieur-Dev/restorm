import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { restormBaseTest, expect, writeAppLogs } from '../../helpers/base-fixture'
import { launchRestormElectronApp } from '../../helpers/launch-restorm'
import { closeElectronAppForE2E, writeRendererIstanbulCoverage } from '../../helpers/coverage'
import type { ElectronApplication, Page, TestInfo } from '@playwright/test'

interface McpLogsDisabledFixtures {
  petstoreProjectPath: string
}

/**
 * Pre-seed an isolated userData dir whose config.json turns the `mcp:enabled`
 * setting OFF, and return the dir. The `--mcp` / `--no-mcp` CLI flags no longer
 * exist — MCP is governed entirely by this setting (default ON) + the headless
 * rule — so the only way to launch with MCP off is to seed the setting before
 * boot. We must NOT pass `--clear-settings` (it would wipe the seed). The key
 * shape mirrors SettingsService persistence: `settings:<groupId>:<settingId>`.
 */
function seedMcpDisabledUserData(restormRoot: string): string {
  const dir = join(restormRoot, 'tests/e2e/.tmp/userdata', randomUUID())
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ 'settings:mcp:enabled': false }, null, 2), 'utf-8')
  return dir
}

/**
 * Fixture for the "MCP logs menu entry is disabled" E2E. MCP is now ON by
 * default and there is no `--no-mcp` flag, so this pre-seeds the `mcp:enabled`
 * setting to false in an isolated userData dir — then the `View → MCP logs`
 * entry must be disabled.
 */
export const test = restormBaseTest.extend<McpLogsDisabledFixtures>({
  petstoreProjectPath: async ({ restormRoot }, use) => {
    await use(join(restormRoot, 'tests/e2e/samples/petstore-workspace.restorm'))
  },

  electronApp: async ({ restormRoot }, use, testInfo: TestInfo) => {
    const app: ElectronApplication = await launchRestormElectronApp({
      restormRoot,
      extraEnv: { RESTORM_USER_DATA_OVERRIDE: seedMcpDisabledUserData(restormRoot) }
    })
    await use(app)
    const logFile = writeAppLogs(app, testInfo.outputDir)
    if (logFile) {
      await testInfo.attach('electron-logs', { path: logFile, contentType: 'text/plain' })
    }
    await closeElectronAppForE2E(app)
  },

  page: async ({ electronApp, restormRoot }, use, testInfo: TestInfo) => {
    const page: Page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForLoadState('load')
    await page.waitForSelector('[data-testid="titlebar-menubar"]', { timeout: 15000 })
    await use(page)
    await writeRendererIstanbulCoverage(page, testInfo, restormRoot)
  }
})

export { expect }
