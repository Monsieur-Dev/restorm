import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/window-state.fixture'
import type { ElectronApplication } from '@playwright/test'
import { readFileSync } from 'fs'
import { join } from 'path'

const { Given, When, Then } = createBdd(test)

let app: ElectronApplication
let userDataPath: string
let lastSavedBounds: { x: number; y: number; width: number; height: number } | null = null

function getBounds(electronApp: ElectronApplication): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return win ? win.getBounds() : null
  })
}

Given('a fresh app with cleared settings', async ({ launchApp }) => {
  app = await launchApp(true)
  userDataPath = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  const page = await app.firstWindow()
  await page.waitForLoadState('load')
  await page.waitForTimeout(1000)
})

When(
  'I move and resize the window to x={int} y={int} width={int} height={int}',
  async ({}, x: number, y: number, width: number, height: number) => {
    await app.evaluate(
      ({ BrowserWindow }, bounds) => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win) {
          win.setBounds(bounds)
        }
      },
      { x, y, width, height }
    )
    await new Promise((r) => setTimeout(r, 500))

    const actualBounds = await getBounds(app)
    expect(actualBounds).toEqual({ x, y, width, height })
  }
)

When('I close the app', async () => {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.close()
    }
  })
  await new Promise((r) => setTimeout(r, 1000))
})

When('I relaunch the app without clearing settings', async ({ launchApp }) => {
  app = await launchApp(false)
  const page = await app.firstWindow()
  await page.waitForLoadState('load')
  // Wait for the deferred setBounds to apply (ready-to-show + setBounds timing)
  await page.waitForTimeout(3000)
})

Then(
  'the window bounds should be x={int} y={int} width={int} height={int}',
  async ({}, x: number, y: number, width: number, height: number) => {
    const bounds = await getBounds(app)
    expect(bounds).toEqual({ x, y, width, height })
  }
)

When('I close the app and read saved bounds', async () => {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.close()
  })
  await new Promise((r) => setTimeout(r, 1000))

  // Read the persisted config to verify what was saved
  const configPath = join(userDataPath, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { windows?: Record<string, { x: number; y: number; width: number; height: number }> }
  lastSavedBounds = config.windows?.['main'] ?? null
})

Then(
  'the saved bounds should be x={int} y={int} width={int} height={int}',
  async ({}, x: number, y: number, width: number, height: number) => {
    expect(lastSavedBounds).not.toBeNull()
    expect(lastSavedBounds).toEqual(expect.objectContaining({ x, y, width, height }))
  }
)
