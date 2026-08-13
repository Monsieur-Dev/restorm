import { chromium, expect, type Locator, type Page } from '@playwright/test'
import { existsSync, readFileSync, rmSync } from 'fs'

/** Poll a file until it holds non-empty content, then return it. */
export async function readFileWhenReady(path: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf-8').trim()
      if (content.length > 0) return content
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`auth URL file was not written within ${String(timeoutMs)}ms: ${path}`)
}

/** WorkOS AuthKit localizes (email step often English, password step French),
 * so button matches are bilingual + anchored so « Se connecter » never collides
 * with « Code de connexion par e-mail ». The email-step button reads plain
 * "Continue" on some environments and « Continuer avec l'e-mail » / "Continue
 * with email" on others — the exact match is tried FIRST so the wider one can
 * never shadow it (today the social-provider entries are links, not buttons,
 * but that is AuthKit's markup to change). */
const CONTINUE_EXACT_RE = /^(continue|continuer|next|suivant)$/i
const CONTINUE_WITH_EMAIL_RE = /^(continue|continuer|next|suivant) (with|avec) .*$/i
const SUBMIT_RE = /^(sign in|log in|se connecter|continue|continuer|connexion)$/i

/** Type into a React-controlled field reliably: focus, then key-by-key
 * (`fill()` hangs on the AuthKit inputs — the controlled value never settles). */
async function typeInto(field: Locator, value: string): Promise<void> {
  await field.click({ timeout: 15000 })
  await field.pressSequentially(value, { timeout: 20000, delay: 20 })
}

/**
 * Fill + submit the WorkOS AuthKit hosted sign-in form (a JS-rendered SPA whose
 * markup we don't own). The flow is two-step: email → Continue → password →
 * Sign in. Every interaction carries an explicit timeout so a form change fails
 * fast (never hangs to the test cap). On the first (email) failure we dump the
 * landing URL + page text to make a WorkOS-side change obvious.
 */
export async function completeWorkOsLogin(wpage: Page, email: string, password: string): Promise<void> {
  const emailField = wpage.locator('input[type="email"], input[name="email"]').first()
  try {
    await emailField.waitFor({ state: 'visible', timeout: 30000 })
  } catch (err) {
    // A WorkOS-side form change is the likely cause — surface the page so it's obvious.
    const body = await wpage.locator('body').innerText().catch(() => '<no body>')
    throw new Error(
      `WorkOS email field not found. Landing URL: ${wpage.url()}\nPage text (500): ${body.slice(0, 500)}\nOriginal: ${String(err)}`
    )
  }
  await typeInto(emailField, email)

  const passwordField = wpage.locator('input[type="password"]').first()
  // Two-step AuthKit: advance past the email step when the password isn't shown yet.
  if (!(await passwordField.isVisible().catch(() => false))) {
    const exact = wpage.getByRole('button', { name: CONTINUE_EXACT_RE }).first()
    const continueButton = (await exact.isVisible().catch(() => false))
      ? exact
      : wpage.getByRole('button', { name: CONTINUE_WITH_EMAIL_RE }).first()
    await continueButton.click({ timeout: 15000 })
  }

  await passwordField.waitFor({ state: 'visible', timeout: 30000 })
  await typeInto(passwordField, password)

  await wpage.getByRole('button', { name: SUBMIT_RE }).first().click({ timeout: 15000 })
}

export interface LoopbackLoginOptions {
  /** The path passed to the app as `RESTORM_E2E_AUTH_URL_FILE`. */
  authUrlFile: string
  email: string
  password: string
}

/**
 * Drive the app's full loopback login from the UI: trigger sign-in from the
 * account card (with `RESTORM_E2E_AUTH_URL_FILE` set, the app writes the
 * WorkOS auth URL to the file instead of opening the system browser), then
 * complete the hosted AuthKit form in a SEPARATE headless browser — the app's
 * loopback server captures the redirect and exchanges the code for a session
 * exactly as in production.
 *
 * Uses the system Chrome channel (Playwright's own chromium has no prebuilt
 * for this host OS). HEADLESS on purpose: a headed browser under the same
 * xvfb display as the Electron app loses input focus, so key events never
 * land (the form hangs).
 */
export async function loginViaLoopback(page: Page, { authUrlFile, email, password }: LoopbackLoginOptions): Promise<void> {
  rmSync(authUrlFile, { force: true })
  await page.locator('[data-testid="titlebar-account-button"]').click()
  await page.locator('[data-testid="account-card-sign-in"]').click()

  const authUrl = await readFileWhenReady(authUrlFile, 30000)
  expect(authUrl).toMatch(/^https?:\/\//)

  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] })
  try {
    const wpage = await browser.newPage()
    // `domcontentloaded`, NOT `load`/`networkidle`: the AuthKit SPA keeps the
    // network busy indefinitely, so waiting for those never returns. The
    // element waits in completeWorkOsLogin gate on the actual form instead.
    await wpage.goto(authUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await completeWorkOsLogin(wpage, email, password)
    // The loopback serves a "Signed in to Restorm" page once the code lands.
    try {
      await expect(wpage.locator('body')).toContainText('Signed in to Restorm', { timeout: 60000 })
    } catch (err) {
      console.log(`[workos-login] post-submit URL: ${wpage.url()}`)
      console.log(`[workos-login] post-submit body: ${(await wpage.locator('body').innerText().catch(() => '?')).slice(0, 400)}`)
      throw err
    }
  } finally {
    await browser.close()
  }
}
