import type { TFunction } from 'i18next'
import { toasterService, logger } from 'electron-core-ui/renderer'
import { ScenarioToastTitle, ScenarioToastBody } from '../components/ScenarioToastBody'

/**
 * The ONE way a server editor reports a failed listen/start: an error-level
 * toast (red glyph header), identical across every protocol. The raw
 * main-process error is replaced by the translated port-in-use message when
 * that's what it is — `EADDRINUSE`-style strings must never reach the user
 * untranslated.
 */
export function pushServerListenErrorToast(
  t: TFunction,
  title: string,
  error: string,
  fallbackPort?: string | number
): void {
  const inUse = /EADDRINUSE|address already in use/i.test(error)
  const port = (/[:\s](\d{2,5})\s*$/.exec(error.trim()))?.[1] ?? String(fallbackPort ?? '')
  const body = inUse ? t('http.server.portInUse', { port }) : error
  toasterService.push('app', {
    title,
    titleNode: <ScenarioToastTitle title={title} message={body} level="error" />,
    body: <ScenarioToastBody title={title} message={body} />,
    durationMs: 10000,
    ariaLive: 'assertive'
  })
}

/**
 * A listen/bind failure the user caused and can fix from the toast — the port is
 * busy, privileged, or the address is unavailable. Expected + actionable, so it
 * must NOT reach crash reporting; anything else is a genuine, unexpected failure.
 */
export function isExpectedListenError(error: string): boolean {
  return /EADDRINUSE|EACCES|EADDRNOTAVAIL|EADDRINVAL|address already in use|permission denied/i.test(error)
}

/**
 * Log a mock-server listen/start failure at the RIGHT level, so an expected bind
 * error (already surfaced by {@link pushServerListenErrorToast}) is a `warn` —
 * below the main process's Sentry log bridge — while a genuinely unexpected
 * failure stays a bridged `error`. Call this instead of `logger.error` at every
 * server-tab listen callsite.
 */
export function logServerListenFailure(message: string, error: unknown): void {
  const text = typeof error === 'string' ? error : String(error)
  if (isExpectedListenError(text)) logger.warn(message, { error: text })
  else logger.error(message, { error: text })
}
