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
 * The customer dashboard (self-serve account / billing) URL. A single host
 * across channels for now: the dashboard is not yet deployed, so this resolves
 * to a page that 404s until it ships — acceptable because there are no
 * production users before then. Split per-channel here if a dev dashboard host
 * later appears.
 */
export const DASHBOARD_URL = 'https://my.restorm.app'
