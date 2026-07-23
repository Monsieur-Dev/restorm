import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/settings-tab.fixture'

// "Given no file is open" and "When I open Settings from the gear button"
// are already registered by settings-tab.steps.ts (see playwright.config.ts
// for this suite's step glob) — reused as-is rather than duplicated here.

const bdd = createBdd(test)
const { When, Then } = bdd

interface TabStopInfo {
  /** The focused element carries the card's own class — i.e. it IS the tile button. */
  hasCardClass: boolean
  /** The focused element lives inside the abstract preview — the bug this suite guards against. */
  insidePreview: boolean
}

// Bridges the When/Then steps of the same scenario, mirroring the
// `capturedColors`-style module-level state used elsewhere in this suite.
let tabStops: TabStopInfo[] = []

When('I tab through every theme card in the carousel', async ({ page }) => {
  const carousel = page.locator('[data-testid="theme-carousel"]')
  await expect(carousel).toBeVisible({ timeout: 5000 })
  await carousel.scrollIntoViewIfNeeded()

  const themeCountAttr = await carousel.getAttribute('data-theme-count')
  const themeCount = Number(themeCountAttr)
  if (!Number.isFinite(themeCount) || themeCount <= 0) {
    throw new Error(`theme-carousel reported an invalid data-theme-count: "${String(themeCountAttr)}"`)
  }

  // Land on the first card the way a real Tab sequence would arrive at it
  // from outside the carousel, then walk the rest with the keyboard —
  // that's exactly the traversal a focusable preview control would hijack.
  await carousel.locator('.theme-carousel-item').first().focus()

  tabStops = []
  for (let i = 0; i < themeCount; i += 1) {
    const stop = await page.evaluate((): TabStopInfo => {
      const el = document.activeElement as HTMLElement | null
      return {
        hasCardClass: el?.classList.contains('theme-carousel-item') ?? false,
        insidePreview: el?.closest('.theme-carousel-item-preview') !== null
      }
    })
    tabStops.push(stop)
    if (i < themeCount - 1) await page.keyboard.press('Tab')
  }
})

Then('every tab stop should have been the theme card button, never a preview control', () => {
  expect(tabStops.length).toBeGreaterThan(0)
  for (const stop of tabStops) {
    expect(stop.hasCardClass).toBe(true)
    expect(stop.insidePreview).toBe(false)
  }
})
