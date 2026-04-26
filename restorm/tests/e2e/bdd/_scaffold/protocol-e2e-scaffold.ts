/**
 * Reusable BDD-step scaffold for new execution protocols.
 *
 * Wires the generic scenarios from `Section 7` of
 * `restorm/docs/contributing/adding-a-protocol.md`:
 *
 * - Scenario: "Run a request and see the response panel"
 * - Scenario: "Run multiple requests and inspect history"
 * - Scenario: "Env variable / Handlebars substitution" (mandatory, Section 3)
 * - Scenario: "Inputs are debounced" (mandatory, Section 4)
 * - Scenario: "Cancellation"
 *
 * Each protocol's BDD step bootstrap calls
 * `defineProtocolE2EScaffoldSteps()` once, passing the test-id
 * conventions and a small set of accessors for protocol-specific
 * instrumentation (event-bus counter, in-flight cancel button).
 *
 * IMPORTANT: this file is NOT auto-wired into any test project. Each
 * protocol opts in by:
 *   1. adding a new `defineBddConfig` block in
 *      `restorm/playwright.config.ts`,
 *   2. importing this scaffold from its protocol-specific steps file,
 *   3. providing the `data-testid` values its tab view exposes.
 *
 * The scaffold is intentionally narrow — it owns the cross-protocol
 * checkpoints (debounce, response-panel skeleton, history navigation)
 * and leaves protocol-specific behaviour to the per-protocol step file.
 */

export interface BddFnsWithPage {
  Given: (pattern: string | RegExp, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string | RegExp, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string | RegExp, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { force?: boolean }) => Promise<void>
  count: () => Promise<number>
  fill: (value: string) => Promise<void>
  focus: () => Promise<void>
  innerText: () => Promise<string>
  press: (key: string, options?: { delay?: number }) => Promise<void>
  type: (text: string, options?: { delay?: number }) => Promise<void>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

export interface PageLike {
  keyboard: { press: (key: string) => Promise<void> }
  locator: (selector: string) => LocatorLike
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function testIdSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * Configuration the protocol must provide to wire the scaffold.
 *
 * `data-testid` values follow the convention from Section 8 of the
 * playbook. If the protocol uses different ids, override them here —
 * but prefer the convention so the rest of the codebase can rely on it.
 */
export interface ProtocolScaffoldConfig {
  /** `data-testid` of the URL / primary keyword input field. */
  readonly urlInputTestId: string
  /** `data-testid` of the "send / run request" button. */
  readonly runButtonTestId: string
  /** `data-testid` of the "cancel" button (visible during in-flight calls). */
  readonly cancelButtonTestId: string
  /** `data-testid` of the response panel root. */
  readonly responsePanelTestId: string
  /** `data-testid` of the response status / statusText element. */
  readonly responseStatusTestId: string
  /** `data-testid` of the response duration element. */
  readonly responseDurationTestId: string
  /** `data-testid` of the response body element. */
  readonly responseBodyTestId: string
  /** `data-testid` of the statusbar history-count badge. */
  readonly historyCountTestId: string
  /**
   * Reset the document-update counter. The scaffold's debounce
   * assertion calls this before typing so the count reflects only the
   * current burst.
   *
   * Implementation notes (per protocol):
   *   - Subscribe to your protocol's `document:request:updated` event
   *     in a renderer-side e2e shim (e.g.
   *     `electron-core-ui/src/renderer/services/e2eEventBusShim.ts`).
   *   - Increment a counter on each emission; expose it via
   *     `window.__e2eDocumentUpdateCount` (or a per-protocol key).
   *   - Reset by setting it to 0 from `page.evaluate`.
   */
  readonly resetDocumentUpdateCount: (page: PageLike) => Promise<void>
  /** Read the document-update counter. Mirrors `resetDocumentUpdateCount`. */
  readonly getDocumentUpdateCount: (page: PageLike) => Promise<number>
}

export function defineProtocolE2EScaffoldSteps(
  bdd: BddFnsWithPage,
  config: ProtocolScaffoldConfig
): void {
  const { When, Then } = bdd

  // ─── Response panel ─────────────────────────────────────────────

  Then('the response panel is visible', async ({ page }) => {
    const p = asPage(page)
    await p.locator(testIdSelector(config.responsePanelTestId)).waitFor({ state: 'visible', timeout: 10000 })
  })

  Then('the response panel shows status, duration and body', async ({ page }) => {
    const p = asPage(page)
    await p.locator(testIdSelector(config.responseStatusTestId)).waitFor({ state: 'visible', timeout: 10000 })
    await p.locator(testIdSelector(config.responseDurationTestId)).waitFor({ state: 'visible', timeout: 10000 })
    await p.locator(testIdSelector(config.responseBodyTestId)).waitFor({ state: 'visible', timeout: 10000 })
  })

  // ─── Run + history ──────────────────────────────────────────────

  When('I run the request', async ({ page }) => {
    const p = asPage(page)
    await p.locator(testIdSelector(config.runButtonTestId)).click()
  })

  When(/^I run the request (\d+) times?$/, async ({ page }, ...args) => {
    const p = asPage(page)
    const count = Number(args[0])
    if (!Number.isFinite(count) || count < 1) {
      throw new Error(`Invalid run count: ${String(args[0])}`)
    }
    for (let i = 0; i < count; i += 1) {
      await p.locator(testIdSelector(config.runButtonTestId)).click()
      // Give the response panel time to settle between runs so the
      // history entry is recorded distinctly. 250 ms matches the
      // default debounce; loosen if a slow protocol regresses.
      await sleep(250)
    }
  })

  Then(/^the status bar history button surfaces (\d+) entries$/, async ({ page }, ...args) => {
    const p = asPage(page)
    const expected = Number(args[0])
    if (!Number.isFinite(expected) || expected < 0) {
      throw new Error(`Invalid expected count: ${String(args[0])}`)
    }
    const badge = p.locator(testIdSelector(config.historyCountTestId))
    await badge.waitFor({ state: 'visible', timeout: 10000 })
    const text = (await badge.innerText()).trim()
    const actual = Number(text)
    if (actual !== expected) {
      throw new Error(`Expected history count ${expected}, got ${actual} (raw "${text}")`)
    }
  })

  // ─── Cancellation ───────────────────────────────────────────────

  When('I cancel the in-flight request', async ({ page }) => {
    const p = asPage(page)
    await p.locator(testIdSelector(config.cancelButtonTestId)).click()
  })

  // ─── Debounce assertion (mandatory, Section 4) ──────────────────

  When(/^I type (\d+) characters into the URL field within (\d+) ms$/, async ({ page }, ...args) => {
    const p = asPage(page)
    const count = Number(args[0])
    const windowMs = Number(args[1])
    if (!Number.isFinite(count) || count < 1) {
      throw new Error(`Invalid character count: ${String(args[0])}`)
    }
    if (!Number.isFinite(windowMs) || windowMs < 0) {
      throw new Error(`Invalid window: ${String(args[1])}`)
    }
    await config.resetDocumentUpdateCount(p)

    const delay = Math.max(0, Math.floor(windowMs / Math.max(1, count - 1)))
    const input = p.locator(testIdSelector(config.urlInputTestId))
    await input.focus()
    // Use a fixed alphabet so the test is deterministic regardless of
    // the field's prior content.
    const text = 'abcdefghijklmnopqrstuvwxyz'.slice(0, count)
    await input.type(text, { delay })
  })

  Then(/^at most (\d+) document-update events are emitted for the request$/, async ({ page }, ...args) => {
    const p = asPage(page)
    const max = Number(args[0])
    if (!Number.isFinite(max) || max < 0) {
      throw new Error(`Invalid max: ${String(args[0])}`)
    }
    // Wait one default-debounce window so the trailing event lands
    // before we read the counter.
    await sleep(300)
    const count = await config.getDocumentUpdateCount(p)
    if (count > max) {
      throw new Error(`Debounce regression: expected ≤ ${max} document-update events, got ${count}`)
    }
  })
}
