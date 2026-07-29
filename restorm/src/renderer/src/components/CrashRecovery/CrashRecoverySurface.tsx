/**
 * What the user sees instead of a white screen.
 *
 * It renders at the exact moment the app's normal rendering has failed, so it
 * is built to assume nothing about what is still working. No context, no
 * stores, no hooks beyond React's own: every dependency is one more thing that
 * could already be the broken thing, and a recovery surface that cannot render
 * is worse than no recovery surface at all — it turns a diagnosable crash into
 * a blank window.
 *
 * That constraint shapes three choices:
 *
 * - Translations are read from the i18n instance DEFENSIVELY, with English
 *   built in. If i18n is what failed, the user still gets a sentence rather
 *   than a raw key or a second crash.
 * - Every colour resolves through a `var(--token, literal)` fallback, so the
 *   surface is legible even if the theme never loaded.
 * - The relaunch button is only offered when the bridge that performs it is
 *   actually present. A button that silently does nothing would be a worse
 *   answer than no button.
 */

import React, { useCallback } from 'react'
import { Button, i18n } from 'electron-core-ui/renderer'
import './crashRecoverySurface.css'

/**
 * A translation, or the built-in English if the i18n stack cannot answer.
 *
 * `t` returns the key itself for a missing string, which would put
 * `crashRecovery.message` on screen — so an unresolved key counts as no answer.
 */
function text(key: string, fallback: string): string {
  try {
    const value = i18n.t(key)
    return typeof value === 'string' && value !== '' && value !== key ? value : fallback
  } catch {
    return fallback
  }
}

/** The bridge, or `undefined`. Widened deliberately: `window.api` is DECLARED
 * as always carrying it, but the declaration describes the preload we build,
 * not necessarily the one that loaded. */
function relaunchBridge(): (() => Promise<void>) | undefined {
  try {
    const api = (window.api as Partial<Window['api']> | undefined)?.crash
    return typeof api?.recoverRelaunch === 'function' ? api.recoverRelaunch : undefined
  } catch {
    return undefined
  }
}

export const CrashRecoverySurface: React.FC = () => {
  const relaunch = relaunchBridge()

  const handleRelaunch = useCallback((): void => {
    // Never awaited: the main process restarts the app rather than replying, so
    // there is no resolution to wait for.
    void relaunch?.()
  }, [relaunch])

  return (
    <div className="crash-recovery-surface" role="alert" data-testid="crash-recovery-surface">
      <div className="crash-recovery-surface-panel">
        <p className="crash-recovery-surface-message">
          {text('crashRecovery.message', 'Restorm ran into a problem and needs to be restarted.')}
        </p>
        {relaunch !== undefined && (
          <Button onClick={handleRelaunch} data-testid="crash-recovery-relaunch">
            {text('crashRecovery.relaunch', 'Restart Restorm')}
          </Button>
        )}
      </div>
    </div>
  )
}
