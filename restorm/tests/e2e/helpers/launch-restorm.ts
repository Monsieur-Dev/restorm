import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { join } from 'path'
import electronPath from 'electron'

export interface LaunchRestormOptions {
  restormRoot: string
  /**
   * Extra CLI args passed to the Electron main script.
   * Example: `['--clear-settings']`.
   */
  args?: string[]
  env?: NodeJS.ProcessEnv
}

/**
 * Launch Restorm Electron app for E2E tests, with optional CLI args.
 */
export async function launchRestormElectronApp({
  restormRoot,
  args = [],
  env = process.env
}: LaunchRestormOptions): Promise<ElectronApplication> {
  const electronExePath = electronPath as unknown as string
  const mainJsPath = join(restormRoot, 'dist/main/index.js')

  const extraArgs = args.filter((a): a is string => typeof a === 'string' && a.length > 0)

  return await electron.launch({
    executablePath: electronExePath,
    args: ['--no-sandbox', mainJsPath, ...extraArgs],
    env: {
      ...env,
      NODE_ENV: 'development'
    }
  })
}
