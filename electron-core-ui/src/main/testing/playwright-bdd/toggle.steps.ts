import {
  toggleActionSelector,
  toggleLabelSelector,
  toggleRootSelector
} from '../toggleSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface FocusRingProbe {
  matchesFocusVisible: boolean
  outlineStyle: string
  outlineWidth: string
  outlineColor: string
  outlineOffset: string
  focusBorder: string
  unresolvedToken: string
}

interface LocatorLike {
  click: (options?: { force?: boolean }) => Promise<void>
  focus: () => Promise<void>
  getAttribute: (name: string) => Promise<string | null>
  press: (key: string) => Promise<void>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
  evaluate: <T>(fn: (el: Element) => T) => Promise<T>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
  keyboard: { press: (key: string) => Promise<void> }
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

export function defineToggleBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('toggle {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toggle id')
    await asPage(page).locator(toggleRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('toggle {string} should be checked', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toggle id')
    const attr = await asPage(page).locator(toggleActionSelector(testId)).getAttribute('aria-checked')
    if ((attr ?? '') !== 'true') throw new Error(`Expected toggle "${testId}" to be checked`)
  })

  Then('toggle {string} should be unchecked', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toggle id')
    const attr = await asPage(page).locator(toggleActionSelector(testId)).getAttribute('aria-checked')
    if ((attr ?? '') !== 'false') throw new Error(`Expected toggle "${testId}" to be unchecked`)
  })

  Then('toggle {string} should be indeterminate', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toggle id')
    const attr = await asPage(page).locator(toggleActionSelector(testId)).getAttribute('aria-checked')
    if ((attr ?? '') !== 'mixed') throw new Error(`Expected toggle "${testId}" to be indeterminate (aria-checked="mixed")`)
  })

  Then('toggle {string} should be disabled', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toggle id')
    const attr = await asPage(page).locator(toggleActionSelector(testId)).getAttribute('aria-disabled')
    if ((attr ?? '') !== 'true') throw new Error(`Expected toggle "${testId}" to be disabled`)
  })

  When('I click toggle {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toggle id')
    await asPage(page).locator(toggleActionSelector(testId)).click({ force: true })
  })

  When('I click toggle {string} label', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toggle id')
    await asPage(page).locator(toggleLabelSelector(testId)).click({ force: true })
  })

  When('I press {string} on toggle {string}', async ({ page }, key: unknown, testId: unknown) => {
    if (typeof key !== 'string' || typeof testId !== 'string') throw new Error('Invalid toggle parameters')
    const action = asPage(page).locator(toggleActionSelector(testId))
    await action.focus()
    await action.press(key)
  })

  Then('toggle {string} should show a keyboard focus ring', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toggle id')
    const p = asPage(page)
    const action = p.locator(toggleActionSelector(testId))
    await action.waitFor({ state: 'attached', timeout: 5000 })

    // Arm the browser's keyboard focus modality first: the ring is drawn under
    // `:focus-visible`, which the engine only applies to a programmatically
    // focused element when the most recent user input came from the keyboard —
    // exactly the state after a real Tab lands on the control. A press anywhere
    // sets that flag; the subsequent `.focus()` then matches `:focus-visible`.
    await p.keyboard.press('Tab')

    const probe = await action.evaluate((el: Element): FocusRingProbe => {
      ;(el as HTMLElement).focus()
      const style = getComputedStyle(el)
      // Resolve `--focusBorder` to the same computed rgb() form the outline
      // colour is reported in, off a throwaway child so it inherits the active
      // theme's variable value from this element's own cascade.
      const marker = document.createElement('span')
      marker.style.color = 'var(--focusBorder)'
      el.appendChild(marker)
      const focusBorder = getComputedStyle(marker).color
      // Negative control: what an UNRESOLVED custom property looks like on this
      // same element, in this same cascade. If `--focusBorder` were ever
      // undefined, `focusBorder` above would fall back to exactly this value —
      // and so would the outline colour — so the two could match each other
      // while the ring was in fact untokenised. Comparing against the control
      // detects that directly, without assuming how the token relates to the
      // element's own foreground (a theme is free to make them equal).
      marker.style.color = 'var(--ecu-unresolved-token-control)'
      const unresolvedToken = getComputedStyle(marker).color
      marker.remove()
      return {
        matchesFocusVisible: el.matches(':focus-visible'),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
        outlineOffset: style.outlineOffset,
        focusBorder,
        unresolvedToken
      }
    })

    if (!probe.matchesFocusVisible) {
      throw new Error(`Expected toggle "${testId}" to match :focus-visible after keyboard focus`)
    }
    if (probe.outlineStyle === 'none' || Number.parseFloat(probe.outlineWidth) === 0) {
      throw new Error(
        `Expected toggle "${testId}" to draw a focus outline (got outline-style="${probe.outlineStyle}", outline-width="${probe.outlineWidth}")`
      )
    }
    if (probe.focusBorder === probe.unresolvedToken) {
      throw new Error(
        `--focusBorder did not resolve for toggle "${testId}" (got "${probe.focusBorder}", identical to an undefined custom property). The colour assertion below would pass vacuously; the active theme is missing the token.`
      )
    }
    if (probe.outlineColor !== probe.focusBorder) {
      throw new Error(
        `Expected toggle "${testId}" focus outline to use var(--focusBorder) (${probe.focusBorder}); got "${probe.outlineColor}"`
      )
    }
    // A non-positive offset is exactly the invisible state this ring exists to
    // fix: the workbench-wide `:focus` rule draws its 1px ring INSET (-1px),
    // where the toggle's own 1px border and 3px radius swallow it. Style +
    // colour alone would still pass against that ring, so the offset is the
    // assertion that actually pins the fix.
    if (!(Number.parseFloat(probe.outlineOffset) > 0)) {
      throw new Error(
        `Expected toggle "${testId}" focus ring to sit outside the box (positive outline-offset); got "${probe.outlineOffset}"`
      )
    }
  })

  // The negative counterpart, for appearances that deliberately opt OUT of a
  // focus ring. Their opt-out competes with the host's global focus rule, and
  // a suppression that merely TIES that rule's specificity is decided by
  // stylesheet order — so it can be undone silently by a bundling change, with
  // no source edit to blame. Asserting the absence here turns that reordering
  // into a red build instead of a ring that quietly reappears.
  Then('toggle {string} should NOT show a keyboard focus ring', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toggle id')
    const p = asPage(page)
    const action = p.locator(toggleActionSelector(testId))
    await action.waitFor({ state: 'attached', timeout: 5000 })

    // Same keyboard modality arming as the positive step: without it the
    // element would not match `:focus-visible` at all, and the assertion
    // would pass for the wrong reason — never having been keyboard-focused.
    await p.keyboard.press('Tab')

    const probe = await action.evaluate((el: Element) => {
      ;(el as HTMLElement).focus()
      const style = getComputedStyle(el)
      return {
        matchesFocusVisible: el.matches(':focus-visible'),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth
      }
    })

    // Guard the guard: if the element never reached keyboard-focus, "no ring"
    // is vacuous. Only a control that IS focus-visible and STILL draws nothing
    // proves the opt-out holds.
    if (!probe.matchesFocusVisible) {
      throw new Error(
        `Expected toggle "${testId}" to match :focus-visible after keyboard focus — without it, asserting the absence of a ring proves nothing`
      )
    }
    if (probe.outlineStyle !== 'none' && Number.parseFloat(probe.outlineWidth) > 0) {
      throw new Error(
        `Expected toggle "${testId}" to draw NO focus ring, but got outline-style="${probe.outlineStyle}" outline-width="${probe.outlineWidth}". A specificity tie with the host's global focus rule is the usual cause — it is resolved by stylesheet order, so a bundling change can reintroduce the ring.`
      )
    }
  })
}
