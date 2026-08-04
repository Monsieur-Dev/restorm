import { createBdd } from 'playwright-bdd'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { configureNextSaveFileDialogForE2E } from 'electron-core-ui/testing'
import {
  test,
  expect,
  DOC_VIEWER_TEMP_DIR,
  currentElectronApp
} from '../../fixtures/documentation-viewer.fixture'

const PETSTORE_SAMPLE = resolve(__dirname, '../../../../unit/swagger-petstore.json')

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null

function requirePage(): Page {
  if (!page) throw new Error('app must be launched before driving UI steps')
  return page
}

/** Resolve the currently-launched Electron app. Used by the
 * background step's save-dialog config; falls back to the
 * fixture's globalThis register so a dialog configured during
 * teardown still hits the right instance. */
function requireApp(): ElectronApplication {
  const app = electronApp ?? currentElectronApp()
  if (!app) throw new Error('app must be launched before configuring dialogs')
  return app
}

function sidebarRowByTitle(p: Page, title: string): import('@playwright/test').Locator {
  return p
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText(title, { exact: true }) })
    .first()
}

async function activateEnvFolderDocsTab(p: Page): Promise<void> {
  // Open the petstore env folder by clicking it in the sidebar — single
  // click opens the tab; double would just toggle expansion of the row.
  const envRow = sidebarRowByTitle(p, 'Swagger Petstore')
  await expect(envRow).toBeVisible({ timeout: 10000 })
  await envRow.click()

  // Switch to the Docs sub-tab inside that env folder view.
  const docsTab = p
    .locator('[role="tab"][data-tab-id="docs"]:visible')
    .first()
  await expect(docsTab).toBeVisible({ timeout: 10000 })
  await docsTab.click()
  await expect(p.locator('[data-testid="env-folder-documentation-host"]')).toBeVisible({ timeout: 10000 })
  // Give React Flow a moment to compute layout + fit-view.
  await p.waitForTimeout(800)
}

Given('the docs viewer scenario is bootstrapped with the Petstore spec', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  // 1. New single-file YAML collection.
  const filePath = join(DOC_VIEWER_TEMP_DIR, 'doc-viewer.restorm')
  await configureNextSaveFileDialogForE2E(requireApp(), { kind: 'saveFile', path: filePath })
  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()
  await expect(async () => { expect(existsSync(filePath)).toBe(true) }).toPass({ timeout: 10000 })
  await page.waitForTimeout(400)

  // 2. Import the Petstore sample.
  expect(existsSync(PETSTORE_SAMPLE), `sample must exist: ${PETSTORE_SAMPLE}`).toBe(true)
  await page.keyboard.press('Control+I')
  const importModal = page.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 10000 })
  const input = importModal.locator('textarea, input[type="text"]').first()
  await input.fill(PETSTORE_SAMPLE)
  await expect(importModal.locator('.import-preview-section')).toBeVisible({ timeout: 15000 })
  const importButton = importModal.locator('[role="button"]:has-text("Import")[aria-disabled="false"]')
  await expect(importButton).toBeVisible({ timeout: 15000 })
  await importButton.click()
  await expect(importModal).not.toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(800)

  // 3. Close any auto-opened request tab and let the window settle.
  const activeTab = page.locator('.tab[role="tab"][aria-selected="true"]').first()
  if (await activeTab.count() > 0 && await activeTab.isVisible()) {
    const closeBtn = activeTab.locator('[aria-label="Close"]').first()
    if (await closeBtn.count() > 0) await closeBtn.click()
  }
  await page.waitForTimeout(500)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+Shift+s')
  await expect.poll(async () => (await requirePage().title()).endsWith(' *'), {
    timeout: 10000,
    message: 'window should settle clean after import + auto-save'
  }).toBe(false)

  await activateEnvFolderDocsTab(page)
})

// ── Search ────────────────────────────────────────────────────────────

When('I press Ctrl+F on the docs panel', async () => {
  const p = requirePage()
  await p.keyboard.press('Control+f')
  await p.waitForTimeout(200)
})

Then('the custom search bar should be visible', async () => {
  const p = requirePage()
  const bar = p.locator('[data-testid="documentation-host-search-bar"]')
  await expect(bar).toBeVisible({ timeout: 5000 })
})

// ── Sidebar navigation ────────────────────────────────────────────────

When('I click the sidebar Operation entry {string}', async ({}, summary: string) => {
  const p = requirePage()
  const link = p
    .locator('[data-testid="documentation-host-sidebar"] [data-testid^="documentation-host-sidebar-op-"]')
    .filter({ hasText: summary })
    .first()
  await expect(link).toBeVisible({ timeout: 10000 })
  await link.click()
  await p.waitForTimeout(400)
})

Then('the route block {string} should be visible in the docs panel', async ({}, opSlug: string) => {
  const p = requirePage()
  const block = p.locator(`[data-testid="documentation-host-route-${opSlug}"]`)
  await expect(block).toBeVisible({ timeout: 10000 })
  // Verify the block sits inside the visible viewport.
  const box = await block.boundingBox()
  if (!box) throw new Error('route block has no bounding box')
  expect(box.y, 'route block should be on screen').toBeGreaterThan(-200)
})

When('I click the sidebar Model entry {string}', async ({}, modelName: string) => {
  const p = requirePage()
  const link = p.locator(`[data-testid="documentation-host-sidebar-model-${modelName}"]`)
  await expect(link).toBeVisible({ timeout: 10000 })
  await link.click()
  await p.waitForTimeout(800)
})

Then('the React Flow node {string} should be on screen', async ({}, modelName: string) => {
  const p = requirePage()
  const node = p.locator(`[data-testid="documentation-host-model-node-${modelName}"]`)
  await expect(node).toBeVisible({ timeout: 10000 })
  const box = await node.boundingBox()
  if (!box) throw new Error('model node has no bounding box')
  expect(box.y, 'model node should be on screen').toBeGreaterThan(-200)
})

// ── Outline legibility ────────────────────────────────────────────────

/** Every text-bearing surface whose colour this component pins to a theme
 * token, split by the lane it takes that colour from. The muted lane is
 * allowed the lower WCAG ratio that applies to secondary / large UI text.
 *
 * Two families are covered because they fail for opposite reasons: the
 * outline rows are ECUI Buttons that keep a foreground from the wrong
 * token family, and the metadata links are anchors nothing styles at all,
 * which fall through to the user agent's fixed blue. */
const CONTRAST_PRIMARY_SELECTORS = [
  '.documentation-host-sidebar__overview-link',
  '.documentation-host-sidebar__group-header',
  '.documentation-host-sidebar__op-link',
  '.documentation-host-sidebar__model-link',
  '.documentation-host-sidebar__enum-model',
  '.documentation-host-api-info a[href]',
  '.documentation-host-route-header__meta a[href]'
]

const CONTRAST_MUTED_SELECTORS = [
  '.documentation-host-sidebar__section-title--button',
  '.documentation-host-sidebar__overview-hint',
  '.documentation-host-sidebar__enum-prop-link'
]

/** WCAG AA: 4.5:1 for body text, 3:1 for secondary / large UI text. */
const MIN_RATIO_PRIMARY = 4.5
const MIN_RATIO_MUTED = 3

/** Marker custom property planted on `<html>` before a theme swap. The
 * renderer's theme applier wipes EVERY inline `--*` property off the root
 * before writing the new palette, so the marker disappearing is proof the
 * repaint actually ran — waiting on a fixed delay instead would let the
 * whole sweep measure one single theme fourteen times and pass vacuously. */
const THEME_REPAINT_MARKER = '--outline-contrast-repaint-marker'

async function applyThemeAndWaitForRepaint(p: Page, themeId: string): Promise<void> {
  // Setting the theme that is already current is a no-op in the main
  // process — it skips the broadcast — so the marker would never be
  // cleared and the wait below would time out on a page that is in fact
  // already showing what we asked for.
  const current = await p.evaluate(async () => (await window.api.theme.getCurrent()) ?? null)
  if (current === themeId) return

  await p.evaluate(
    async ({ id, marker }) => {
      document.documentElement.style.setProperty(marker, '1')
      await window.api.theme.set(id)
    },
    { id: themeId, marker: THEME_REPAINT_MARKER }
  )
  await p.waitForFunction(
    (marker) => document.documentElement.style.getPropertyValue(marker) === '',
    THEME_REPAINT_MARKER,
    { timeout: 10000 }
  )
  // The applier animates the swap; let the reveal transition settle so the
  // computed styles we read are the post-transition ones.
  await p.waitForTimeout(200)
}

interface WorstContrast {
  selector: string
  color: string
  background: string
  ratio: number
}

interface DocContrastResult {
  surfaces: string[]
  worstPrimary: WorstContrast | null
  worstMuted: WorstContrast | null
  measured: number
  /** Counted separately so the link half of this guard cannot quietly
   * cover nothing if the metadata block stops rendering anchors. */
  metadataLinks: number
}

/**
 * Measure, for every shipped theme, the contrast between each text
 * surface this component colours and the background actually painted
 * behind it.
 *
 * The background is resolved per element by walking ancestors and
 * compositing every translucent layer until an opaque one — the outline
 * sits on the Dock's surface while the metadata links sit on the editor
 * surface, so a single hard-coded background would measure one of the
 * two against the wrong thing. Colours are read off the rendered element
 * rather than from the stylesheet, which is the only way to catch a
 * declaration that loses the cascade.
 */
Then(
  'every sidebar outline entry should contrast with the panel behind it, on every shipped theme',
  async () => {
    const p = requirePage()
    await expect(p.locator('[data-testid="documentation-host-sidebar"]')).toBeVisible({ timeout: 10000 })

    const originalTheme = await p.evaluate(async () => (await window.api.theme.getCurrent()) ?? null)
    const themeIds = await p.evaluate(async () => (await window.api.theme.list()).map((t) => t.id))
    expect(themeIds.length, 'the app must ship at least one theme').toBeGreaterThan(0)

    const results: DocContrastResult[] = []
    try {
      for (const themeId of themeIds) {
        await applyThemeAndWaitForRepaint(p, themeId)

        results.push(
          await p.evaluate(
            ({ primary, muted }) => {
              interface Rgba { r: number, g: number, b: number, a: number }

              // Accepts `rgb()` / `rgba()` AND the `color(srgb …)` form that
              // `color-mix()` resolves to. Ignoring the latter silently skips
              // a chip's own fill and measures its text against the surface
              // two levels up, which reads as a false white-on-white.
              const parse = (value: string): Rgba | null => {
                const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/.exec(value)
                if (rgb) {
                  return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: rgb[4] === undefined ? 1 : Number(rgb[4]) }
                }
                const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?/.exec(value)
                if (srgb) {
                  return { r: Number(srgb[1]) * 255, g: Number(srgb[2]) * 255, b: Number(srgb[3]) * 255, a: srgb[4] === undefined ? 1 : Number(srgb[4]) }
                }
                return null
              }
              const over = (fg: Rgba, bg: Rgba): Rgba => ({
                r: fg.r * fg.a + bg.r * (1 - fg.a),
                g: fg.g * fg.a + bg.g * (1 - fg.a),
                b: fg.b * fg.a + bg.b * (1 - fg.a),
                a: 1
              })
              const luminance = (c: Rgba): number => {
                const channel = (v: number): number => {
                  const n = v / 255
                  return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4)
                }
                return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
              }
              const format = (c: Rgba): string =>
                `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`

              /** Composite every translucent layer from the element up to the
               * first opaque background. */
              const effectiveBackground = (el: Element): Rgba => {
                const layers: Rgba[] = []
                let node: Element | null = el
                while (node && node !== document.documentElement) {
                  const layer = parse(getComputedStyle(node).backgroundColor)
                  if (layer && layer.a > 0) {
                    layers.push(layer)
                    if (layer.a >= 0.999) break
                  }
                  node = node.parentElement
                }
                let base: Rgba = { r: 255, g: 255, b: 255, a: 1 }
                const deepest = layers[layers.length - 1]
                if (deepest && deepest.a >= 0.999) {
                  base = deepest
                  layers.pop()
                }
                for (let i = layers.length - 1; i >= 0; i -= 1) {
                  const layer = layers[i]
                  if (layer) base = over(layer, base)
                }
                return base
              }

              const surfaces = new Set<string>()
              const worstOf = (selectors: string[]): { worst: WorstContrast | null, count: number } => {
                let worst: WorstContrast | null = null
                let count = 0
                for (const selector of selectors) {
                  for (const el of document.querySelectorAll(selector)) {
                    const style = getComputedStyle(el)
                    if (style.visibility === 'hidden' || style.display === 'none') continue
                    const raw = parse(style.color)
                    if (!raw) continue
                    const background = effectiveBackground(el)
                    const foreground = over(raw, background)
                    const l1 = luminance(foreground)
                    const l2 = luminance(background)
                    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
                    surfaces.add(format(background))
                    count += 1
                    if (!worst || ratio < worst.ratio) {
                      worst = { selector, color: style.color, background: format(background), ratio }
                    }
                  }
                }
                return { worst, count }
              }

              const primaryResult = worstOf(primary)
              const mutedResult = worstOf(muted)
              return {
                surfaces: [...surfaces],
                worstPrimary: primaryResult.worst,
                worstMuted: mutedResult.worst,
                measured: primaryResult.count + mutedResult.count,
                metadataLinks: document.querySelectorAll('.documentation-host-api-info a[href]').length
              }
            },
            { primary: CONTRAST_PRIMARY_SELECTORS, muted: CONTRAST_MUTED_SELECTORS }
          )
        )
      }
    } finally {
      if (originalTheme) await applyThemeAndWaitForRepaint(p, originalTheme)
    }

    // The sweep is only meaningful if the app really moved between theme
    // families — a run stuck on one palette would report the same ratios
    // fourteen times and pass without proving anything.
    const allSurfaces = new Set(results.flatMap((r) => r.surfaces))
    expect(
      allSurfaces.size,
      `the sweep should have repainted across theme families, saw only ${[...allSurfaces].join(', ')}`
    ).toBeGreaterThan(1)

    results.forEach((result, index) => {
      const themeId = themeIds[index]
      expect(result.measured, `doc panel should render text to measure on ${themeId}`).toBeGreaterThan(0)
      // The Petstore spec carries contact, licence, terms and externalDocs,
      // so the metadata block must render anchors — if it stops, this guard
      // would still pass on the outline alone and the links would drift back
      // to the user agent's blue unnoticed.
      expect(
        result.metadataLinks,
        `metadata links should be present to measure on ${themeId}`
      ).toBeGreaterThan(0)
      if (result.worstPrimary) {
        expect(
          result.worstPrimary.ratio,
          `${themeId}: ${result.worstPrimary.selector} renders ${result.worstPrimary.color} on ${result.worstPrimary.background}`
        ).toBeGreaterThanOrEqual(MIN_RATIO_PRIMARY)
      }
      if (result.worstMuted) {
        expect(
          result.worstMuted.ratio,
          `${themeId}: ${result.worstMuted.selector} renders ${result.worstMuted.color} on ${result.worstMuted.background}`
        ).toBeGreaterThanOrEqual(MIN_RATIO_MUTED)
      }
    })
  }
)

// ── Add request from docs ─────────────────────────────────────────────

When('I click the {string} button next to operation {string}', async ({}, _label: string, opSlug: string) => {
  const p = requirePage()
  const btn = p.locator(`[data-testid="documentation-host-route-header-add-${opSlug}"]`)
  await expect(btn).toBeVisible({ timeout: 10000 })
  await btn.scrollIntoViewIfNeeded()
  await btn.click()
  await p.waitForTimeout(800)
})

Then(
  'a request named {string} should appear inside the tag-folder {string}',
  async ({}, requestName: string, tagFolder: string) => {
    const p = requirePage()
    // The tag-folder lives inside the env folder. Expand it if
    // collapsed before checking for the new request row.
    const folderRow = sidebarRowByTitle(p, tagFolder)
    await expect(folderRow).toBeVisible({ timeout: 10000 })
    if ((await folderRow.getAttribute('aria-expanded')) !== 'true') {
      const expander = folderRow.locator('button.list-view-expander').first()
      if (await expander.count() > 0) await expander.click()
    }
    const requestRow = sidebarRowByTitle(p, requestName)
    await expect(requestRow).toBeVisible({ timeout: 10000 })
  }
)
