/**
 * Cookie Manager UI — end-to-end.
 *
 * A plain-Playwright spec (the auth-propagation precedent, not BDD) because the
 * surface under test is the modal itself, driven entirely through the renderer:
 * we seed the per-environment jar over the real `window.api.cookies` IPC, open
 * the manager from the always-visible View menu (it must be reachable SIGNED
 * OUT — cookies are a Community feature, so the modal cannot live behind the
 * account card), and assert on the grouped table.
 *
 * The jar itself (capture from a live Set-Cookie, per-env isolation, attribute
 * fidelity) is covered at the unit layer in
 * `tests/unit/services/CookieJarService.test.ts` and end-to-end over the wire by
 * the "Cookies are stored and re-sent across requests" scenario in the
 * http-execution suite. This spec owns the UI: reachability, rendering, and the
 * edit / delete / clear / per-environment-selector interactions.
 *
 * A native `page.screenshot()` of the populated manager is written to the test
 * output dir (and mirrored to a stable path) — it doubles as the design capture
 * for the feature.
 */
import { test, expect, type Page } from '@playwright/test'
import { join } from 'path'
import { mkdirSync, rmSync, copyFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { launchRestormElectronApp, writeAppLogs } from '../helpers/launch-restorm'

const MODAL = '[data-testid="cookie-jar"]'

/** Open the manager from the View menu, tolerating the responsive
 *  full / overflow / hamburger layouts (mirrors the settings-tab helper). */
async function openCookieManager(page: Page): Promise<void> {
  const cookiesItem = page.locator('[data-testid="titlebar-menu-item-cookies"]')
  await expect(async () => {
    const inBarView = page.locator('[data-testid="titlebar-menubar-item-view"]')
    if (await inBarView.isVisible().catch(() => false)) {
      await inBarView.click({ force: true })
    } else {
      const overflow = page
        .locator('[data-testid="titlebar-menubar-overflow-button"], [data-testid="titlebar-menubar-hamburger-button"]')
        .first()
      await overflow.click({ force: true })
      const viewEntry = page.locator('[data-testid="titlebar-menubar-item-view-overflow"]')
      await viewEntry.waitFor({ state: 'visible', timeout: 15000 })
      await viewEntry.hover()
      await viewEntry.click({ force: true })
    }
    await cookiesItem.waitFor({ state: 'visible', timeout: 5000 })
  }).toPass({ timeout: 45000 })
  await cookiesItem.click({ force: true })
  await expect(page.locator(MODAL)).toBeVisible({ timeout: 15000 })
}

/** Seed a realistic set of cookies into the default (No environment) jar. */
async function seedDefaultJar(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const add = (input: unknown): Promise<unknown> =>
      (window as unknown as { api: { cookies: { add: (k: string, i: unknown) => Promise<unknown> } } }).api.cookies.add('', input)
    const inSevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    await add({ key: 'session_id', value: 's3cr3t-a1b2c3d4', domain: 'api.example.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax', expires: inSevenDays })
    await add({ key: 'csrftoken', value: 'k9f2m1', domain: 'api.example.com', path: '/', secure: true })
    await add({ key: 'theme', value: 'dark', domain: 'app.example.com', path: '/' })
    await add({ key: 'cart', value: 'sku-42,sku-77', domain: 'shop.example.com', path: '/checkout' })
  })
}

test('Cookie Manager: reachable signed-out, renders the jar, edits and clears', async ({}, testInfo) => {
  const restormRoot = process.cwd()
  const userData = join(restormRoot, 'tests/e2e/.tmp/userdata', `cookies-${randomUUID()}`)
  mkdirSync(userData, { recursive: true })

  const app = await launchRestormElectronApp({
    restormRoot,
    extraEnv: { RESTORM_USER_DATA_OVERRIDE: userData }
  })

  try {
    const page: Page = await app.firstWindow()
    // Signed-out is the case that matters: the account card is NOT the home of
    // the manager, so it must open with no session at all.
    await expect(page.locator('[data-testid="titlebar-account-button"]')).toBeVisible({ timeout: 30000 })

    await seedDefaultJar(page)
    await openCookieManager(page)

    // The four seeded cookies land under three origin groups.
    await expect(page.locator('[data-testid="cookie-jar-group-api.example.com"]')).toBeVisible()
    await expect(page.locator('[data-testid="cookie-jar-group-app.example.com"]')).toBeVisible()
    await expect(page.locator('[data-testid="cookie-jar-group-shop.example.com"]')).toBeVisible()
    await expect(page.locator('[data-testid="cookie-row-api.example.com-/-session_id"]')).toBeVisible()

    // Flags render (Secure / HttpOnly on the session cookie).
    const flags = page.locator('[data-testid="cookie-row-api.example.com-/-session_id"] .cookie-jar-flag')
    await expect(flags.filter({ hasText: 'Secure' })).toBeVisible()
    await expect(flags.filter({ hasText: 'HttpOnly' })).toBeVisible()

    // Native capture of the populated manager (design shot + evidence).
    const shot = join(testInfo.outputDir, 'cookie-jar.png')
    await page.locator(MODAL).screenshot({ path: shot })
    copyFileSync(shot, join(restormRoot, 'tests/e2e/.tmp/cookie-jar.png'))

    // Live-refresh: a cookie added to the jar AFTER the panel is open appears
    // without reopening (the main process pushes `cookie:changed`).
    await page.evaluate(async () => {
      await (window as unknown as { api: { cookies: { add: (k: string, i: unknown) => Promise<unknown> } } }).api.cookies.add('', { key: 'live', value: '1', domain: 'live.example.com', path: '/' })
    })
    await expect(page.locator('[data-testid="cookie-jar-group-live.example.com"]')).toBeVisible({ timeout: 10000 })

    // Edit a value through the edit modal (the table value is read-only text
    // now — editing happens in the modal, opened by the per-row pencil).
    // ECUI InputBox forwards its data-testid to the inner <input> as `${id}-input`.
    await page.locator('[data-testid="cookie-edit-theme"]').click()
    const editValue = page.locator('[data-testid="cookie-add-modal-value-input"]')
    await expect(editValue).toBeVisible({ timeout: 10000 })
    await editValue.fill('solarized')
    await page.locator('[data-testid="cookie-add-modal-submit"]').click()
    // The modal closes and the edited value round-trips through the jar.
    await expect(page.locator('[data-testid="cookie-add-modal-domain-input"]')).toBeHidden({ timeout: 10000 })
    await expect
      .poll(async () =>
        page.evaluate(async () =>
          (await (window as unknown as { api: { cookies: { list: (k: string) => Promise<{ key: string; value: string }[]> } } }).api.cookies.list(''))
            .find((c) => c.key === 'theme')?.value
        )
      )
      .toBe('solarized')

    // Add a cookie by hand through the global "+" modal. The modal must open
    // FRESH (add mode — empty domain), not carrying the just-edited cookie.
    await page.locator('[data-testid="cookie-jar-add-global"]').click()
    const addDomain = page.locator('[data-testid="cookie-add-modal-domain-input"]')
    await expect(addDomain).toBeVisible({ timeout: 10000 })
    await expect(addDomain).toHaveValue('')
    await addDomain.fill('new.example.com')
    await page.locator('[data-testid="cookie-add-modal-name-input"]').fill('added')
    await page.locator('[data-testid="cookie-add-modal-value-input"]').fill('v1')
    await page.locator('[data-testid="cookie-add-modal-submit"]').click()
    await expect(page.locator('[data-testid="cookie-jar-group-new.example.com"]')).toBeVisible({ timeout: 10000 })
    // The add left the previously-edited cookie's origin untouched.
    await expect(page.locator('[data-testid="cookie-jar-group-app.example.com"]')).toBeVisible()

    // Delete one cookie — now behind a confirmation dialog.
    await page.locator('[data-testid="cookie-delete-csrftoken"]').click()
    await page.locator('[data-testid="cookie-jar-confirm-ok"]').click()
    await expect(page.locator('[data-testid="cookie-row-api.example.com-/-csrftoken"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="cookie-row-api.example.com-/-session_id"]')).toBeVisible()

    // Clear a whole origin — confirmation dialog.
    await page.locator('[data-testid="cookie-jar-clear-origin-shop.example.com"]').click()
    await page.locator('[data-testid="cookie-jar-confirm-ok"]').click()
    await expect(page.locator('[data-testid="cookie-jar-group-shop.example.com"]')).toHaveCount(0)

    // Clear the whole jar — confirmation → empty state.
    await page.locator('[data-testid="cookie-jar-clear-all"]').click()
    await page.locator('[data-testid="cookie-jar-confirm-ok"]').click()
    await expect(page.locator('[data-testid="cookie-jar-empty"]')).toBeVisible()
  } finally {
    writeAppLogs(app, testInfo.outputDir)
    await app.close().catch(() => undefined)
    rmSync(userData, { recursive: true, force: true })
  }
})
