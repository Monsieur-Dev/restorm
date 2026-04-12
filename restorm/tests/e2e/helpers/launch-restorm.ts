import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import electronPath from 'electron'
import { withE2ECoverageEnv } from './coverage'

export interface LaunchRestormOptions {
  restormRoot: string
  /** Extra CLI args passed to the Electron main script. */
  args?: string[]
  /** Extra environment variables merged into the launch env. */
  extraEnv?: Record<string, string>
}

/** Captured log lines (main + renderer) per app instance */
const appLogs = new WeakMap<ElectronApplication, string[]>()

/**
 * Get all captured logs (main process + renderer console) for an app instance.
 */
export function getAppLogs(app: ElectronApplication): string[] {
  return appLogs.get(app) ?? []
}

/**
 * Write captured logs to a file. Call from any teardown that has a testInfo.
 */
export function writeAppLogs(app: ElectronApplication, outputDir: string): string | null {
  const logs = getAppLogs(app)
  if (logs.length === 0) return null
  mkdirSync(outputDir, { recursive: true })
  const logFile = join(outputDir, 'electron-logs.txt')
  writeFileSync(logFile, logs.join('\n'), 'utf-8')
  return logFile
}

/**
 * Launch Restorm Electron app for E2E tests, with optional CLI args and env vars.
 *
 * Automatically captures:
 * - Main process stdout/stderr (Winston logs)
 * - Renderer console output (all windows, auto-attached)
 *
 * Access logs via `getAppLogs(app)` or save via `writeAppLogs(app, dir)`.
 */
export async function launchRestormElectronApp({
  restormRoot,
  args = [],
  extraEnv = {}
}: LaunchRestormOptions): Promise<ElectronApplication> {
  const electronExePath = electronPath as unknown as string
  const mainJsPath = join(restormRoot, 'dist/main/index.js')

  const extraArgs = args.filter((a): a is string => typeof a === 'string' && a.length > 0)

  const app = await electron.launch({
    executablePath: electronExePath,
    args: ['--no-sandbox', '--ozone-platform=x11', mainJsPath, ...extraArgs],
    env: {
      ...withE2ECoverageEnv(restormRoot, process.env),
      NODE_ENV: 'development',
      ...extraEnv
    }
  })

  // Capture logs
  const logs: string[] = []
  appLogs.set(app, logs)

  // Main process stdout/stderr
  app.process().stdout?.on('data', (data: Buffer) => {
    for (const line of data.toString().split('\n')) {
      const trimmed = line.trim()
      if (trimmed) logs.push(`[main:out] ${trimmed}`)
    }
  })
  app.process().stderr?.on('data', (data: Buffer) => {
    for (const line of data.toString().split('\n')) {
      const trimmed = line.trim()
      if (trimmed) logs.push(`[main:err] ${trimmed}`)
    }
  })

  // Renderer console — auto-attach to every window
  app.on('window', (page) => {
    page.on('console', (msg) => {
      logs.push(`[renderer:${msg.type()}] ${msg.text()}`)
    })
  })

  return app
}
