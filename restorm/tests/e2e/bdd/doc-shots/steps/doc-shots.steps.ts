import { createBdd } from 'playwright-bdd'
import { isAbsolute, join, dirname, relative } from 'path'
import { mkdirSync, rmSync, readFileSync, copyFileSync } from 'fs'
import { createServer } from 'http'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { configureNextSaveFileDialogForE2E } from 'electron-core-ui/testing'
import { test, expect } from '../../fixtures/doc-shots.fixture'
import { loginViaLoopback } from '../../../helpers/workos-login'
import { captureForAllLocales, localeDirName } from '../../../helpers/capture-locales'
import { callEmbeddedMcpTool, readEmbeddedMcpLock } from '../../../helpers/embedded-mcp'

const OPENAPI_URL = 'https://api.artifactsmmo.com/openapi.json'
/** Loopback port for serving the deliberately-flawed API spec that illustrates
 * the imported-API problem detection. Distinct from the petstore mock port. */
const API_ISSUES_MOCK_PORT = 4601

const { Given, When, Then } = createBdd(test)

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
/** Resolve a `{locale}` template against the output root. */
function targetResolver(outRoot: string, template: string): (locale: string) => string {
  if (!template.includes('{locale}')) {
    throw new Error(`capture target must contain a {locale} placeholder, got: ${template}`)
  }
  return (locale) => {
    const target = template.replace(/\{locale\}/g, localeDirName(locale))
    return isAbsolute(target) ? target : join(outRoot, target)
  }
}

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

/**
 * Open the account card. Reopened for EVERY locale by the capture step below,
 * not once before the loop: a language switch closes the popover, so opening
 * it up front yields one good screenshot and 26 pictures of the screen behind
 * it — silently, because the file is still written and the run still passes.
 */
async function openAccountCard(p: Page): Promise<void> {
  const card = p.getByTestId('account-card')
  if (await card.isVisible()) return
  await p.getByTestId('titlebar-account-button').click()
  await card.waitFor({ state: 'visible' })
  // Settle, then RE-assert. The card passed a visibility check once and was
  // absent from the resulting screenshot, so a check that only fires at open
  // time proves nothing about the instant the shot is taken.
  // Guard, not a wait: the popover must be OPAQUE when the shot is taken.
  // Playwright's visibility check looks at the element's own box and style, not
  // at an ancestor's animated opacity — so a popover mid-fade passes every
  // assertion while photographing as an empty screen.
  await card.evaluate(
    (el) =>
      new Promise<void>((resolve, reject) => {
        const host = el.closest('.tooltip')
        if (!host) {
          reject(new Error('tooltip host not found'))
          return
        }
        const deadline = Date.now() + 5000
        const check = (): void => {
          if (getComputedStyle(host).opacity === '1') {
            resolve()
            return
          }
          if (Date.now() > deadline) {
            reject(new Error('tooltip never became opaque — the capture would show no popover'))
            return
          }
          setTimeout(check, 50)
        }
        check()
      })
  )
}

/** Open the tokens modal from the account card, reopening the card if the
 * language switch closed it. */
async function openTokensModal(p: Page): Promise<void> {
  if (await p.getByTestId('cli-tokens-create').isVisible()) return
  await openAccountCard(p)
  await p.getByTestId('account-card-cli-tokens').click()
  // Wait for the CONTENT, not the frame: the list arrives over IPC, and a
  // frame-only wait captures an empty dialog.
  await p.getByTestId('cli-tokens-create').waitFor({ state: 'visible' })
}

When(
  'I capture the account card for every locale to {string}',
  async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
    const p = requirePage()
    await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
      ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
      beforeShot: async () => { await dismissExternalChangeToast(p); await openAccountCard(p) },
      // The card, not the window behind it.
      clipTo: () => p.getByTestId('account-card-popover')
    })
    await p.keyboard.press('Escape')
  }
)

// The slash is ESCAPED: in a Cucumber expression `/` means alternation, so
// an unescaped `CLI/CI` would be read as "CLI" or "CI" and match neither.
When(
  'I capture my CLI\\/CI tokens for every locale to {string}',
  async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
    const p = requirePage()
    await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
      ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
      beforeShot: async () => { await dismissExternalChangeToast(p); await openTokensModal(p) },
      // The dialog box itself — the dimmed application behind it carries no
      // information the reader of this page needs.
      // The dialog BOX (`role=dialog`), not its body: the header carries the
      // title, which is what names the feature on the documentation page.
      clipTo: () => p.locator('.ecu-modal-container[role="dialog"]')
    })
    // Closing matters for what comes AFTER: the modal is an overlay, and the
    // scenario-building steps would otherwise click through a live dialog.
    await p.keyboard.press('Escape')
    await p.getByTestId('cli-tokens-create').waitFor({ state: 'hidden' })
  }
)

/** Open the MCP status-bar indicator popover, reopening it per locale (a
 * language switch closes it), and guard on the tooltip host being opaque so the
 * capture never photographs an empty screen mid-fade (same trap as the account
 * card). */
async function openMcpPopover(p: Page): Promise<void> {
  const popover = p.getByTestId('statusbar-mcp-popover')
  if (!(await popover.isVisible())) {
    await p.getByTestId('statusbar-mcp-indicator').click()
    await popover.waitFor({ state: 'visible' })
  }
  await popover.evaluate(
    (el) =>
      new Promise<void>((resolve, reject) => {
        const host = el.closest('.tooltip')
        if (!host) { reject(new Error('mcp tooltip host not found')); return }
        const deadline = Date.now() + 5000
        const check = (): void => {
          if (getComputedStyle(host).opacity === '1') { resolve(); return }
          if (Date.now() > deadline) { reject(new Error('mcp popover never became opaque — the capture would show no popover')); return }
          setTimeout(check, 50)
        }
        check()
      })
  )
}

/** Open the "Add Restorm to your AI assistant" modal from the MCP popover,
 * reopening the popover if a language switch closed it. */
async function openMcpConnectModal(p: Page): Promise<void> {
  if (await p.getByTestId('mcp-connect-copy-claude-code').isVisible()) return
  await openMcpPopover(p)
  await p.getByTestId('statusbar-mcp-connect-assistant').click()
  // Wait for the modal CONTENT (a copy button), not just the dialog frame.
  await p.getByTestId('mcp-connect-copy-claude-code').waitFor({ state: 'visible' })
}

When(
  'I capture the MCP indicator for every locale to {string}',
  async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
    const p = requirePage()
    await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
      ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
      beforeShot: async () => {
      await dismissExternalChangeToast(p)
        await openMcpPopover(p)
        // Stamp a synthetic "activity ripple" on the MCP icon. The real pulse is
        // a transient animation the freeze/capture can't reliably paint, so we
        // draw a ring styled exactly like `.statusbar-pulse-wave` at a
        // mid-expansion frame — illustrating the doc's "the indicator blinks on
        // every inbound call". Removed after the shot so it touches nothing else.
        await p.evaluate(() => {
          document.querySelectorAll('.doc-shots-mcp-ripple').forEach((n) => { n.remove() })
          const ind = document.querySelector('[data-testid="statusbar-mcp-indicator"]')
          const icon = ind?.querySelector('.codicon') as HTMLElement | null
          if (!icon) return
          const r = icon.getBoundingClientRect()
          const size = Math.max(r.width, r.height) * 1.9
          const ring = document.createElement('div')
          ring.className = 'doc-shots-mcp-ripple'
          ring.style.cssText = [
            'position:fixed',
            `left:${String(r.left + r.width / 2 - size / 2)}px`,
            `top:${String(r.top + r.height / 2 - size / 2)}px`,
            `width:${String(size)}px`,
            `height:${String(size)}px`,
            'border-radius:50%',
            'background-color:var(--statusBar-prominentBackground, var(--focusBorder))',
            'opacity:0.4',
            'z-index:9998',
            'pointer-events:none'
          ].join(';')
          document.body.appendChild(ring)
        })
      },
      // Wider than the popover alone: include the status bar it hangs off, with
      // margin all around, so the reader sees where the menu comes from. The
      // popover and the status-bar indicator are disjoint elements, so union
      // their boxes and extend down past the status-bar row (room for the ripple).
      clip: async () => {
        const pop = await p.getByTestId('statusbar-mcp-popover').boundingBox()
        const bar = await p.getByTestId('statusbar-mcp-indicator').boundingBox()
        const vp = p.viewportSize() ?? { width: 1600, height: 1000 }
        if (!pop || !bar) throw new Error('mcp popover/indicator not found for clip')
        const pad = 28
        const x = Math.max(0, Math.min(pop.x, bar.x) - pad)
        const y = Math.max(0, pop.y - pad)
        const right = Math.min(vp.width, Math.max(pop.x + pop.width, bar.x + bar.width) + pad)
        const bottom = Math.min(vp.height, bar.y + bar.height + 10)
        return { x, y, width: right - x, height: bottom - y }
      }
    })
    await p.evaluate(() => { document.querySelectorAll('.doc-shots-mcp-ripple').forEach((n) => { n.remove() }) })
    await p.keyboard.press('Escape')
  }
)

When(
  'I capture the MCP connect modal for every locale to {string}',
  async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
    const p = requirePage()
    await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
      ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
      beforeShot: async () => { await dismissExternalChangeToast(p); await openMcpConnectModal(p) },
      // The dialog BOX (role=dialog), not the dimmed app behind it.
      clipTo: () => p.locator('.ecu-modal-container[role="dialog"]')
    })
    await p.keyboard.press('Escape')
    await p.getByTestId('mcp-connect-copy-claude-code').waitFor({ state: 'hidden' })
  }
)

/** Open the Cookie jar workbench tab (View ▸ Cookie jar) and select the
 * default "No environment" jar, where the seeded cookies live. Idempotent: a
 * language switch keeps the workbench tab open, so this reopens only when the
 * panel is absent, then re-selects the root node whose cookies we captured. */
async function openCookieJar(p: Page): Promise<void> {
  const panel = p.getByTestId('cookie-jar')
  if (!(await panel.isVisible())) {
    // The View menu lives in the menubar at wide widths and collapses into an
    // overflow/hamburger button at the narrow doc-capture width — tolerate both.
    const cookiesItem = p.locator('[data-testid="titlebar-menu-item-cookies"]')
    const inBarView = p.locator('[data-testid="titlebar-menubar-item-view"]')
    if (await inBarView.isVisible().catch(() => false)) {
      await inBarView.click({ force: true })
    } else {
      await p
        .locator('[data-testid="titlebar-menubar-overflow-button"], [data-testid="titlebar-menubar-hamburger-button"]')
        .first()
        .click({ force: true })
      const viewEntry = p.locator('[data-testid="titlebar-menubar-item-view-overflow"]')
      await viewEntry.waitFor({ state: 'visible', timeout: 15000 })
      await viewEntry.hover()
      await viewEntry.click({ force: true })
    }
    await cookiesItem.waitFor({ state: 'visible', timeout: 5000 })
    await cookiesItem.click({ force: true })
    await panel.waitFor({ state: 'visible' })
  }
  // The default "No environment" jar holds the seeded cookies.
  await p.getByTestId('cookie-jar-tree-node-root').click()
  await expect(p.getByTestId('cookie-jar-panes')).toBeVisible({ timeout: 10000 })
}

// A FIXED far-future expiry keeps the capture byte-identical run over run —
// a relative `now + 7d` would render a different date every day and churn the
// committed screenshots.
const SEEDED_EXPIRY = '2035-06-01T00:00:00.000Z'

When('I seed the cookie jar with example cookies', async () => {
  const mcp = requireMcp()
  const add = (input: Record<string, unknown>): Promise<unknown> => callEmbeddedMcpTool(mcp, 'add_cookie', input)
  // A realistic spread: three origins, secure/httpOnly/SameSite flags, one
  // persistent + two session cookies — the same set the cookie-manager e2e uses.
  await add({ key: 'session_id', value: 's3cr3t-a1b2c3d4', domain: 'api.example.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax', expires: SEEDED_EXPIRY })
  await add({ key: 'csrftoken', value: 'k9f2m1', domain: 'api.example.com', path: '/', secure: true })
  await add({ key: 'theme', value: 'dark', domain: 'app.example.com', path: '/' })
  await add({ key: 'cart', value: 'sku-42,sku-77', domain: 'shop.example.com', path: '/checkout' })
})

When('I open the Cookie jar', async () => {
  await openCookieJar(requirePage())
})

When(
  'I capture the Cookie jar for every locale to {string}',
  async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
    const p = requirePage()
    await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
      ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
      // The workbench tab survives a language switch, but re-assert it and the
      // root selection per locale so a stray repaint can't photograph an empty
      // or wrong-jar panel silently.
      beforeShot: async () => { await dismissExternalChangeToast(p); await openCookieJar(p) },
      // The panel itself — the workbench chrome behind it carries nothing the
      // documentation reader needs.
      clipTo: () => p.getByTestId('cookie-jar')
    })
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
    await dismissExternalChangeToast(p)
  }
)

/** Authoring through the embedded MCP writes the project to disk, which the
 * open-file watcher reports as an external change — a toast that must not ride
 * into the scenario capture. Dismiss it (keeping the in-editor version) if it
 * showed; a no-op when it didn't. */
async function dismissExternalChangeToast(p: Page): Promise<void> {
  const keepMine = p.getByTestId('file-external-change-keep-mine')
  if (await keepMine.isVisible().catch(() => false)) {
    await keepMine.click({ force: true })
    await p.getByTestId('file-external-change-keep-mine').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined)
  }
}

When('I mark the scenario {string} as favorite', async ({}, _scenarioName: string) => {
  if (fightScenarioId === null) throw new Error('build the scenario first')
  await callEmbeddedMcpTool(requireMcp(), 'set_favorite', { itemId: fightScenarioId, favorite: true })
  await requirePage().waitForTimeout(500)
  // set_favorite autosaves too — clear any external-change toast before capture.
  await dismissExternalChangeToast(requirePage())
})

/** Open the scenario editor's add-node palette (a right-click context menu on
 * the React Flow pane) over the currently-open scenario. */
async function openScenarioPalette(p: Page): Promise<void> {
  await expect(p.locator('[data-testid="scenario-editor"]')).toBeVisible({ timeout: 10000 })
  const pane = p.locator('[data-testid="scenario-editor"] .react-flow__pane').first()
  // Right-click an empty area near the top-left of the pane so the palette opens
  // fully in view rather than clipped at a corner.
  await pane.click({ button: 'right', position: { x: 120, y: 90 } })
  await expect(p.locator('[data-testid="scenario-node-palette"]')).toBeVisible({ timeout: 5000 })
  await p.waitForTimeout(300)
}

When('I open the add-node palette in the scenario editor', async () => {
  await openScenarioPalette(requirePage())
})

Then('I capture the scenario palette for every locale to {string}', async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
  const p = requirePage()
  await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
    ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
    beforeShot: async () => {
      await dismissExternalChangeToast(p)
      // A language switch closes the context menu — re-open it per locale.
      if (!(await p.locator('[data-testid="scenario-node-palette"]').isVisible().catch(() => false))) {
        await openScenarioPalette(p).catch(() => undefined)
      }
      await p.waitForTimeout(300)
    }
    // Full window: the scenario graph with the add-node palette open over it.
  })
  // Close the palette so it stops covering the canvas for later steps.
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
})

// ---- API designer captures ------------------------------------------------

/** The built design's id, kept across the designer capture steps. */
let designId: string | null = null

function requireDesign(): string {
  if (designId === null) throw new Error('build the design first')
  return designId
}

/** Build a representative Petstore API design through the embedded MCP design
 * tools (the app's supported programmatic surface — writes go through the
 * main-process store, repaint the open editor and autosave), then open its tab.
 * Rich enough to make every designer section a good screenshot: a couple of
 * models with flags + an example, an enum, CRUD routes, and a template. */
const PETSTORE_MOCK_PORT = 4599

When('I build the Petstore API design served on port {int}', async ({ restormRoot }, _port: number) => {
  const p = requirePage()
  const mcp = requireMcp()
  const call = (name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> =>
    callEmbeddedMcpTool<Record<string, unknown>>(mcp, name, input)

  // A fresh project gives the design a home in the sidebar. The path shows in
  // the status bar of every capture — a neutral, machine-independent location.
  const projectDir = '/tmp/restorm-designer-demo'
  rmSync(projectDir, { recursive: true, force: true })
  mkdirSync(projectDir, { recursive: true })
  await call('create_project', { filePath: join(projectDir, 'petstore.restorm') })
  // Await the renderer post-load mirror before authoring through MCP.
  await p.waitForTimeout(1500)

  // Import the bundled Swagger Petstore (served over localhost so it is a real
  // import), then DERIVE a design from it — realistic types (Pet.photoUrls:
  // array<string>), models, routes and auth, exactly like a user would.
  const spec = readFileSync(join(restormRoot, 'tests/unit/swagger-petstore.json'), 'utf-8')
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(spec)
  })
  await new Promise<void>((resolve) => { server.listen(PETSTORE_MOCK_PORT, '127.0.0.1', () => { resolve() }) })
  try {
    await call('import_from_url', { url: `http://127.0.0.1:${String(PETSTORE_MOCK_PORT)}/swagger-petstore.json` })
    await p.waitForTimeout(2000)
  } finally {
    server.close()
  }

  const envFolders = await callEmbeddedMcpTool<{ id: string; kind: string }[]>(mcp, 'list_folders', {})
  const envFolder = envFolders.find((f) => f.kind === 'env-folder')
  if (envFolder === undefined) throw new Error('no env folder after the petstore import')
  const derived = await call('create_design_from_documentation', { envFolderId: envFolder.id, name: 'Petstore' })
  designId = typeof derived['id'] === 'string' ? derived['id'] : null
  const id = requireDesign()

  // Drop the imported REQUEST tree so the sidebar stays focused on the design.
  // The import creates one request folder per tag (pet/store/user) under the env
  // folder; delete every non-env, non-design folder, keeping the env folder +
  // the derived design.
  const afterFolders = await callEmbeddedMcpTool<{ id: string; kind: string }[]>(mcp, 'list_folders', {})
  for (const f of afterFolders) {
    if (f.kind !== 'env-folder' && f.id !== id) {
      await call('delete_item', { id: f.id }).catch(() => undefined)
    }
  }

  // A real official template so the Code / Variables views populate.
  const templateRef = 'Monsieur-Dev/restorm-template-server-rest-typescript'
  await call('set_design_templates', {
    designId: id,
    templates: [{ repo: templateRef, outputDir: './out/api' }]
  })
  // Seed a couple of example codegen variables so the "Variables générales" and
  // the property "Génération de code" surfaces read as real (docs illustration).
  // Resolve the template by its actual id (a label ref is unreliable).
  const gdForTpl = await call('get_design', { designId: id })
  const codegen0 = gdForTpl['codegen'] as Record<string, unknown> | undefined
  const templates0 = (codegen0?.['templates'] as Record<string, unknown>[] | undefined) ?? []
  const firstTplId = templates0[0]?.['id']
  const tplRef = typeof firstTplId === 'string' ? firstTplId : templateRef
  await call('set_design_template_variables', {
    designId: id,
    template: tplRef,
    scope: 'project',
    variables: { packageName: '{{ kebabCase design.name }}', apiVersion: '"1.0.0"' }
  }).catch(() => undefined)
  await call('set_design_property_variables', {
    designId: id,
    model: 'Pet',
    property: 'name',
    template: tplRef,
    variables: { columnName: '"pet_name"', indexed: 'true' }
  }).catch(() => undefined)

  // Flush + persist, then reveal + open the design's tab (it is nested inside
  // the imported env folder).
  await p.keyboard.press('Control+S')
  await p.waitForTimeout(1000)
  await call('reveal_in_tree', { itemId: id })
  await p.waitForTimeout(800)
  const designRow = p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${id}"]`)
  await designRow.click()
  await expect(p.locator(`[data-testid="design-tab-view-${id}"]`)).toBeVisible({ timeout: 15000 })
  await p.waitForTimeout(800)
  await dismissExternalChangeToast(p)
  // Expand the design node so its section rows are present in the sidebar for
  // the capture steps to click.
  await expandRowViaToggle(p, designRow)
})

/** Switch the open design tab to a section by clicking its sidebar row. The
 * section rows are virtual sidebar entries with id `design-section:<id>:<key>`
 * (every section except `settings`, whose "row" is the design node itself) —
 * clicking one restages the design tab on that section (locale-independent,
 * unlike matching the translated label). */
async function gotoDesignSection(p: Page, id: string, section: string, selectEntity?: string): Promise<void> {
  const rowId = section === 'settings' ? id : `design-section:${id}:${section}`
  await p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${rowId}"]`).click()
  await expect(p.locator(`[data-testid="design-section-${section}"]`)).toBeVisible({ timeout: 10000 })
  await p.waitForTimeout(500)
  // Select an entity within the section (a model / a route) so the detail pane
  // is populated rather than showing the "select one" placeholder. The label is
  // design DATA (model/route names), not UI text — so it stays locale-stable.
  if (selectEntity !== undefined) {
    await p
      .locator(`[data-testid="design-${section}-section"]`)
      .getByText(selectEntity, { exact: true })
      .first()
      .click()
    await p.waitForTimeout(600)
  }
}

When(
  'I capture the designer section {string} selecting {string} for every locale to {string}',
  async ({ restormRoot, websiteOut, localesFilter }, section: string, entity: string, template: string) => {
    const p = requirePage()
    const id = requireDesign()
    await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
      ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
      beforeShot: async () => { await dismissExternalChangeToast(p); await gotoDesignSection(p, id, section, entity) }
    })
  }
)

/** The home-page designer hero — the Routes view with a route selected showing
 * its multi-protocol projections. Lands in the website's `assets/home/<locale>/`
 * (a sibling of the docs assets), not the docs tree. */
When('I capture the designer home shot for every locale to {string}', async ({ restormRoot, websiteOut, outRoot, localesFilter }, template: string) => {
  const p = requirePage()
  const id = requireDesign()
  const homeOut = join(websiteOut, '..', 'home')
  const written = await captureForAllLocales(p, restormRoot, targetResolver(homeOut, template), {
    ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
    beforeShot: async () => { await dismissExternalChangeToast(p); await gotoDesignSection(p, id, 'routes', 'Find pet by ID') }
  })
  // Mirror each home hero into the versioned screenshots/ root so the Snap Store
  // listing — which sources screenshots/<locale>/ — carries the designer shot
  // alongside welcome-home / request-editor / scenario-editor (same four images
  // as the website home hero).
  for (const src of written) {
    const dst = join(outRoot, relative(homeOut, src))
    mkdirSync(dirname(dst), { recursive: true })
    copyFileSync(src, dst)
  }
})

/** The Models view showcasing the feature: the Pet model selected with its
 * photoUrls (array-of-string) property open in the detail pane. Doubles as the
 * designer "overview" shot. */
When('I capture the models overview for every locale to {string}', async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
  const p = requirePage()
  const id = requireDesign()
  await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
    ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
    beforeShot: async () => {
      await dismissExternalChangeToast(p)
      await gotoDesignSection(p, id, 'models', 'Pet')
      await p
        .locator('[data-testid="design-properties-table"]')
        .getByText('photoUrls', { exact: true })
        .first()
        .click()
      await p.waitForTimeout(500)
    }
  })
})

/** Serve the design as a mock (Pro/Enterprise — the doc-shots run is seeded
 * Pro) so the Server + Clients sections show a live server. */
When('I serve the design mock', async () => {
  const id = requireDesign()
  await callEmbeddedMcpTool(requireMcp(), 'serve_design', { designId: id })
  await requirePage().waitForTimeout(2000)
  await dismissExternalChangeToast(requirePage())
})

/** The Clients section, with the Clients node EXPANDED in the sidebar so its
 * protocol sub-rows are visible (per the doc framing). */
When('I capture the clients section for every locale to {string}', async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
  const p = requirePage()
  const id = requireDesign()
  await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
    ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
    beforeShot: async () => {
      await dismissExternalChangeToast(p)
      await gotoDesignSection(p, id, 'clients')
      // Fully expand the sidebar tree (all levels) so the whole client subtree
      // is visible — the dedicated "expand all" toolbar button.
      await p.locator('[data-testid="sidebar-expand-all-button"]').click()
      await p.waitForTimeout(700)
    }
  })
})

/** The template LIBRARY modal (Code ▸ Add a template) — its Official / Recent /
 * Custom tabs. Officials load from the cloud (the run pins the dev channel), so
 * the Official tab shows the curated set even though the seeded session has no
 * cloud token (the app's anonymous officials fetch backs it). */
When('I capture the template library for every locale to {string}', async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
  const p = requirePage()
  const id = requireDesign()
  await gotoDesignSection(p, id, 'code')
  await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
    ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
    beforeShot: async () => {
      await dismissExternalChangeToast(p)
      const tabs = p.locator('[data-testid="design-template-library-tabs"]')
      if (!(await tabs.isVisible().catch(() => false))) {
        await p.locator('[data-testid="design-code-add"]').click()
      }
      await expect(tabs).toBeVisible({ timeout: 15000 })
      // Open on the Official tab — the officials load via the anonymous cloud
      // fetch, and that is what the doc page illustrates.
      await p.locator('[data-testid="design-template-library-tabs-tab-official"]').click().catch(() => undefined)
      // Let the cloud officials land so the tab isn't mid-fetch.
      await p.waitForTimeout(1500)
    },
    clipTo: () => p.locator('.ecu-modal-container[role="dialog"]')
  })
  await p.keyboard.press('Escape')
})

/** The general (project-scope) codegen variables editor — Code ▸ General
 * variables — showing the variables a template declares and their Handlebars
 * values. */
When('I capture the general variables for every locale to {string}', async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
  const p = requirePage()
  const id = requireDesign()
  await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
    ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
    beforeShot: async () => {
      await dismissExternalChangeToast(p)
      await gotoDesignSection(p, id, 'code')
      await p.locator('[data-testid="design-code-tabs-tab-variables"]').click()
      await expect(p.locator('[data-testid="design-codegen-general-section"]')).toBeVisible({ timeout: 10000 })
      await p.waitForTimeout(500)
    }
  })
})

/** A property's Code-generation tab — its flags + the variables a template reads
 * for it. Models ▸ Pet ▸ property ▸ Code generation. */
When('I capture the property code-generation tab for every locale to {string}', async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
  const p = requirePage()
  const id = requireDesign()
  await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
    ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
    beforeShot: async () => {
      await dismissExternalChangeToast(p)
      await gotoDesignSection(p, id, 'models', 'Pet')
      await p.locator('[data-testid="design-properties-table"]').getByText('name', { exact: true }).first().click()
      await p.waitForTimeout(400)
      await p.locator('[data-testid="design-property-tab-codegen"]').click()
      await expect(p.locator('[data-testid="design-schema-detail"]')).toBeVisible({ timeout: 10000 })
      await p.waitForTimeout(500)
    }
  })
})

When(
  'I capture the designer section {string} for every locale to {string}',
  async ({ restormRoot, websiteOut, localesFilter }, section: string, template: string) => {
    const p = requirePage()
    const id = requireDesign()
    await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
      ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
      // Re-assert the section per locale: a language switch keeps the tab open
      // but re-navigating guarantees the right section is shown at capture time.
      beforeShot: async () => { await dismissExternalChangeToast(p); await gotoDesignSection(p, id, section) }
    })
  }
)

// ── Import-flow modal captures (per-locale modal chrome) ───────────────────
// The import MODALS carry translated chrome (labels, format blurbs) and live
// per-locale under assets/docs/<loc>/; the resulting-tree shots are language-
// independent (assets/docs/shared/) and are not captured here.

// Two cURL commands → a folder: the exact state the cURL doc screenshot shows.
const CURL_IMPORT_SAMPLE = [
  'curl https://api.restorm.example/pets',
  "curl -X POST https://api.restorm.example/pets -H 'Content-Type: application/json' -d '{\"name\":\"Rex\"}'"
].join('\n')

Given('I create a new empty project for import captures', async () => {
  const p = requirePage()
  // Neutral, machine-independent path — it shows in the status bar behind the
  // modal (the modal shots are clipped, but keep it clean regardless).
  const projectDir = '/tmp/restorm-import-demo'
  rmSync(projectDir, { recursive: true, force: true })
  mkdirSync(projectDir, { recursive: true })
  await configureNextSaveFileDialogForE2E(requireApp(), { kind: 'saveFile', path: join(projectDir, 'imports.restorm') })
  await p.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await p.locator('[data-testid="titlebar-menu-item-new"]').first().click()
  await p.waitForTimeout(800)
})

/** Dismiss a modal by its cancel button (falling back to Escape) if it's open. */
async function cancelModalIfOpen(p: Page, modalTestId: string, cancelTestId: string): Promise<void> {
  const modal = p.locator(`[data-testid="${modalTestId}"]`)
  if (!(await modal.isVisible().catch(() => false))) return
  const cancel = p.locator(`[data-testid="${cancelTestId}"]`)
  if (await cancel.isVisible().catch(() => false)) await cancel.click()
  else await p.keyboard.press('Escape')
  await modal.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => undefined)
}

/** Close any import modal so the next open renders cleanly in the current
 * language (a stale open modal repaints, but reopening is deterministic). */
async function closeImportModals(p: Page): Promise<void> {
  await cancelModalIfOpen(p, 'grpc-reflection-import-modal', 'grpc-reflection-cancel-button')
  await cancelModalIfOpen(p, 'import-modal', 'cancel-button')
}

async function openImportFormatModal(p: Page): Promise<void> {
  await closeImportModals(p)
  await p.keyboard.press('Control+I')
  await expect(p.locator('[data-testid="import-modal"]')).toBeVisible({ timeout: 5000 })
  await p.waitForTimeout(500)
}

async function openImportCurlModal(p: Page): Promise<void> {
  await closeImportModals(p)
  await p.keyboard.press('Control+I')
  await expect(p.locator('[data-testid="import-modal"]')).toBeVisible({ timeout: 5000 })
  await p.locator('[data-testid="source-input-input"]').fill(CURL_IMPORT_SAMPLE)
  // The preview tree (a folder of 2 requests) confirms the paste parsed.
  await expect(p.locator('[data-testid="import-selection-tree"]')).toBeVisible({ timeout: 15000 })
  await p.waitForTimeout(500)
}

async function openGrpcReflectionModal(p: Page): Promise<void> {
  await closeImportModals(p)
  await p.keyboard.press('Control+I')
  await expect(p.locator('[data-testid="import-modal"]')).toBeVisible({ timeout: 5000 })
  await p.locator('[data-testid="import-grpc-reflection-button"]').click()
  await expect(p.locator('[data-testid="grpc-reflection-import-modal"]')).toBeVisible({ timeout: 5000 })
  const addr = p.locator('[data-testid="grpc-reflection-address-input-input"]')
  if ((await addr.inputValue().catch(() => '')) === '') await addr.fill('localhost:50051')
  await p.waitForTimeout(400)
}

/** The ECUI dialog container for the topmost import modal. */
function importDialogBox(p: Page, modalTestId: string): Locator {
  return p.locator(`[data-testid="${modalTestId}"]`).locator('xpath=ancestor-or-self::*[contains(@class,"ecu-modal-container")]').first()
}

When(
  'I capture the import format modal for every locale to {string}',
  async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
    const p = requirePage()
    await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
      ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
      beforeShot: async () => { await dismissExternalChangeToast(p); await openImportFormatModal(p) },
      clipTo: () => importDialogBox(p, 'import-modal')
    })
    await closeImportModals(p)
  }
)

When(
  'I capture the cURL import modal for every locale to {string}',
  async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
    const p = requirePage()
    await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
      ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
      beforeShot: async () => { await dismissExternalChangeToast(p); await openImportCurlModal(p) },
      clipTo: () => importDialogBox(p, 'import-modal')
    })
    await closeImportModals(p)
  }
)

When(
  'I capture the gRPC reflection modal for every locale to {string}',
  async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
    const p = requirePage()
    await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
      ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
      beforeShot: async () => { await dismissExternalChangeToast(p); await openGrpcReflectionModal(p) },
      clipTo: () => importDialogBox(p, 'grpc-reflection-import-modal')
    })
    await closeImportModals(p)
  }
)

When('I import an API with design problems and open its Problems tab', async () => {
  const p = requirePage()
  const mcp = requireMcp()
  const call = (name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> =>
    callEmbeddedMcpTool<Record<string, unknown>>(mcp, name, input)

  // A fresh project so the flawed API is the whole sidebar — its path shows in
  // the status bar of every capture, so use a neutral, machine-independent one.
  const projectDir = '/tmp/restorm-demo-api-issues'
  rmSync(projectDir, { recursive: true, force: true })
  mkdirSync(projectDir, { recursive: true })
  await call('create_project', { filePath: join(projectDir, 'my-awesome-api.restorm') })
  await p.waitForTimeout(1500)

  // Serve the bundled flawed spec over localhost so it is a real import (the
  // same path a user takes), then let the background validation flag it.
  const spec = readFileSync(join(__dirname, '../fixtures/doc-shot-api-issues.json'), 'utf-8')
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(spec)
  })
  await new Promise<void>((resolveListen) => { server.listen(API_ISSUES_MOCK_PORT, '127.0.0.1', () => { resolveListen() }) })
  try {
    await call('import_from_url', { url: `http://127.0.0.1:${String(API_ISSUES_MOCK_PORT)}/my-awesome-api.json` })
    await p.waitForTimeout(1500)
  } finally {
    server.close()
  }

  const folders = await callEmbeddedMcpTool<{ id: string; kind: string }[]>(mcp, 'list_folders', {})
  const env = folders.find((f) => f.kind === 'env-folder')
  if (env === undefined) throw new Error('no env folder after the flawed API import')
  await call('open_tab', { itemId: env.id })
  await p.waitForTimeout(800)

  // The "Issues" tab only appears once the main-process validation has surfaced
  // problems — wait for it, then select it.
  const issuesTab = p.locator('[data-testid$="-tabs-tab-issues"]')
  await expect(issuesTab).toBeVisible({ timeout: 10000 })
  await issuesTab.click()
  await expect(p.locator('[data-testid="api-design-issues-list"]')).toBeVisible({ timeout: 5000 })
})

Then('I capture the API problems view for every locale to {string}', async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
  const p = requirePage()
  await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
    ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
    // A language switch re-renders the workbench, which can drop the active
    // sub-tab — re-select the Problems tab so every locale's shot lands on it.
    beforeShot: async () => {
      await dismissExternalChangeToast(p)
      const tab = p.locator('[data-testid$="-tabs-tab-issues"]')
      if (await tab.isVisible()) await tab.click()
      await expect(p.locator('[data-testid="api-design-issues-list"]')).toBeVisible({ timeout: 5000 })
    },
    // Frame on the workbench tab's CONTENT (the API title + its sub-tab bar with
    // "Problems" selected + the issues list). The content pane fills the full
    // editor height, so compute a TIGHT rectangle from the pane's top down to the
    // bottom of the list — no empty tail — recomputed per locale (translated
    // labels reflow the list height).
    clip: async () => await p.evaluate(() => {
      const pane = document.querySelector('.restorm-workbench-tab')
      const list = document.querySelector('[data-testid="api-design-issues-list"]')
      if (pane === null || list === null) throw new Error('workbench content / issues list not found for the clip')
      const pr = pane.getBoundingClientRect()
      const lr = list.getBoundingClientRect()
      return { x: pr.x, y: pr.y, width: pr.width, height: lr.bottom - pr.y + 16 }
    })
  })
})

// Which env-folder sub-tab the env-folder capture step should re-select per
// locale (a language switch can drop the active sub-tab).
let envFolderSubTab = ''

When('I open the ArtifactsMMO environment folder on its {string} sub-tab', async ({}, subTab: string) => {
  const p = requirePage()
  const mcp = requireMcp()
  const folders = await callEmbeddedMcpTool<{ id: string; kind: string }[]>(mcp, 'list_folders', {})
  const env = folders.find((f) => f.kind === 'env-folder')
  if (env === undefined) throw new Error('no env folder — import the API first')
  await callEmbeddedMcpTool(mcp, 'open_tab', { itemId: env.id })
  await p.waitForTimeout(800)
  envFolderSubTab = subTab
  const tab = p.locator(`[data-testid$="-tabs-tab-${subTab}"]`)
  await expect(tab).toBeVisible({ timeout: 8000 })
  await tab.click()
  await p.waitForTimeout(600)
})

Then('I capture the environment folder view for every locale to {string}', async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
  const p = requirePage()
  await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
    ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
    beforeShot: async () => {
      await dismissExternalChangeToast(p)
      // A language switch re-renders the workbench; re-select the sub-tab.
      const tab = p.locator(`[data-testid$="-tabs-tab-${envFolderSubTab}"]`)
      if (await tab.isVisible()) await tab.click()
      await p.waitForTimeout(300)
    }
    // Full window (no clip): these captures show the sidebar + the workbench,
    // matching the existing 1600x1000 manual shots.
  })
})

When('I open the settings page', async () => {
  const p = requirePage()
  await p.locator('[data-testid="titlebar-settings-button"]').click()
  await expect(p.locator('[data-testid="settings-tab-content"]')).toBeVisible({ timeout: 5000 })
  await p.waitForTimeout(600)
})

Then('I capture the settings page for every locale to {string}', async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
  const p = requirePage()
  await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
    ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
    beforeShot: async () => {
      await dismissExternalChangeToast(p)
      // A language switch may steal focus; ensure the settings tab is showing.
      if (!(await p.locator('[data-testid="settings-tab-content"]').isVisible())) {
        await p.locator('[data-testid="titlebar-settings-button"]').click()
      }
      // Move the pointer off the gear button so its "Open settings" hover
      // tooltip isn't captured, and give it a beat to fade.
      await p.mouse.move(640, 450)
      await p.waitForTimeout(400)
    }
    // Full window: the settings page shows the User/Workspace tabs, the search
    // and the table of contents — the whole 1280x1000 window is the subject.
  })
})

When('I create the custom value list {string} with values {string}', async ({}, listName: string, csv: string) => {
  const p = requirePage()
  await p.keyboard.press('Control+S')
  await p.waitForTimeout(600)
  const mcp = requireMcp()
  const folders = await callEmbeddedMcpTool<{ id: string; kind: string }[]>(mcp, 'list_folders', {})
  const env = folders.find((f) => f.kind === 'env-folder')
  if (env === undefined) throw new Error('no env folder — import the API first')
  const entries = csv.split(',').map((v) => v.trim()).filter((v) => v.length > 0)
    .map((v) => ({ label: v, value: v.toLowerCase() }))
  await callEmbeddedMcpTool(mcp, 'create_custom_value_list', { folderId: env.id, name: listName, entries })
  await p.waitForTimeout(400)
})

let envValueList = ''

When('I open the ArtifactsMMO folder Custom-values tab on the list {string}', async ({}, listName: string) => {
  const p = requirePage()
  const mcp = requireMcp()
  const folders = await callEmbeddedMcpTool<{ id: string; kind: string }[]>(mcp, 'list_folders', {})
  const env = folders.find((f) => f.kind === 'env-folder')
  if (env === undefined) throw new Error('no env folder — import the API first')
  await callEmbeddedMcpTool(mcp, 'open_tab', { itemId: env.id })
  await p.waitForTimeout(800)
  const tab = p.locator('[data-testid$="-tabs-tab-custom-values"]')
  await expect(tab).toBeVisible({ timeout: 8000 })
  await tab.click()
  await p.waitForTimeout(500)
  envValueList = listName
  await p.getByText(listName, { exact: true }).first().click()
  await p.waitForTimeout(400)
})

Then('I capture the value-list view for every locale to {string}', async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
  const p = requirePage()
  await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
    ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
    beforeShot: async () => {
      await dismissExternalChangeToast(p)
      const tab = p.locator('[data-testid$="-tabs-tab-custom-values"]')
      if (await tab.isVisible()) await tab.click()
      // Re-select the curated list (a language switch resets the selection).
      await p.getByText(envValueList, { exact: true }).first().click().catch(() => undefined)
      await p.waitForTimeout(300)
    }
  })
})

When('I mark the requests {string} as favorites', async ({}, csv: string) => {
  const p = requirePage()
  await p.keyboard.press('Control+S')
  await p.waitForTimeout(600)
  const mcp = requireMcp()
  const wanted = csv.split(',').map((s) => s.trim())
  const requests = await callEmbeddedMcpTool<{ id: string; name: string }[]>(mcp, 'list_requests', {})
  for (const name of wanted) {
    const req = requests.find((r) => r.name === name)
    if (req === undefined) throw new Error(`request not found for favorite: ${name}`)
    await callEmbeddedMcpTool(mcp, 'set_favorite', { itemId: req.id, favorite: true })
  }
  await p.waitForTimeout(600)
})

Then('I capture the favorites pane for every locale to {string}', async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
  const p = requirePage()
  await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
    ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
    beforeShot: async () => { await dismissExternalChangeToast(p) },
    // The Favorites pane at the top of the sidebar, not the whole window.
    clipTo: () => p.locator('[data-testid="sidebar-favorites-listview"]')
  })
})

When('I add a staging and a prod environment to the ArtifactsMMO folder', async () => {
  const p = requirePage()
  await p.keyboard.press('Control+S')
  await p.waitForTimeout(600)
  const mcp = requireMcp()
  const folders = await callEmbeddedMcpTool<{ id: string; kind: string }[]>(mcp, 'list_folders', {})
  const env = folders.find((f) => f.kind === 'env-folder')
  if (env === undefined) throw new Error('no env folder — import the API first')
  // Nest staging + prod UNDER the imported base environment, not as siblings.
  const envList = await callEmbeddedMcpTool<{ environments: { id: string; name: string }[] }>(mcp, 'list_environments', { envFolderId: env.id })
  const base = envList.environments[0]
  if (base === undefined) throw new Error('no base environment on the imported folder')
  // staging → blue
  const staging = await callEmbeddedMcpTool<{ id: string }>(mcp, 'create_environment', { envFolderId: env.id, name: 'staging', parentEnvironmentId: base.id })
  await callEmbeddedMcpTool(mcp, 'update_environment', { envId: staging.id, color: '#2563eb' })
  // prod → red + flame emoji
  const prod = await callEmbeddedMcpTool<{ id: string }>(mcp, 'create_environment', { envFolderId: env.id, name: 'prod', parentEnvironmentId: base.id })
  await callEmbeddedMcpTool(mcp, 'update_environment', { envId: prod.id, color: '#dc2626', icon: { type: 'emoji', value: '🔥' } })
  await p.waitForTimeout(600)
})

// ---- request sub-tab captures (code snippets, notes) ----------------------

/** The request opened by the generic sub-tab step, kept so the capture step can
 * re-select its sub-tab after a language switch re-renders the workbench. */
let openRequestId: string | null = null
let openRequestSubTab = ''

When('I open the imported request {string} on its {string} sub-tab', async ({}, requestName: string, subTab: string) => {
  const p = requirePage()
  const mcp = requireMcp()
  const requests = await callEmbeddedMcpTool<{ id: string; name: string }[]>(mcp, 'list_requests', {})
  const req = requests.find((r) => r.name === requestName)
  if (req === undefined) throw new Error(`request "${requestName}" not found among ${String(requests.length)} imported requests`)
  openRequestId = req.id
  openRequestSubTab = subTab
  await callEmbeddedMcpTool(mcp, 'open_tab', { itemId: req.id })
  await p.waitForTimeout(1000)
  // Request sub-tabs live on the `base-request-tabs-request` Tabs, so the id is
  // `base-request-tabs-request-tab-<id>` (env-folder tabs use `-tabs-tab-<id>`).
  // Every OPENED request renders its own hidden tab bar, so scope to `:visible`
  // (only the active pane is displayed) to avoid a strict-mode multi-match.
  const tab = p.locator(`[data-testid="base-request-tabs-request-tab-${subTab}"]:visible`)
  await expect(tab).toBeVisible({ timeout: 8000 })
  await tab.click()
  await p.waitForTimeout(600)
})

/** Re-select the tracked request's sub-tab (a language switch re-renders the
 * workbench and can drop the active sub-tab). */
async function reselectRequestSubTab(p: Page): Promise<void> {
  const tab = p.locator(`[data-testid="base-request-tabs-request-tab-${openRequestSubTab}"]:visible`)
  if (await tab.isVisible().catch(() => false)) await tab.click()
  await p.waitForTimeout(300)
}

Then('I capture the code snippets view for every locale to {string}', async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
  const p = requirePage()
  await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
    ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
    beforeShot: async () => { await dismissExternalChangeToast(p); await reselectRequestSubTab(p) },
    // Frame on the workbench tab's CONTENT (title + sub-tab bar + the generated
    // snippets), matching the request-editor family of shots. Only the active
    // request's pane is displayed, so scope to the visible workbench tab.
    clipTo: () => p.locator('.restorm-workbench-tab:visible').first()
  })
})

When('I write an example note on the open request', async () => {
  const p = requirePage()
  const editor = p.locator('[data-testid="base-request-markdown-editor-notes-editor"]:visible').first()
  await expect(editor).toBeVisible({ timeout: 8000 })
  await editor.click()
  await p.waitForTimeout(200)
  await editor.pressSequentially('Smoke-tested nightly against the staging environment. Returns 200 for the server status.', { delay: 8 })
  await p.waitForTimeout(400)
})

When('I run the open request', async () => {
  if (openRequestId === null) throw new Error('open a request first')
  const p = requirePage()
  // Best-effort: the ArtifactsMMO server-status route is public, so a live run
  // fills the response panel — but a network hiccup must not fail the capture.
  await callEmbeddedMcpTool(requireMcp(), 'run_request', { id: openRequestId }).catch(() => undefined)
  await p.waitForTimeout(1500)
})

Then('I capture the request notes view for every locale to {string}', async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
  const p = requirePage()
  await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
    ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
    beforeShot: async () => { await dismissExternalChangeToast(p); await reselectRequestSubTab(p) }
    // Full window: the Notes tab on the left with the response panel on the right.
  })
})

// ---- example environment variables (secret + string) ----------------------

When('I set example environment variables on the ArtifactsMMO folder', async () => {
  const p = requirePage()
  await p.keyboard.press('Control+S')
  await p.waitForTimeout(600)
  const mcp = requireMcp()
  const folders = await callEmbeddedMcpTool<{ id: string; kind: string }[]>(mcp, 'list_folders', {})
  const envFolder = folders.find((f) => f.kind === 'env-folder')
  if (envFolder === undefined) throw new Error('no env folder — import the API first')
  const envList = await callEmbeddedMcpTool<{ environments: { id: string; name: string }[] }>(mcp, 'list_environments', { envFolderId: envFolder.id })
  const envs = envList.environments
  // The base environment created by the import (not the staging/prod we added).
  const base = envs.find((e) => e.name !== 'staging' && e.name !== 'prod') ?? envs[0]
  if (base === undefined) throw new Error('no environment on the imported folder')
  const set = (key: string, value: Record<string, unknown>, description: string): Promise<unknown> =>
    callEmbeddedMcpTool(mcp, 'set_env_variable', { envId: base.id, key, value, description })
  // The imported spec already carries Secret-typed variables from its security
  // schemes (the `$=` marker + refresh / edit-retrieval / lock affordances), so
  // the shot just needs a couple of plain string variables next to them.
  await set('baseUrl', { type: 'string', value: 'https://api.artifactsmmo.com' }, 'Base URL of the ArtifactsMMO API')
  await set('character', { type: 'string', value: 'Buffy' }, 'Default character used by the examples')
  await p.waitForTimeout(600)
})

// ---- global search (search everything) ------------------------------------

let searchQuery = ''

async function openSearchAndType(p: Page, query: string): Promise<void> {
  // Click the collapsed pill to expand + focus the search input, then type via
  // the keyboard: the ECUI InputBox wrapper is a zero-box element Playwright
  // reports "hidden", so `.fill()` on it fails even though it holds focus.
  await p.locator('[data-testid="main-titlebar-searchbar-closed"]').click()
  await p.waitForTimeout(400)
  await p.keyboard.insertText(query)
  await expect(p.locator('[data-testid="main-titlebar-searchbar-results"]')).toBeVisible({ timeout: 5000 })
  await p.waitForTimeout(500)
}

When('I open the global search and type {string}', async ({}, query: string) => {
  searchQuery = query
  await openSearchAndType(requirePage(), query)
})

Then('I capture the global search for every locale to {string}', async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
  const p = requirePage()
  await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
    ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
    beforeShot: async () => {
      await dismissExternalChangeToast(p)
      // A language switch closes the palette — re-open and re-type per locale.
      if (!(await p.locator('[data-testid="main-titlebar-searchbar-results"]').isVisible().catch(() => false))) {
        await openSearchAndType(p, searchQuery).catch(() => undefined)
      }
      await p.waitForTimeout(400)
    }
    // Full window: the unfolded search bar and its grouped results dropdown.
  })
  // Close the palette so its results overlay stops intercepting later clicks.
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
})

// ---- resolved URL preview -------------------------------------------------

Then('I capture the resolved URL preview for every locale to {string}', async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
  const p = requirePage()
  await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
    ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
    beforeShot: async () => {
      await dismissExternalChangeToast(p)
      await reselectRequestSubTab(p)
    },
    // A tight crop of the URL bar plus the resolved-value line rendered beneath
    // it (variables substituted by the active environment). Every OPENED request
    // renders its own hidden url-container, so pick the visible one (non-zero box).
    clip: async () => await p.evaluate(() => {
      const visible = (sel: string): DOMRect | null => {
        for (const el of Array.from(document.querySelectorAll(sel))) {
          const r = el.getBoundingClientRect()
          if (r.width > 0 && r.height > 0) return r
        }
        return null
      }
      // Anchor on the whole URL section (method badge + url input), then grow the
      // box down and out to include the resolved-value line beneath it.
      const sec = visible('[data-testid="http-request-url-section"]') ?? visible('[data-testid="url-container"]')
      if (sec === null) throw new Error('no visible url section for the clip')
      const prev = visible('[data-testid="url-resolved-preview"]')
      const left = prev !== null ? Math.min(sec.x, prev.x) : sec.x
      const right = prev !== null ? Math.max(sec.right, prev.right) : sec.right
      const bottom = prev !== null ? Math.max(sec.bottom, prev.bottom) : sec.bottom
      const pad = 10
      return { x: Math.max(0, left - pad), y: Math.max(0, sec.y - pad), width: (right - left) + pad * 2, height: (bottom - sec.y) + pad * 2 }
    })
  })
})

// ---- response history + console (after running the request a few times) ----

When('I run the open request {int} times', async ({}, times: number) => {
  if (openRequestId === null) throw new Error('open a request first')
  const p = requirePage()
  const mcp = requireMcp()
  for (let i = 0; i < times; i++) {
    await callEmbeddedMcpTool(mcp, 'run_request', { id: openRequestId }).catch(() => undefined)
    await p.waitForTimeout(700)
  }
  await p.waitForTimeout(500)
})

When('I open the response history of the open request', async () => {
  if (openRequestId === null) throw new Error('open a request first')
  const p = requirePage()
  const button = p.locator(`[data-testid="request-header-history-button-${openRequestId}"]`)
  await expect(button).toBeVisible({ timeout: 8000 })
  await button.click()
  await expect(p.locator('[data-testid="response-history-modal"]')).toBeVisible({ timeout: 8000 })
  await p.waitForTimeout(600)
})

Then('I capture the response history modal for every locale to {string}', async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
  const p = requirePage()
  await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
    ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
    beforeShot: async () => {
      await dismissExternalChangeToast(p)
      // A language switch can close the modal — re-open it if needed.
      if (!(await p.locator('[data-testid="response-history-modal"]').isVisible().catch(() => false))) {
        const button = p.locator(`[data-testid="request-header-history-button-${openRequestId ?? ''}"]`)
        if (await button.isVisible().catch(() => false)) await button.click()
      }
      await p.waitForTimeout(300)
    },
    clipTo: () => p.locator('[data-testid="response-history-modal"]')
  })
  // Close the modal so it stops covering the workbench for later steps.
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
})

When('I open the console', async () => {
  const p = requirePage()
  await callEmbeddedMcpTool(requireMcp(), 'open_console', {})
  await expect(p.locator('[data-testid="console-panel"]')).toBeVisible({ timeout: 8000 })
  // Render the captured calls as cURL (vs PowerShell).
  const curl = p.locator('[data-testid="console-toolbar-shell-curl"]')
  if (await curl.isVisible().catch(() => false)) await curl.click()
  await p.waitForTimeout(600)
})

Then('I capture the console for every locale to {string}', async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
  const p = requirePage()
  await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
    ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
    beforeShot: async () => {
      await dismissExternalChangeToast(p)
      const curl = p.locator('[data-testid="console-toolbar-shell-curl"]')
      if (await curl.isVisible().catch(() => false)) await curl.click()
      await p.waitForTimeout(300)
    }
    // Full window: the console tab with the captured calls + curl/powershell toggle.
  })
})

// ---- settings groups (theme carousel on User, updates on Workspace) --------

/** Ensure the settings page is open and the given scope tab ('user' | 'workspace')
 * is selected — the theme lives under User, the app groups under Workspace. */
async function ensureSettingsScope(p: Page, scope: string): Promise<void> {
  if (!(await p.locator('[data-testid="settings-tab-content"]').isVisible().catch(() => false))) {
    await p.locator('[data-testid="titlebar-settings-button"]').click()
    await expect(p.locator('[data-testid="settings-tab-content"]')).toBeVisible({ timeout: 5000 })
  }
  const tab = p.locator(`[data-testid="settings-page-tab-${scope}"]`)
  if (await tab.isVisible().catch(() => false)) await tab.click()
  await p.waitForTimeout(300)
}

Then('I capture the theme carousel for every locale to {string}', async ({ restormRoot, websiteOut, localesFilter }, template: string) => {
  const p = requirePage()
  await captureForAllLocales(p, restormRoot, targetResolver(websiteOut, template), {
    ...(localesFilter.length > 0 ? { locales: localesFilter } : {}),
    beforeShot: async () => {
      await dismissExternalChangeToast(p)
      await ensureSettingsScope(p, 'user')
      // Scroll the settings content back to the top so the Appearance section
      // (with the theme carousel) leads the shot.
      await p.evaluate(() => {
        const pane = document.querySelector('[data-testid="settings-page-settings-view"]') ?? document.querySelector('[data-testid="settings-tab-content"]')
        const scroller = pane?.querySelector('[class*="scroll"], [style*="overflow"]') ?? pane
        if (scroller instanceof HTMLElement) scroller.scrollTop = 0
      }).catch(() => undefined)
      await p.mouse.move(640, 450)
      await p.waitForTimeout(300)
    },
    // The settings tab content (User scope) scrolled to the Appearance section —
    // the theme selector shown in its settings context, without the sidebar.
    clipTo: () => p.locator('[data-testid="settings-tab-content"]')
  })
})
