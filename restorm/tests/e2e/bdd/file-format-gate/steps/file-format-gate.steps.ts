import { createBdd } from 'playwright-bdd'
import { copyFileSync, cpSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, FILE_FORMAT_GATE_TEMP_DIR } from '../../fixtures/file-format-gate.fixture'

const { Given, When, Then } = createBdd(test)

let page: Page | null = null
let projectPath = ''
/**
 * The single file whose bytes stand for "the project on disk". In file
 * mode that is the project itself; in folder mode it is the root index,
 * which is the file both the format stamp and the identity stamp write
 * to, and therefore the one a refused open must leave alone.
 */
let bytesPath = ''
/** Bytes of that file as they stood before the open attempt. */
let bytesBeforeOpen: Buffer | null = null

/** A folder project the app wrote itself, with a root index. */
const SOURCE_FOLDER_SAMPLE = join(__dirname, '../../../samples/Petstore')

const MODAL = '[data-testid="incompatible-project-modal"]'

/**
 * A committed sample the app wrote itself — real content, a stored
 * identity, and a `fileFormatVersion` at its root to raise or move.
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
 * `File -> New` is deliberately NOT used here. It would produce a real
 * project, but an empty one — no collections, no content, and nothing
 * that could tell a partial load from a clean refusal. The scenarios are
 * about what happens to a project that HAS something to lose.
 *
 * The sample also already carries a stored identity, which is what lets
 * the byte-comparison assertions mean "nothing was written": on a project
 * without one, the identity stamp would legitimately rewrite the file and
 * mask anything else that did.
 */
Given('a project written by this build', async ({ launchApp }) => {
  const launched = await launchApp()
  page = launched.page

  projectPath = join(FILE_FORMAT_GATE_TEMP_DIR, 'sample-project.restorm')
  copyFileSync(SOURCE_SAMPLE, projectPath)
  bytesPath = projectPath

  const raw = readFileSync(projectPath, 'utf-8')
  expect(raw, 'the fixture must carry a version at its root for these scenarios to mean anything').toMatch(
    /^fileFormatVersion:\s*\d+$/m
  )
  expect(raw, 'the fixture must already have an identity, or the stamp would rewrite it').toContain(
    '_projectUuid:'
  )
})

/**
 * Rewrite the fixture into the shape a build older than the move
 * produced: the version on the first collection instead of at the
 * document root. This is the state of every project written before the
 * field moved — including the ones on developers' own machines — and
 * such a project must keep opening.
 *
 * Combined with the version bump below, it also pins the read contract:
 * the file then says 9999 in a place nothing reads, and still opens.
 *
 * Everything but the position of that one line is still the app's own
 * output; the line goes to the top of the collection rather than to
 * wherever the older build happened to emit it, which the reader treats
 * identically.
 */
Given('its file format version sits where an earlier build wrote it', () => {
  const before = readFileSync(projectPath, 'utf-8')
  const rootLine = /^fileFormatVersion: (\d+)\n/m.exec(before)
  if (rootLine === null) throw new Error('the fixture declares no version at its root')
  const version = rootLine[1]

  const withoutRoot = before.replace(rootLine[0], '')
  // The first collection: a sequence entry under `collections:`. Its
  // properties are indented two further than the dash.
  const firstEntry = /^(\s*)- (?=\S)/m.exec(withoutRoot)
  if (firstEntry === null) throw new Error('the fixture has no collection to carry the version')
  const propertyIndent = `${firstEntry[1] ?? ''}  `

  const insertAt = withoutRoot.indexOf('\n', firstEntry.index) + 1
  const after = `${withoutRoot.slice(0, insertAt)}${propertyIndent}fileFormatVersion: ${version}\n${withoutRoot.slice(insertAt)}`

  expect(after, 'the version must have left the root').not.toMatch(/^fileFormatVersion:/m)
  expect(after, 'the version must now sit on a collection').toMatch(/^\s+fileFormatVersion: \d+$/m)
  writeFileSync(projectPath, after, 'utf-8')
})

/**
 * Raise ONLY the version field, wherever the fixture declares it. A
 * project from a future format is the one state the app genuinely cannot
 * produce, so this single edit is the legitimate exception to building
 * fixtures by driving the app — everything else in the file is the app's
 * own output.
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

/**
 * Folder mode, which is the realistic way a user meets a future-format
 * project at all: a colleague on a newer build commits, and git brings the
 * directory in.
 *
 * It is also the mode with its own reading path — a folder project is
 * rebuilt from its directories, which drops every key the root index
 * carries, so the version has to be read from that index explicitly before
 * the gate can judge it. A file-mode scenario cannot exercise any of that.
 */
Given('a folder-mode project written by this build', async ({ launchApp }) => {
  const launched = await launchApp()
  page = launched.page

  projectPath = join(FILE_FORMAT_GATE_TEMP_DIR, 'folder-project')
  cpSync(SOURCE_FOLDER_SAMPLE, projectPath, { recursive: true })
  bytesPath = join(projectPath, 'index.yaml')

  expect(readFileSync(bytesPath, 'utf-8'), 'the fixture must already have an identity').toContain(
    '_projectUuid:'
  )
})

/**
 * Raise the version in the project's ROOT index — the document-level file,
 * not a collection's own index. Same legitimate exception as the file-mode
 * bump: a future-format project is the one state the app cannot produce,
 * so this single line is hand-written and everything else is the app's own
 * output.
 */
Given('its root index declares a format version beyond what this build supports', () => {
  const before = readFileSync(bytesPath, 'utf-8')
  // The fixture declares its version like every Restorm-written project;
  // raise THAT line rather than prepending a second one, so the file keeps
  // exactly one root declaration and the gate reads the value under test.
  const raised = /^fileFormatVersion: \d+$/m.test(before)
    ? before.replace(/^fileFormatVersion: \d+$/m, 'fileFormatVersion: 9999')
    : `fileFormatVersion: 9999\n${before}`
  writeFileSync(bytesPath, raised, 'utf-8')
  expect(readFileSync(bytesPath, 'utf-8'), 'exactly one root declaration').toMatch(
    /^fileFormatVersion: 9999$/m
  )
})

When('I open that project', async () => {
  const p = requirePage()
  bytesBeforeOpen = readFileSync(bytesPath)

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
  const now = readFileSync(bytesPath)
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
