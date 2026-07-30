import { createBdd } from 'playwright-bdd'
import type { Page } from '@playwright/test'
import { test, expect } from '../../fixtures/firewall-outbound.fixture'

const bdd = createBdd(test)
const { Given, When, Then } = bdd

/** The Firewall workbench tab is a singleton with this stable id. */
const FIREWALL_TAB_CONTENT = '[data-testid="firewall-panel"]'
const OUTBOUND_SECTION = '[data-testid="firewall-outbound"]'

/** Consent gate id → the settings storage key backing it. Mirrors
 * `src/shared/config/observability.ts` — kept as a literal here so the E2E
 * asserts against the CONTRACT rather than re-importing the implementation. */
const CONSENT_SETTING_KEYS: Record<string, string> = {
  crash: 'privacy:crashReports',
  telemetry: 'privacy:telemetry'
}

interface SystemEndpointStatusLike {
  id: string
  host: string | null
  consentGate: string | null
  exemption: string
  active: boolean
}

/** Read the main-process truth: what the firewall actually considers exempt,
 * independent of what the panel happens to be rendering. */
async function readEndpoints(page: Page): Promise<SystemEndpointStatusLike[]> {
  return await page.evaluate(async () => {
    const w = window as unknown as {
      api?: { firewall?: { listSystemEndpoints?: () => Promise<SystemEndpointStatusLike[]> } }
    }
    const fn = w.api?.firewall?.listSystemEndpoints
    if (typeof fn !== 'function') throw new Error('window.api.firewall.listSystemEndpoints is not available')
    return await fn()
  })
}

/**
 * The firewall's system allowlist — the ACTUAL input to the permission check,
 * read from main rather than derived from the rows the panel renders. Asserting
 * on this rather than on `SystemEndpointStatus.active` is what makes the
 * exemption steps prove enforcement instead of restating presentation.
 *
 * (The verdict itself — allowlisted ⇒ `allow`, otherwise `prompt` — is asserted
 * in `PermissionService.test.ts`; it cannot be observed from here because the
 * E2E harness short-circuits the firewall to `allow` so tests against ephemeral
 * mock-server ports don't deadlock on a toast.)
 */
async function readExemptedHosts(page: Page): Promise<string[]> {
  return await page.evaluate(async () => {
    const w = window as unknown as {
      api?: { firewall?: { listSystemAllowedHosts?: () => Promise<string[]> } }
    }
    const fn = w.api?.firewall?.listSystemAllowedHosts
    if (typeof fn !== 'function') throw new Error('window.api.firewall.listSystemAllowedHosts is not available')
    return await fn()
  })
}

async function setConsent(page: Page, gate: string, granted: boolean): Promise<void> {
  const key = CONSENT_SETTING_KEYS[gate]
  if (key === undefined) throw new Error(`Unknown consent gate "${gate}"`)
  await page.evaluate(async ({ storageKey, value }) => {
    const w = window as unknown as {
      api?: { settings?: { set?: (k: string, v: boolean) => Promise<boolean> } }
    }
    const fn = w.api?.settings?.set
    if (typeof fn !== 'function') throw new Error('window.api.settings.set is not available')
    await fn(storageKey, value)
  }, { storageKey: key, value: granted })
  // The setting change fans out main-side (consent → firewall exemption →
  // renderer push); poll the panel rather than sleeping a fixed amount.
  await expect
    .poll(async () => (await readEndpoints(page)).find((e) => e.id === gate)?.active, { timeout: 10000 })
    .toBe(granted)
}

Given('the Firewall tab is open', async ({ page }) => {
  const menubarTestId = 'titlebar-menubar'
  const firewallItem = page.locator('[data-testid="titlebar-menu-item-firewall"]')
  const MENU_TIMEOUT = 15000

  // The responsive MenuBar lays out in `full`, `overflow` or `hamburger` mode
  // depending on width; drive whichever path matches so the test is
  // layout-agnostic (same approach as the settings-tab suite).
  const mode = await page.locator(`[data-testid="${menubarTestId}"]`).getAttribute('data-mode')
  if (mode === 'full') {
    await page.locator('[data-testid="titlebar-menubar-item-view"]').click({ force: true })
  } else {
    const overflowBtn = page
      .locator(`[data-testid="${menubarTestId}-overflow-button"], [data-testid="${menubarTestId}-hamburger-button"]`)
      .first()
    await overflowBtn.click({ force: true })
    const viewEntry = page.locator('[data-testid="titlebar-menubar-item-view-overflow"]')
    await viewEntry.waitFor({ state: 'visible', timeout: MENU_TIMEOUT })
    await viewEntry.hover()
    await viewEntry.click({ force: true })
  }
  await firewallItem.waitFor({ state: 'visible', timeout: MENU_TIMEOUT })
  await firewallItem.click({ force: true })
  await expect(page.locator(FIREWALL_TAB_CONTENT)).toBeVisible({ timeout: 15000 })
})

// The Given forms are worded in the past ("has been") so playwright-bdd can tell
// them apart from the When forms — an identical expression on both would match
// twice and fail generation.
Given('consent for {string} has been granted', async ({ page }, gate: string) => {
  await setConsent(page, gate, true)
})

Given('consent for {string} has been withdrawn', async ({ page }, gate: string) => {
  await setConsent(page, gate, false)
})

When('consent for {string} is granted', async ({ page }, gate: string) => {
  await setConsent(page, gate, true)
})

When('consent for {string} is withdrawn', async ({ page }, gate: string) => {
  await setConsent(page, gate, false)
})

Then('the outbound services section should be visible', async ({ page }) => {
  await expect(page.locator(OUTBOUND_SECTION)).toBeVisible({ timeout: 10000 })
})

Then('the outbound services section should list {string}', async ({ page }, id: string) => {
  const row = page.locator(`[data-testid="firewall-outbound-row-${id}"]`)
  await expect(row).toBeVisible({ timeout: 10000 })
  // The row must name the destination, not just exist.
  const host = await page.locator(`[data-testid="firewall-outbound-host-${id}"]`).innerText()
  expect(host.trim().length).toBeGreaterThan(0)
})

Then('the outbound endpoint {string} should be active', async ({ page }, id: string) => {
  await expect(page.locator(`[data-testid="firewall-outbound-state-${id}"]`))
    .toHaveAttribute('data-active', 'true', { timeout: 10000 })
})

Then('the outbound endpoint {string} should be inactive', async ({ page }, id: string) => {
  await expect(page.locator(`[data-testid="firewall-outbound-state-${id}"]`))
    .toHaveAttribute('data-active', 'false', { timeout: 10000 })
})

Then('the outbound endpoint {string} should be exempted from the firewall', async ({ page }, id: string) => {
  const endpoints = await readEndpoints(page)
  const endpoint = endpoints.find((e) => e.id === id)
  expect(endpoint, `endpoint "${id}" is not declared`).toBeDefined()
  expect(await readExemptedHosts(page)).toContain(endpoint?.host)
})

Then('the outbound endpoint {string} should not be exempted from the firewall', async ({ page }, id: string) => {
  const endpoints = await readEndpoints(page)
  const endpoint = endpoints.find((e) => e.id === id)
  expect(endpoint, `endpoint "${id}" is not declared`).toBeDefined()
  expect(await readExemptedHosts(page)).not.toContain(endpoint?.host)
})

Then('the outbound endpoint {string} should carry no consent gate', async ({ page }, id: string) => {
  const endpoint = (await readEndpoints(page)).find((e) => e.id === id)
  expect(endpoint?.consentGate).toBeNull()
  // It reaches the backend through a call-scoped bypass, so it must NOT be
  // sitting in the allowlist — the licensing host is exempt for the guarded
  // fetch only, not for anything else that happens to target it.
  expect(endpoint?.exemption).toBe('call-scoped-bypass')
  expect(await readExemptedHosts(page)).not.toContain(endpoint?.host)
})
