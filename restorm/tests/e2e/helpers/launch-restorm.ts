import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { randomUUID } from 'crypto'
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

  // Test-isolation hook. Each app launch gets its own
  // `userData` dir under the repo-local, gitignored
  // `tests/e2e/.tmp/userdata/<uuid>/`. Restorm's main entrypoint
  // reads `RESTORM_USER_DATA_OVERRIDE` and redirects via
  // `app.setPath('userData', …)` before any storage consumer runs.
  // Caller-supplied `extraEnv` wins, so a test that needs to share a
  // userData dir across launches (e.g. close-and-relaunch flows) can
  // pass its own value.
  const defaultUserDataDir = join(restormRoot, 'tests/e2e/.tmp/userdata', randomUUID())
  mkdirSync(defaultUserDataDir, { recursive: true })

  const app = await electron.launch({
    executablePath: electronExePath,
    args: ['--no-sandbox', '--ozone-platform=x11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', mainJsPath, ...extraArgs],
    env: {
      ...withE2ECoverageEnv(restormRoot, process.env),
      NODE_ENV: 'development',
      RESTORM_USER_DATA_OVERRIDE: defaultUserDataDir,
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

  // Renderer console + uncaught page errors — auto-attach to every window.
  // Uncaught errors go through `pageerror`, not `console`, so capturing both
  // gives us the same visibility as DevTools open.
  app.on('window', (page) => {
    page.on('console', (msg) => {
      logs.push(`[renderer:${msg.type()}] ${msg.text()}`)
    })
    page.on('pageerror', (err) => {
      logs.push(`[renderer:pageerror] ${err.message}\n${err.stack ?? ''}`)
    })
  })

  return app
}
