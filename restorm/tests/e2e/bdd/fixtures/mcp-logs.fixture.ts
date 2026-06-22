import { restormBaseTest, expect, writeAppLogs } from '../../helpers/base-fixture'
import { launchRestormElectronApp } from '../../helpers/launch-restorm'
import { closeElectronAppForE2E, writeRendererIstanbulCoverage } from '../../helpers/coverage'
import type { ElectronApplication, Page, TestInfo } from '@playwright/test'

interface McpLogsFixtures {
  petstoreFolderPath: string
}

/**
 * Fixture for the MCP-logs-viewer E2E. MCP is on by default, so a normal launch
 * keeps the embedded server running and the `View → MCP logs` entry enabled —
 * the viewer can then be opened as a modal (welcome screen) or a tab (file
 * open). The disabled-menu case uses its own fixture that pre-seeds the
 * `mcp:enabled` setting to false.
 */
export const test = restormBaseTest.extend<McpLogsFixtures>({
  petstoreFolderPath: async ({ restormRoot }, use) => {
    const { join } = await import('path')
    await use(join(restormRoot, 'tests/e2e/samples/Petstore'))
  },

  electronApp: async ({ restormRoot }, use, testInfo: TestInfo) => {
    const app: ElectronApplication = await launchRestormElectronApp({
      restormRoot,
      args: ['--mcp-session-name=e2e-mcp-logs']
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
