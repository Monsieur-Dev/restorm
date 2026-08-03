/**
 * Per-channel marketing-site (restorm.app) configuration.
 *
 * Mirrors `shared/config/backend.ts`: preview builds point at the DEV site,
 * release builds at production, resolved off the SAME `-preview` version suffix
 * (`resolveChannel`). Pure + version-string-injected so it is usable from the
 * main process (the MCP Pro 402 refusal's `upgradeUrl`) AND surfaced to the
 * renderer (the « Passez à la version Pro » upsell link) through the same
 * main-resolved value — one source of truth, no main/renderer drift.
 */

import type { ReleaseChannel } from './backend'

/** PROD marketing-site base URL (no trailing slash). */
const PROD_SITE_URL = 'https://restorm.app'

/**
 * DEV / preview marketing-site base URL (no trailing slash) — the Cloudflare
 * Pages dev-branch alias (live-verified by Yoann, 2026-06-30).
 */
const DEV_SITE_URL = 'https://dev.restorm-website.pages.dev'

/** The marketing-site base URL for a channel. */
export function siteBaseUrl(channel: ReleaseChannel): string {
  return channel === 'preview' ? DEV_SITE_URL : PROD_SITE_URL
}

/** The pricing / upgrade page for a channel (the MCP Pro upsell + 402 target). */
export function pricingUrl(channel: ReleaseChannel): string {
  return `${siteBaseUrl(channel)}/pricing`
}

/**
 * The marketing site's locale path segments, lowercased, EXCLUDING the default
 * one. The site serves French at the unprefixed root and every other language
 * under `/<code>` (`/en`, `/ja`, `/zh-cn`, …) — so a link built for the app's
 * current language must carry that prefix or it lands on French.
 *
 * The app's shipped locale codes and the site's are the same 27, differing only
 * in case (`zh-CN` here, `zh-cn` in the URL). Kept as an explicit set so an app
 * locale that has no page on the site degrades to the root instead of linking
 * to a 404.
 */
const SITE_LOCALE_PATHS = new Set([
  'en', 'es', 'de', 'it', 'pt', 'nl', 'sv', 'da', 'nb', 'fi', 'pl', 'cs', 'hu',
  'ro', 'el', 'uk', 'hr', 'sr', 'sq', 'tr', 'id', 'vi', 'ja', 'ko', 'zh-cn', 'zh-tw'
])

/**
 * The site path prefix for an app locale — `''` for French (the unprefixed
 * default) and for anything the site does not publish, `/<code>` otherwise.
 */
export function siteLocalePath(locale: string): string {
  const code = locale.toLowerCase()
  return SITE_LOCALE_PATHS.has(code) ? `/${code}` : ''
}

/** The marketing-site home page, in the caller's language. */
export function websiteUrl(channel: ReleaseChannel, locale: string): string {
  return `${siteBaseUrl(channel)}${siteLocalePath(locale)}`
}

/** The documentation home, in the caller's language. */
export function docsUrl(channel: ReleaseChannel, locale: string): string {
  return `${siteBaseUrl(channel)}${siteLocalePath(locale)}/docs`
}

/** The release-notes (changelog) index, in the caller's language. */
export function releaseNotesUrl(channel: ReleaseChannel, locale: string): string {
  return `${siteBaseUrl(channel)}${siteLocalePath(locale)}/changelog`
}

/**
 * The customer dashboard (self-serve account / billing) URL. A single host
 * across channels for now: the dashboard is not yet deployed, so this resolves
 * to a page that 404s until it ships — acceptable because there are no
 * production users before then. Split per-channel here if a dev dashboard host
 * later appears.
 */
export const DASHBOARD_URL = 'https://my.restorm.app'
