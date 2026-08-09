import { restormBaseTest, expect } from '../../helpers/base-fixture'
import type { ElectronApplication, TestInfo } from '@playwright/test'
import { launchRestormElectronApp, writeAppLogs } from '../../helpers/launch-restorm'
import { closeElectronAppForE2E } from '../../helpers/coverage'

interface AutoUpdateFixtures {
  petstoreProjectPath: string
}

/**
 * Fixture for the auto-update E2E: launches Restorm with the scripted update
 * mock (`RESTORM_UPDATE_MOCK`) so a check reports "no update available" without
 * a real release feed. Opening the Petstore workspace project activates a
 * workbench so the app toaster (where update notifications land) is mounted.
 * Overrides only `electronApp`; the base `page` fixture attaches to its first
 * window.
 */
export const test = restormBaseTest.extend<AutoUpdateFixtures>({
  petstoreProjectPath: async ({ restormRoot }, use) => {
    const { join } = await import('path')
    await use(join(restormRoot, 'tests/e2e/samples/petstore-workspace.restorm'))
  },

  electronApp: async ({ restormRoot }, use, testInfo: TestInfo) => {
    const app: ElectronApplication = await launchRestormElectronApp({
      restormRoot,
      extraEnv: { RESTORM_UPDATE_MOCK: 'uptodate' }
    })
    await use(app)
    const logFile = writeAppLogs(app, testInfo.outputDir)
    if (logFile) {
      await testInfo.attach('electron-logs', { path: logFile, contentType: 'text/plain' })
    }
    await closeElectronAppForE2E(app)
  }
})

export { expect }
