import { createBdd } from 'playwright-bdd'
import { copyFileSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, FILE_FORMAT_GATE_TEMP_DIR } from '../../fixtures/file-format-gate.fixture'

const { Given, When, Then } = createBdd(test)

let page: Page | null = null
let projectPath = ''
/** Bytes of the project as they stood before the open attempt. */
let bytesBeforeOpen: Buffer | null = null

const MODAL = '[data-testid="incompatible-project-modal"]'

/**
 * A committed sample the app wrote itself — real content, a collection
 * root, and therefore a `fileFormatVersion` to raise.
 */
const SOURCE_SAMPLE = join(__dirname, '../../../samples/redis-sample.restorm')

function requirePage(): Page {
  if (!page) throw new Error('the app has not been launched')
  return page
}

/**
 * The fixture is a project this build itself produced: a committed
 * sample, written by the app's own save path, copied into a scratch dir
 * so the tracked file is never touched.
 *
 * `File -> New` is deliberately NOT used here. A brand-new project has no
 * collections, and `fileFormatVersion` lives on each collection root — so
 * a freshly created file carries no version at all and there is nothing
 * to raise.
 */
Given('a project written by this build', async ({ launchApp }) => {
  const launched = await launchApp()
  page = launched.page

  projectPath = join(FILE_FORMAT_GATE_TEMP_DIR, 'sample-project.restorm')
  copyFileSync(SOURCE_SAMPLE, projectPath)

  const raw = readFileSync(projectPath, 'utf-8')
  expect(raw, 'the fixture must carry a version for these scenarios to mean anything').toMatch(
    /fileFormatVersion:\s*\d+/
  )
})

/**
 * Raise ONLY the version field. A project from a future format is the one
 * state the app genuinely cannot produce, so this single edit is the
 * legitimate exception to building fixtures by driving the app —
 * everything else in the file is the app's own output.
 *
 * Nothing has opened the file yet at this point, so there is no in-memory
 * copy to overwrite the edit.
 */
Given('its file format version is raised beyond what this build supports', () => {
  const before = readFileSync(projectPath, 'utf-8')
  const after = before.replace(/fileFormatVersion:\s*\d+/g, 'fileFormatVersion: 9999')
  expect(after, 'the version bump must actually change the file').not.toBe(before)
  writeFileSync(projectPath, after, 'utf-8')
})

When('I open that project', async () => {
  const p = requirePage()
  bytesBeforeOpen = readFileSync(projectPath)

  await p.evaluate(async (path: string) => {
    const w = window as unknown as { restorm?: { file?: { openPath?: (p: string) => Promise<unknown> } } }
    const fn = w.restorm?.file?.openPath
    if (typeof fn !== 'function') throw new Error('window.restorm.file.openPath is not available')
    await fn(path)
  }, projectPath)
})

Then('the incompatible-project message is shown', async ({ $testInfo }) => {
  const p = requirePage()
  const modal = p.locator(MODAL)
  await expect(modal).toBeVisible({ timeout: 10000 })
  // Attach the dialog itself: "a message is shown" is a claim about what
  // the user sees, and a testid being present does not prove the wording
  // rendered or that the layout holds.
  const shot = join($testInfo.outputDir, 'incompatible-project-modal.png')
  await modal.screenshot({ path: shot })
  await $testInfo.attach('incompatible-project-modal', { path: shot, contentType: 'image/png' })
})

Then('the incompatible-project message is not shown', async () => {
  const p = requirePage()
  // Give the refusal path the same grace the success path gets, so this
  // cannot pass merely by asserting before anything could have appeared.
  await p.waitForTimeout(2000)
  await expect(p.locator(MODAL)).toHaveCount(0)
})

Then('no project is open', async () => {
  const p = requirePage()
  const openPath = await p.evaluate(async () => {
    const w = window as unknown as { api?: { file?: { getState?: () => Promise<{ currentFile?: { path?: string | null } } | null> } } }
    const state = await w.api?.file?.getState?.()
    return state?.currentFile?.path ?? null
  })
  expect(openPath).toBeNull()
})

Then('that project is open', async () => {
  const p = requirePage()
  await expect(async () => {
    const openPath = await p.evaluate(async () => {
      const w = window as unknown as { api?: { file?: { getState?: () => Promise<{ currentFile?: { path?: string | null } } | null> } } }
      const state = await w.api?.file?.getState?.()
      return state?.currentFile?.path ?? null
    })
    expect(openPath).toBe(projectPath)
  }).toPass({ timeout: 10000 })
})

Then('the project file on disk is unchanged', () => {
  if (!bytesBeforeOpen) throw new Error('no pre-open snapshot was taken')
  const now = readFileSync(projectPath)
  // Byte equality, not mtime: the failure being guarded against is a
  // rewrite whose content differs, and a same-size rewrite would slip
  // past anything weaker.
  expect(now.equals(bytesBeforeOpen), 'the refused project must not be rewritten').toBe(true)
})

When('I dismiss the incompatible-project message', async () => {
  await requirePage().locator('[data-testid="incompatible-project-dismiss"]').click()
})

Then('the incompatible-project message is gone', async () => {
  await expect(requirePage().locator(MODAL)).toHaveCount(0, { timeout: 10000 })
})

Then('the app is still usable', async () => {
  // A refusal must leave a working app, not a wedged one: the menu bar
  // still opens, which it would not if the modal had left an overlay or
  // the renderer had thrown.
  const p = requirePage()
  await p.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(p.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 5000 })
  await p.keyboard.press('Escape')
})
