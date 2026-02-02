import { createBdd } from 'playwright-bdd'
import type { Page } from '@playwright/test'
import {
  defineContextMenuBddSteps,
  defineSashBddSteps,
  defineWorkbenchBddSteps
} from 'electron-core-ui/testing/playwright-bdd'
import { openWorkbenchE2ETab } from '../fixtures/workbench.fixture'

const bdd = createBdd()
const { Given, When, Then } = bdd

defineWorkbenchBddSteps(bdd)
defineContextMenuBddSteps(bdd)
defineSashBddSteps(bdd)

let auxPage: Page | null = null

Given('I open the workbench e2e tab', async ({ page }) => {
  auxPage = null
  await openWorkbenchE2ETab(page)
  await page.getByTestId('editorworkbench-ipc-mode-inside').click()
})

Then('editor workbench last event should contain {string}', async ({ page }, expected: string) => {
  const start = Date.now()
  const timeoutMs = 5000
  for (;;) {
    const text = await page.getByTestId('editorworkbench-last-event').innerText()
    if (text.includes(expected)) return
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Expected last event to contain "${expected}", got "${text}"`)
    }
    await page.waitForTimeout(50)
  }
})

Then(
  'workbench tree for group {string} should have tab {string} before {string}',
  async ({ page }, groupId: string, tabA: string, tabB: string) => {
    const raw = await page.getByTestId('editorworkbench-tree-json').innerText()
    const tree = JSON.parse(raw) as { groups?: unknown[] }
    const groups = Array.isArray(tree.groups) ? tree.groups : []
    const group = groups.find((g) => (g as { id?: unknown }).id === groupId) as { tabs?: unknown[] } | undefined
    if (!group) throw new Error(`Group "${groupId}" not found in tree`)
    const tabs = Array.isArray(group.tabs) ? group.tabs : []
    const ids = tabs.map((t) => {
      const id = (t as { id?: unknown }).id
      return (typeof id === 'string') ? id : ''
    })
    const ia = ids.indexOf(tabA)
    const ib = ids.indexOf(tabB)
    if (ia < 0 || ib < 0) {
      throw new Error(`Expected tabs "${tabA}" and "${tabB}" to exist in group "${groupId}", got [${ids.join(', ')}]`)
    }
    if (ia >= ib) {
      throw new Error(`Expected "${tabA}" to be before "${tabB}" in group "${groupId}", got [${ids.join(', ')}]`)
    }
  }
)

When('I reload the page and reopen the workbench e2e tab', async ({ page }) => {
  await page.reload()
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="editorworkbench-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
})

When('I open the workbench aux window', async ({ page }) => {
  const popupPromise = page.waitForEvent('popup')
  await page.getByTestId('editorworkbench-open-aux-window').click()
  auxPage = await popupPromise
  await auxPage.waitForSelector('[data-testid="aux-ready"]', { state: 'attached' })
})

When('I set workbench ipc mode to {string}', async ({ page }, mode: string) => {
  if (mode !== 'inside' && mode !== 'create' && mode !== 'send') {
    throw new Error('Invalid ipc mode')
  }
  await page.getByTestId(`editorworkbench-ipc-mode-${mode}`).click()
  await page.waitForFunction((m) => {
    const el = document.querySelector('[data-testid="editorworkbench-ipc-mode"]')
    return (el?.textContent ?? '').trim() === m
  }, mode)
})

Then('aux window should show dropped tab id {string}', async ({}, expected: string) => {
  if (!auxPage) {
    throw new Error('Aux window is not open')
  }
  const start = Date.now()
  const timeoutMs = 5000
  for (;;) {
    const text = await auxPage.getByTestId('aux-last-dropped-tab-id').innerText()
    if (text.trim() === expected) return
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Expected aux dropped tab id="${expected}", got "${text}"`)
    }
    await auxPage.waitForTimeout(50)
  }
})

export {}
