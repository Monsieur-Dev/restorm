import type { TFunction } from 'i18next'
import { toasterService } from 'electron-core-ui/renderer'
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
