import { test as base } from 'playwright-bdd'
import { _electron as electron, type ElectronApplication, expect } from '@playwright/test'
import { join, resolve } from 'path'
import electronPath from 'electron'
import { withE2ECoverageEnv } from '../../helpers/coverage'

interface WindowStateFixtures {
  restormRoot: string
  electronApp: ElectronApplication
  /** Launch a fresh app (with --clear-settings on first call, without on subsequent calls) */
  launchApp: (clearSettings: boolean) => Promise<ElectronApplication>
}

export const test = base.extend<WindowStateFixtures>({
  restormRoot: [resolve(__dirname, '../../../..'), { option: true }],

  launchApp: async ({ restormRoot }, use) => {
    const apps: ElectronApplication[] = []

    const launcher = async (clearSettings: boolean): Promise<ElectronApplication> => {
      const electronExePath = electronPath as unknown as string
      const mainJsPath = join(restormRoot, 'dist/main/index.js')
      const args = ['--no-sandbox', '--ozone-platform=x11', mainJsPath]
      if (clearSettings) {
        args.push('--clear-settings')
      }
      const app = await electron.launch({
        executablePath: electronExePath,
        args,
        env: {
          ...withE2ECoverageEnv(restormRoot, process.env),
          NODE_ENV: 'development'
        }
      })
      apps.push(app)
      return app
    }

    await use(launcher)

    // Cleanup all apps
    for (const app of apps) {
      try {
        app.process().kill('SIGKILL')
      } catch {
        // ignore
      }
    }
  },

  // electronApp is not used directly — tests use launchApp instead
  electronApp: async ({}, use) => {
    await use(undefined as unknown as ElectronApplication)
  }
})

export { expect }
