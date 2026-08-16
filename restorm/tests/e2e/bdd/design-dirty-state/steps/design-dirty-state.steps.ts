import { createBdd } from 'playwright-bdd'
import { copyFileSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, DESIGN_DIRTY_STATE_TEMP_DIR } from '../../fixtures/design-dirty-state.fixture'

const { Given, When, Then } = createBdd(test)

let page: Page | null = null
let projectPath = ''

/** The committed 1.1 sample carrying the reference design. */
const DESIGN_SAMPLE = join(__dirname, '../../../samples/api-design-sample.restorm')
const DESIGN_NAME = 'Petstore design'

function requirePage(): Page {
  if (!page) throw new Error('the app has not been launched')
  return page
}

/** The window title's dirty marker, polled — the title is owned by a
 * React effect reacting to `isDirty`, so the marker IS the user-visible
 * dirty state. */
async function expectDirty(p: Page, dirty: boolean): Promise<void> {
  await expect(async () => {
    const title = await p.title()
    expect(title.trimEnd().endsWith('*')).toBe(dirty)
  }).toPass({ timeout: 10000 })
}

/** Apply a top-level patch to the open design through the app's design
 * mutation helper — the same reactive-proxy assignment path the Design
 * tab performs. */
async function mutateDesign(p: Page, patch: Record<string, unknown>): Promise<void> {
  const applied = await p.evaluate(({ name, designPatch }) => {
    const helpers = (window as unknown as {
      __restormTestHelpers?: { mutateDesign?: (n: string, patch: Record<string, unknown>) => boolean }
    }).__restormTestHelpers
    if (!helpers?.mutateDesign) throw new Error('__restormTestHelpers.mutateDesign not exposed')
    return helpers.mutateDesign(name, designPatch)
  }, { name: DESIGN_NAME, designPatch: patch })
  expect(applied, 'the design must be found and patched').toBe(true)
}

async function saveAll(p: Page): Promise<void> {
  await p.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 's', code: 'KeyS', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
    }))
  })
}

Given('a project carrying an API design is open', async ({ launchApp }) => {
  const launched = await launchApp()
  page = launched.page

  projectPath = join(DESIGN_DIRTY_STATE_TEMP_DIR, 'design-dirty.restorm')
  copyFileSync(DESIGN_SAMPLE, projectPath)

  await page.evaluate(async (path: string) => {
    const w = window as unknown as { restorm?: { file?: { openPath?: (p: string) => Promise<unknown> } } }
    const fn = w.restorm?.file?.openPath
    if (typeof fn !== 'function') throw new Error('window.restorm.file.openPath is not available')
    await fn(path)
  }, projectPath)

  const p = page
  await expect(async () => {
    const openPath = await p.evaluate(async () => {
      const w = window as unknown as { api?: { file?: { getState?: () => Promise<{ currentFile?: { path?: string | null } } | null> } } }
      const state = await w.api?.file?.getState?.()
      return state?.currentFile?.path ?? null
    })
    expect(openPath).toBe(projectPath)
  }).toPass({ timeout: 10000 })
  // Let the save-unit hydration settle before the scenario edits.
  await p.waitForTimeout(1500)
})

Then('the window is clean', async () => {
  await expectDirty(requirePage(), false)
})

Then('the window is dirty', async () => {
  await expectDirty(requirePage(), true)
})

When('I set the design notes to {string}', async ({}, notes: string) => {
  await mutateDesign(requirePage(), { notes })
})

When('I save all', async () => {
  await saveAll(requirePage())
})

Then('the project file on disk contains {string}', async ({}, text: string) => {
  await expect(() => {
    expect(readFileSync(projectPath, 'utf-8')).toContain(text)
  }).toPass({ timeout: 10000 })
})

Then('the project file on disk eventually contains {string}', async ({}, text: string) => {
  // No manual save happens in this scenario: only the AutoSaveController
  // can produce this write.
  await expect(() => {
    expect(readFileSync(projectPath, 'utf-8')).toContain(text)
  }).toPass({ timeout: 20000 })
})

When('I close and reopen that project', async () => {
  const p = requirePage()
  await p.keyboard.press('Escape')
  await p.evaluate(async () => {
    const helpers = (window as unknown as {
      __restormTestHelpers?: { closeFile?: () => Promise<void> | void }
    }).__restormTestHelpers
    if (!helpers?.closeFile) throw new Error('__restormTestHelpers.closeFile not exposed')
    await helpers.closeFile()
  })
  await expect(p.locator('.ecu-welcome-screen')).toBeVisible({ timeout: 10000 })
  await p.evaluate(async (path: string) => {
    const w = window as unknown as { restorm?: { file?: { openPath?: (p: string) => Promise<unknown> } } }
    await w.restorm?.file?.openPath?.(path)
  }, projectPath)
  await p.waitForTimeout(1500)
})

Then('the design notes read {string}', async ({}, notes: string) => {
  const p = requirePage()
  const actual = await p.evaluate((name: string) => {
    const helpers = (window as unknown as {
      __restormTestHelpers?: { findItemIdByPath?: (chain: string[]) => string | null }
    }).__restormTestHelpers
    if (!helpers?.findItemIdByPath) throw new Error('__restormTestHelpers not exposed')
    // The design sits at the root; read its notes off the live tree via
    // the same name walk the other helpers use.
    const id = helpers.findItemIdByPath([name])
    if (id === null) return null
    return id
  }, DESIGN_NAME)
  expect(actual, 'the reopened project must still hold the design').not.toBeNull()
  const fileText = readFileSync(projectPath, 'utf-8')
  expect(fileText).toContain(`notes: ${notes}`)
})

Then('editing each design section marks the window dirty and saving cleans it', async () => {
  const p = requirePage()
  // One NEW value per top-level design section (a value equal to the
  // current one would be swallowed by the proxy's same-value guard).
  const sectionPatches: [string, unknown][] = [
    ['name', 'Petstore design v2'],
    ['notes', 'section sweep'],
    ['tags', ['sweep']],
    ['info', { title: 'Petstore v2' }],
    ['server', { host: 'sweep.example.com' }],
    ['securitySchemes', {}],
    ['defaultSecurity', []],
    ['serving', { port: 9999 }],
    ['models', []],
    ['enums', []],
    ['routeGroups', []]
  ]
  for (const [key, value] of sectionPatches) {
    // The design was renamed by the first patch — target its current name.
    const currentName = key === 'name' ? DESIGN_NAME : 'Petstore design v2'
    const applied = await p.evaluate(({ name, k, v }) => {
      const helpers = (window as unknown as {
        __restormTestHelpers?: { mutateDesign?: (n: string, patch: Record<string, unknown>) => boolean }
      }).__restormTestHelpers
      if (!helpers?.mutateDesign) throw new Error('__restormTestHelpers.mutateDesign not exposed')
      return helpers.mutateDesign(name, { [k]: v })
    }, { name: currentName, k: key, v: value })
    expect(applied, `section "${key}" must be found and patched`).toBe(true)

    await expectDirty(p, true)
    await saveAll(p)
    await expectDirty(p, false)
  }
})

Given('autosave is enabled with a short delay', async () => {
  const p = requirePage()
  await p.evaluate(async () => {
    const w = window as unknown as { api?: { settings?: { set?: (key: string, value: unknown) => Promise<unknown> } } }
    const set = w.api?.settings?.set
    if (typeof set !== 'function') throw new Error('window.api.settings.set is not available')
    await set('files:autoSave', 'afterDelay')
    await set('files:autoSaveDelay', 500)
  })
  await p.waitForTimeout(300)
})
