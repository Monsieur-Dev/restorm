import {
  settingsPageLanguageSelectBoxTestId,
  settingsPageRootSelector,
  settingsPageThemeCarouselTestId,
  themeCarouselRootSelector
} from '../settingsSelectors'
import { selectBoxRootSelector } from '../selectBoxSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  getAttribute: (name: string) => Promise<string | null>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

export function defineSettingsBddSteps({ Then }: BddFnsWithPage): void {
  Then('settings page {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid settings page id')
    await asPage(page).locator(settingsPageRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('settings page {string} language should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid settings page parameters')
    const locator = asPage(page).locator(settingsPageRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    const actual = await locator.getAttribute('data-language')
    if ((actual ?? '') !== expected) {
      throw new Error(`Expected settings page "${testId}" data-language="${expected}", got "${actual ?? ''}"`)
    }
  })

  Then('settings page {string} language select box should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid settings page id')
    const selectBoxTestId = settingsPageLanguageSelectBoxTestId(testId)
    await asPage(page).locator(selectBoxRootSelector(selectBoxTestId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('settings page {string} theme carousel should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid settings page id')
    const carouselTestId = settingsPageThemeCarouselTestId(testId)
    await asPage(page).locator(themeCarouselRootSelector(carouselTestId)).waitFor({ state: 'attached', timeout: 5000 })
  })
}
