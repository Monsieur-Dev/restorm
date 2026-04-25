import { createBdd } from 'playwright-bdd'
import { join } from 'path'
import { writeFileSync, mkdirSync } from 'fs'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  test,
  expect,
  AUTH_DEBUG_TEMP_DIR,
  configureNextSaveFileDialogForE2E
} from '../../fixtures/auth-modal-debug.fixture'

const SINGLE_FILE = join(AUTH_DEBUG_TEMP_DIR, 'auth-debug.restorm')

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null

Given('a new single-file YAML collection for auth debug', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  await configureNextSaveFileDialogForE2E(electronApp, { kind: 'saveFile', path: SINGLE_FILE })

  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(page.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  const modal = page.locator('[data-testid="save-options-modal"]')
  await expect(modal).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="save-mode-file"]').click()
  await page.locator('[data-testid="save-format-yaml"]').click()
  await page.locator('[data-testid="save-confirm-button"]').click()
  await expect(modal).not.toBeVisible({ timeout: 2000 })
  await page.waitForTimeout(500)
})

When('I open the import modal and click Add authentication route', async () => {
  if (!page) throw new Error('app must be launched')
  await page.keyboard.press('Control+I')
  const importModal = page.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="import-add-auth-button"]').click()
  const authModal = page.locator('[data-testid="authentication-setup-modal"]')
  await expect(authModal).toBeVisible({ timeout: 2000 })
})

When('I shrink the window to {int}x{int}', async ({}, width: number, height: number) => {
  if (!page) throw new Error('app must be launched')
  await page.setViewportSize({ width, height })
  // Give React + the ResizeObserver chain a couple of frames to settle.
  await page.waitForTimeout(400)
})

Then('the auth setup modal content fits inside the modal frame', async () => {
  if (!page) throw new Error('app must be launched')

  const authModal = page.locator('[data-testid="authentication-setup-modal"]')
  await expect(authModal).toBeVisible({ timeout: 2000 })

  // Per-element bounding boxes, compared against the modal bottom.
  mkdirSync(AUTH_DEBUG_TEMP_DIR, { recursive: true })

  const diagnostics = await page.evaluate(() => {
    const byTestId = (id: string): DOMRect | null => {
      const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
      return el ? el.getBoundingClientRect() : null
    }
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      modal: byTestId('authentication-setup-modal'),
      urlSection: byTestId('local-auth-form-url-section'),
      requestTabs: byTestId('base-request-tabs-request'),
      responseTabs: byTestId('base-request-tabs-response'),
      headersPane: byTestId('local-auth-form-headers-pane'),
      bodyPane: byTestId('local-auth-form-body-pane'),
      requestScroll: byTestId('local-auth-form-request-scroll'),
      configScroll: byTestId('local-auth-form-configuration-scroll'),
      producedHeadersTable: byTestId('local-auth-form-produced-headers-table'),
      cancelButton: byTestId('authentication-setup-cancel')
    }
  })

  const jsonPath = join(AUTH_DEBUG_TEMP_DIR, 'auth-modal-diagnostics.json')
  writeFileSync(jsonPath, JSON.stringify(diagnostics, null, 2), 'utf-8')

  const modal = diagnostics.modal
  expect(modal, 'modal should be measurable').toBeTruthy()
  if (!modal) return

  const overflowing: { name: string; bottom: number; modalBottom: number }[] = []
  const checkBottom = (name: string, rect: DOMRect | null): void => {
    if (!rect) return
    if (rect.bottom > modal.bottom + 1) {
      overflowing.push({ name, bottom: rect.bottom, modalBottom: modal.bottom })
    }
  }
  // Only check the chrome elements that MUST fit in the modal (scroll
  // wrappers, footer buttons, tab bars). The SplitView + the KV table
  // live inside the request/config ScrollableElements — their natural
  // height can legitimately exceed the modal because the scroll area
  // clips them.
  checkBottom('requestTabs', diagnostics.requestTabs)
  checkBottom('responseTabs', diagnostics.responseTabs)
  checkBottom('requestScroll', diagnostics.requestScroll)
  checkBottom('configScroll', diagnostics.configScroll)
  checkBottom('cancelButton', diagnostics.cancelButton)
  // headersPane / bodyPane are INSIDE requestScroll — they may be
  // taller than the modal (natural height), scroll handles it.

  expect(overflowing, `elements overflow modal bottom: ${JSON.stringify(overflowing)}`).toEqual([])
})
