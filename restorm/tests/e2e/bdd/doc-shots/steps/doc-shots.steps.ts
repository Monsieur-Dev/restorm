import { createBdd } from 'playwright-bdd'
import { isAbsolute, join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { configureNextSaveFileDialogForE2E } from 'electron-core-ui/testing'
import { test, expect } from '../../fixtures/doc-shots.fixture'
import { loginViaLoopback } from '../../../helpers/workos-login'
import { captureForAllLocales, localeDirName } from '../../../helpers/capture-locales'
import { callEmbeddedMcpTool, readEmbeddedMcpLock } from '../../../helpers/embedded-mcp'

const OPENAPI_URL = 'https://api.artifactsmmo.com/openapi.json'

const { Given, When } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null

function requirePage(): Page {
  if (!page) throw new Error('app must be launched before driving UI steps')
  return page
}
function requireApp(): ElectronApplication {
  if (!electronApp) throw new Error('app must be launched before configuring dialogs')
  return electronApp
}
function sidebarRowByName(p: Page, name: string): Locator {
  return p
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText(name, { exact: true }) })
    .first()
}

Given('the app is running in documentation-capture mode', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page
})

Given('I am signed in with the demo account', async ({ authUrlFile }) => {
  const p = requirePage()
  // A seeded profile (DOC_SHOTS_USERDATA) restores its session at launch —
  // only fall back to the interactive loopback login when signed out. The
  // interactive path needs the demo credentials AND a backend whose WorkOS
  // Radar accepts an automated browser (production challenges headless
  // browsers with a human check — use the seed profile there).
  const state = await p.evaluate(async () => await window.api.account.getState())
  if (!state.signedIn) {
    const email = process.env.DOC_SHOTS_EMAIL
    const password = process.env.DOC_SHOTS_PASSWORD
    if (email === undefined || email.length === 0 || password === undefined || password.length === 0) {
      throw new Error(
        'signed out and DOC_SHOTS_EMAIL / DOC_SHOTS_PASSWORD are unset — provide the demo credentials or a signed-in DOC_SHOTS_USERDATA seed profile'
      )
    }
    await loginViaLoopback(p, { authUrlFile, email, password })
  }
  // The plan badge doubles as the "entitlement landed" gate: every capture
  // shows it, so nothing may be captured before it reads a paid plan.
  await expect(p.locator('[data-testid="app-statusbar-version-plan-label"]')).toHaveText(/ - (Pro|Enterprise)$/, {
    timeout: 60000
  })
  // The account card popover may still be up after the sign-in click.
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
})

// The target is a path template naming the destination file explicitly, with
// a mandatory `{locale}` placeholder replaced per language (lowercase form,
// e.g. `zh-cn`). Relative templates resolve against the `DOC_SHOTS_OUT` root,
// so the same feature drives scratch runs and real website-docs captures.
// Matches both `When` and `Then` usages — cucumber matching ignores keywords.
When(
  'I capture a screenshot for every locale to {string}',
  async ({ restormRoot, outRoot, localesFilter }, template: string) => {
    if (!template.includes('{locale}')) {
      throw new Error(`capture target must contain a {locale} placeholder, got: ${template}`)
    }
    const p = requirePage()
    await captureForAllLocales(
      p,
      restormRoot,
      (locale) => {
        const target = template.replace(/\{locale\}/g, localeDirName(locale))
        return isAbsolute(target) ? target : join(outRoot, target)
      },
      localesFilter.length > 0 ? { locales: localesFilter } : {}
    )
  }
)

When('I create a new project and import the ArtifactsMMO OpenAPI spec from its URL', async () => {
  const p = requirePage()
  // The project's absolute path shows in the status bar of every subsequent
  // capture — use a neutral, machine-independent location, not a path inside
  // this checkout.
  const projectDir = '/tmp/restorm-demo'
  rmSync(projectDir, { recursive: true, force: true })
  mkdirSync(projectDir, { recursive: true })
  await configureNextSaveFileDialogForE2E(requireApp(), { kind: 'saveFile', path: join(projectDir, 'artifactsmmo.restorm') })
  await p.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await p.locator('[data-testid="titlebar-menu-item-new"]').first().click()
  await p.waitForTimeout(800)

  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 5000 })
  await p.locator('[data-testid="source-input-input"]').fill(OPENAPI_URL)
  // The selection tree appears once the spec has been fetched + parsed (live fetch).
  await expect(p.locator('[data-testid="import-selection-tree"]')).toBeVisible({ timeout: 30000 })
  await p.locator('[data-testid="import-button"]').click()
  await expect(importModal).not.toBeVisible({ timeout: 30000 })
  await p.waitForTimeout(1000)
})

/** Expand a folder row via its chevron toggle — clicking the row itself
 * selects it and opens its view in a tab, which steals the active editor. */
async function expandRowViaToggle(p: Page, row: Locator): Promise<void> {
  await expect(row).toBeVisible({ timeout: 10000 })
  if ((await row.getAttribute('aria-expanded')) === 'false') {
    await row.locator('.list-view-expander').first().click()
    await p.waitForTimeout(400)
  }
}

/** Expand the imported environment folder (the tree's single root) plus one
 * named sub-folder, so the requests inside are reachable. */
async function expandImportedFolder(p: Page, folderName: string): Promise<void> {
  const sidebar = p.locator('[data-testid="sidebar-listview"]')
  await expect(sidebar).toBeVisible({ timeout: 10000 })
  await expandRowViaToggle(p, sidebar.locator('[role="treeitem"]').first())
  await expandRowViaToggle(p, sidebar.locator('[role="treeitem"]').filter({ has: p.getByText(folderName, { exact: true }) }).first())
}

When('I open the imported request {string} from folder {string}', async ({}, requestName: string, folderName: string) => {
  const p = requirePage()
  await expandImportedFolder(p, folderName)
  await sidebarRowByName(p, requestName).click()
  await p.waitForTimeout(1500)
})

/** The custom value list created for the input param, kept for the build step. */
let characterListId: string | null = null
/** The built scenario's id, kept for the favorite step. */
let fightScenarioId: string | null = null

function requireMcp(): ReturnType<typeof readEmbeddedMcpLock> {
  const pid = requireApp().process().pid
  if (pid === undefined) throw new Error('electron main process has no pid')
  return readEmbeddedMcpLock(pid)
}

When('I create a custom enumeration {string} with the value {string}', async ({}, listName: string, value: string) => {
  const p = requirePage()
  // Flush any renderer-local state to the main process before authoring
  // through the embedded MCP surface (its writes autosave from main).
  await p.keyboard.press('Control+S')
  await p.waitForTimeout(800)

  const mcp = requireMcp()
  const folders = await callEmbeddedMcpTool<{ id: string; kind: string }[]>(mcp, 'list_folders', {})
  const envFolder = folders.find((f) => f.kind === 'env-folder')
  if (!envFolder) throw new Error('no environment folder found — did the import land?')
  const created = await callEmbeddedMcpTool<{ list: { id: string } }>(mcp, 'create_custom_value_list', {
    folderId: envFolder.id,
    name: listName,
    entries: [{ label: value, value }]
  })
  characterListId = created.list.id
})

When(
  'I build the scenario {string} chaining an input using {string}, {string}, a log {string}, a {int} ms wait and {string}',
  async ({}, scenarioName: string, _listName: string, moveRequest: string, logMessage: string, waitMs: number, fightRequest: string) => {
    const p = requirePage()
    const mcp = requireMcp()
    if (characterListId === null) throw new Error('create the custom enumeration first')

    // The graph is authored through the embedded MCP tools — the app's
    // supported programmatic surface (writes go through the main-process
    // store, repaint the open editor, and autosave). Building the same graph
    // by scripting the node type-picker UI would be hopelessly brittle.
    const requests = await callEmbeddedMcpTool<{ id: string; name: string }[]>(mcp, 'list_requests', {})
    const requestId = (name: string): string => {
      const req = requests.find((r) => r.name === name)
      if (!req) throw new Error(`request "${name}" not found among ${String(requests.length)} imported requests`)
      return req.id
    }

    const scenario = await callEmbeddedMcpTool<{ id: string }>(mcp, 'create_scenario', { name: scenarioName })
    fightScenarioId = scenario.id
    const node = async (kind: string, config: Record<string, unknown>): Promise<string> => {
      const created = await callEmbeddedMcpTool<{ nodeId: string }>(mcp, 'create_scenario_node', {
        scenarioId: scenario.id, kind, config
      })
      return created.nodeId
    }

    const inputNode = await node('input', {
      params: [
        { id: 'p-character', name: 'Character', valueType: { type: 'customList', listId: characterListId, label: 'Buffy' } },
        { id: 'p-monster', name: 'monsterType', valueType: { type: 'string', value: 'elite' } }
      ]
    })
    const moveNode = await node('httpRequest', { requestId: requestId(moveRequest), label: moveRequest })
    const logNode = await node('log', { level: 'info', message: { type: 'string', value: logMessage } })
    const waitNode = await node('wait', { durationMs: waitMs })
    const fightNode = await node('httpRequest', { requestId: requestId(fightRequest), label: fightRequest })

    const connect = async (fromNodeId: string, fromPortId: string, toNodeId: string, toPortId: string): Promise<void> => {
      await callEmbeddedMcpTool(mcp, 'connect_scenario_nodes', {
        scenarioId: scenario.id, fromNodeId, fromPortId, toNodeId, toPortId
      })
    }
    // The wiring: the input's value triggers Move (data-trigger `in` port —
    // the imported request's {name} path param ships disabled, so it exposes
    // no dedicated port). Move then FANS OUT: its response feeds the log
    // (side branch) while its done signal starts the wait → fight sequence —
    // flatter to read than chaining the log inline.
    await connect(inputNode, 'value', moveNode, 'in')
    await connect(moveNode, 'response', logNode, 'in')
    await connect(moveNode, 'done', waitNode, 'in')
    await connect(waitNode, 'done', fightNode, 'in')

    // Arrange BEFORE opening the editor: with the editor closed the ELK pass
    // sizes every box from its port count — DETERMINISTIC estimates, where the
    // open editor's live-measured sizes wobble by a pixel between runs and
    // drag the fit-view zoom (and thus every rasterized pixel) along.
    await callEmbeddedMcpTool(mcp, 'arrange_scenario', { scenarioId: scenario.id })
    await sidebarRowByName(p, scenarioName).click()
    await expect(p.locator('[data-testid="scenario-editor"]')).toBeVisible({ timeout: 15000 })
    await expect(p.locator('.react-flow__node')).toHaveCount(5, { timeout: 10000 })
    await p.waitForTimeout(800)
    // Fold the legend/inspector away FIRST (it changes the visible canvas
    // area), then fit the arranged graph to the final viewport.
    await p.locator('[data-testid="scenario-inspector-collapse"]').click()
    await p.waitForTimeout(400)
    await p.locator('.react-flow__controls-fitview').click()
    await p.waitForTimeout(800)
  }
)

When('I mark the scenario {string} as favorite', async ({}, _scenarioName: string) => {
  if (fightScenarioId === null) throw new Error('build the scenario first')
  await callEmbeddedMcpTool(requireMcp(), 'set_favorite', { itemId: fightScenarioId, favorite: true })
  await requirePage().waitForTimeout(500)
})
