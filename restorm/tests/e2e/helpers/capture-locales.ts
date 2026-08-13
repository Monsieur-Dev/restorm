import { existsSync, mkdirSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import type { Page } from '@playwright/test'

/**
 * The set of shipped UI locales, read from the app's `locales/` tree so a new
 * translation automatically joins the capture set. Codes keep the app's casing
 * (`zh-CN`), which is what `appearance:language` expects.
 */
export function shippedLocales(restormRoot: string): string[] {
  const localesDir = join(restormRoot, 'src/renderer/locales')
  return readdirSync(localesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(localesDir, e.name, 'translation.json')))
    .map((e) => e.name)
    .sort()
}

/** Locale directory name used by the website docs tree: lowercase (`zh-cn`). */
export function localeDirName(locale: string): string {
  return locale.toLowerCase()
}

/**
 * Switch the running app's UI language. `appearance:language` is wired to
 * `i18n.changeLanguage` through the SettingsContext, so the whole UI repaints
 * live — no relaunch needed between captures.
 */
export async function switchAppLanguage(page: Page, locale: string): Promise<void> {
  await page.evaluate(async (code) => {
    await window.api.settings.set('appearance:language', code)
  }, locale)
  // The repaint is synchronous React work; a short settle absorbs font/layout
  // shifts (CJK glyph loading, longer German labels reflowing toolbars, …).
  await page.waitForTimeout(600)
}

/**
 * Capture one screenshot of the current app state per shipped locale.
 *
 * `targetFor` maps a locale to the destination PNG path — captures for the
 * website land in `…/docs/<locale-lowercase>/<slug>.png` via
 * `localeDirName`, but any layout works. Restores the UI to the `restore`
 * language (default `en`) afterwards so subsequent driving steps keep their
 * selectors.
 */
export async function captureForAllLocales(
  page: Page,
  restormRoot: string,
  targetFor: (locale: string) => string,
  options: { locales?: string[]; restore?: string } = {}
): Promise<string[]> {
  const locales = options.locales ?? shippedLocales(restormRoot)
  const written: string[] = []
  for (const locale of locales) {
    await switchAppLanguage(page, locale)
    const target = targetFor(locale)
    mkdirSync(dirname(target), { recursive: true })
    await page.screenshot({ path: target })
    written.push(target)
  }
  await switchAppLanguage(page, options.restore ?? 'en')
  return written
}
