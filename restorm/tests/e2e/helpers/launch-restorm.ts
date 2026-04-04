import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { join } from 'path'
import electronPath from 'electron'
import { withE2ECoverageEnv } from './coverage'

export interface LaunchRestormOptions {
  restormRoot: string
  /** Extra CLI args passed to the Electron main script. */
  args?: string[]
  /** Extra environment variables merged into the launch env. */
  extraEnv?: Record<string, string>
}

/**
 * Launch Restorm Electron app for E2E tests, with optional CLI args and env vars.
 */
export async function launchRestormElectronApp({
  restormRoot,
  args = [],
  extraEnv = {}
}: LaunchRestormOptions): Promise<ElectronApplication> {
  const electronExePath = electronPath as unknown as string
  const mainJsPath = join(restormRoot, 'dist/main/index.js')

  const extraArgs = args.filter((a): a is string => typeof a === 'string' && a.length > 0)

  return await electron.launch({
    executablePath: electronExePath,
    args: ['--no-sandbox', mainJsPath, ...extraArgs],
    env: {
      ...withE2ECoverageEnv(restormRoot, process.env),
      NODE_ENV: 'development',
      ...extraEnv
    }
  })
}
