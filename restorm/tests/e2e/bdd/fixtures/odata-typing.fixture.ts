import { test as base } from 'playwright-bdd'
import { _electron as electron, type ElectronApplication, type Page, expect } from '@playwright/test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import electronPath from 'electron'
import { installSystemModalsMockingForE2E } from 'electron-core-ui/testing'
import { withE2ECoverageEnv } from '../../helpers/coverage'
import { collectBlockingRendererMessages, summariseBlockingMessages } from '../../helpers/renderer-log-guard'

export const ODATA_TYPING_TEMP_DIR = resolve(__dirname, '../../.tmp/odata-typing')
const RESTORM_ROOT = resolve(__dirname, '../../../..')

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
}

export interface OdataTypingFixtures {
  restormRoot: string
  launchApp: () => Promise<LaunchedApp>
}

export const test = base.extend<OdataTypingFixtures>({
  restormRoot: [RESTORM_ROOT, { option: true }],

  launchApp: async ({ restormRoot }, use, testInfo) => {
    const launched: { app: ElectronApplication; logs: string[] }[] = []

    rmSync(ODATA_TYPING_TEMP_DIR, { recursive: true, force: true })
    mkdirSync(ODATA_TYPING_TEMP_DIR, { recursive: true })

    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')

    const launcher = async (): Promise<LaunchedApp> => {
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

    ;(globalThis as unknown as { __odataTypingLaunched?: typeof launched }).__odataTypingLaunched = launched

    await use(launcher)

    mkdirSync(testInfo.outputDir, { recursive: true })
    if (testInfo.status !== 'passed') {
      const last = launched[launched.length - 1]
      if (last) {
        try {
          const p = await last.app.firstWindow().catch(() => null)
          if (p) {
            const shotPath = join(testInfo.outputDir, 'failure-state.png')
            await p.screenshot({ path: shotPath, fullPage: true })
            await testInfo.attach('failure-state-screenshot', { path: shotPath, contentType: 'image/png' })
          }
        } catch { /* ignore */ }
      }
    }

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
  const launched = (globalThis as unknown as { __odataTypingLaunched?: { app: ElectronApplication }[] }).__odataTypingLaunched ?? []
  const current = launched[launched.length - 1]
  return current?.app ?? null
}

export { expect }
