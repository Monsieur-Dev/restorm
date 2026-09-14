import { execFileSync, spawnSync } from 'child_process'
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

/** pngquant availability, probed once per run. */
let pngquantAvailable: boolean | null = null

/** Quantize a capture in place (deterministic for identical input, `--strip`
 * drops timestamps) — screenshots are versioned, so size matters. A missing
 * pngquant downgrades to raw Playwright PNGs with a single warning. */
export function optimizePng(target: string): void {
  if (pngquantAvailable === null) {
    pngquantAvailable = spawnSync('pngquant', ['--version']).status === 0
    if (!pngquantAvailable) console.log('[doc-shots] pngquant not found — captures stay unoptimized')
  }
  if (!pngquantAvailable) return
  execFileSync('pngquant', ['--force', '--strip', '--quality', '60-95', '--output', target, target])
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
  options: {
    locales?: string[]
    restore?: string
    /**
     * Run after the language switch, before the shot — for surfaces that do
     * NOT survive a language change. A popover or a modal must be reopened per
     * locale: opening it once before the loop produces a screenshot of the
     * screen behind it, silently, for every locale but the first.
     */
    beforeShot?: (locale: string) => Promise<void>
    /**
     * Capture THIS element instead of the whole window. A popover or a dialog
     * occupies a small part of a 1600×1000 screen, and a full-window shot of
     * one is mostly the screen behind it — the reader has to hunt for the
     * subject. Full-window stays the default: for an editor view, the
     * surroundings ARE the subject.
     */
    clipTo?: () => import('@playwright/test').Locator
    /**
     * Capture a custom rectangle instead of a single element — for a subject
     * that spans two disjoint elements (e.g. a popover AND the status bar it
     * hangs off), where no single locator bounds both. Computed per shot from
     * the live layout. Ignored when `clipTo` is set.
     */
    clip?: () => Promise<{ x: number; y: number; width: number; height: number }>
  } = {}
): Promise<string[]> {
  const locales = options.locales ?? shippedLocales(restormRoot)
  const written: string[] = []
  for (const locale of locales) {
    await switchAppLanguage(page, locale)
    if (options.beforeShot) await options.beforeShot(locale)
    const target = targetFor(locale)
    mkdirSync(dirname(target), { recursive: true })
    if (options.clipTo) {
      await options.clipTo().screenshot({ path: target })
    } else if (options.clip) {
      await page.screenshot({ path: target, clip: await options.clip() })
    } else {
      await page.screenshot({ path: target })
    }
    optimizePng(target)
    written.push(target)
  }
  await switchAppLanguage(page, options.restore ?? 'en')
  return written
}
