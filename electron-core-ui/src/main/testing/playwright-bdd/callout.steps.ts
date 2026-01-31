import {
  calloutMessageSelector,
  calloutTestIdSelector
} from '../calloutSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  innerText: () => Promise<string>
  getAttribute: (name: string) => Promise<string | null>
  count: () => Promise<number>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

export function defineCalloutBddSteps({ Then }: BddFnsWithPage): void {
  Then('callout {string} should have variant {string}', async ({ page }, testId: unknown, expectedVariant: unknown) => {
    if (typeof testId !== 'string' || typeof expectedVariant !== 'string') {
      throw new Error('Invalid parameters for callout variant assertion')
    }

    const p = asPage(page)
    const root = p.locator(calloutTestIdSelector(testId))
    await root.waitFor({ state: 'visible', timeout: 5000 })
    const value = await root.getAttribute('data-variant')
    if (value !== expectedVariant) {
      throw new Error(`Expected callout "${testId}" data-variant="${expectedVariant}", but got ${String(value)}`)
    }
  })

  Then('callout {string} message should be {string}', async ({ page }, testId: unknown, expectedMessage: unknown) => {
    if (typeof testId !== 'string' || typeof expectedMessage !== 'string') {
      throw new Error('Invalid parameters for callout message assertion')
    }

    const p = asPage(page)
    const locator = p.locator(calloutMessageSelector(testId))
    await locator.waitFor({ state: 'visible', timeout: 5000 })
    const text = await locator.innerText()
    if (text.trim() !== expectedMessage) {
      throw new Error(`Expected callout "${testId}" message="${expectedMessage}", but got "${text}"`)
    }
  })

  Then('callout {string} icon should be {string}', async ({ page }, testId: unknown, expectedIcon: unknown) => {
    if (typeof testId !== 'string' || typeof expectedIcon !== 'string') {
      throw new Error('Invalid parameters for callout icon assertion')
    }

    const p = asPage(page)
    const root = p.locator(calloutTestIdSelector(testId))
    await root.waitFor({ state: 'visible', timeout: 5000 })

    const icon = await root.getAttribute('data-icon')
    if (icon !== null) {
      if (icon !== expectedIcon) {
        throw new Error(`Expected callout "${testId}" data-icon="${expectedIcon}", but got "${icon}"`)
      }
      return
    }

    // Fallback: check codicon class if data-icon is not available.
    const count = await p.locator(`${calloutTestIdSelector(testId)} .codicon-${expectedIcon}`).count()
    if (count <= 0) {
      throw new Error(`Expected callout "${testId}" to contain codicon "${expectedIcon}", but none was found.`)
    }
  })
}
