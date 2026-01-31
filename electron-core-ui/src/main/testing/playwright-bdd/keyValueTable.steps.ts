import { inputBoxInputSelector } from '../inputBoxSelectors'
import {
  keyValueTableRootSelector,
  keyValueTableRowDeleteSelector,
  keyValueTableRowEnabledToggleSelector
} from '../keyValueTableSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { force?: boolean; button?: 'left' | 'right' }) => Promise<void>
  fill: (value: string) => Promise<void>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

function cellId(tableId: string, rowId: string, column: 'key' | 'value' | 'description'): string {
  return `${tableId}-row-${rowId}-${column}`
}

export function defineKeyValueTableBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('key value table {string} should be visible', async ({ page }, tableId: unknown) => {
    if (typeof tableId !== 'string') throw new Error('Invalid key value table id')
    await asPage(page).locator(keyValueTableRootSelector(tableId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  When('I set key value table {string} row {string} key to {string}', async ({ page }, tableId: unknown, rowId: unknown, value: unknown) => {
    if (typeof tableId !== 'string' || typeof rowId !== 'string' || typeof value !== 'string') {
      throw new Error('Invalid key value table key parameters')
    }
    await asPage(page).locator(inputBoxInputSelector(cellId(tableId, rowId, 'key'))).fill(value)
  })

  When('I set key value table {string} row {string} value to {string}', async ({ page }, tableId: unknown, rowId: unknown, value: unknown) => {
    if (typeof tableId !== 'string' || typeof rowId !== 'string' || typeof value !== 'string') {
      throw new Error('Invalid key value table value parameters')
    }
    await asPage(page).locator(inputBoxInputSelector(cellId(tableId, rowId, 'value'))).fill(value)
  })

  When('I set key value table {string} row {string} description to {string}', async ({ page }, tableId: unknown, rowId: unknown, value: unknown) => {
    if (typeof tableId !== 'string' || typeof rowId !== 'string' || typeof value !== 'string') {
      throw new Error('Invalid key value table description parameters')
    }
    await asPage(page).locator(inputBoxInputSelector(cellId(tableId, rowId, 'description'))).fill(value)
  })

  When('I toggle key value table {string} row {string} enabled', async ({ page }, tableId: unknown, rowId: unknown) => {
    if (typeof tableId !== 'string' || typeof rowId !== 'string') throw new Error('Invalid key value table toggle parameters')
    await asPage(page).locator(keyValueTableRowEnabledToggleSelector(tableId, rowId)).click({ force: true })
  })

  When('I delete key value table {string} row {string}', async ({ page }, tableId: unknown, rowId: unknown) => {
    if (typeof tableId !== 'string' || typeof rowId !== 'string') throw new Error('Invalid key value table delete parameters')
    await asPage(page).locator(keyValueTableRowDeleteSelector(tableId, rowId)).click({ force: true })
  })
}
