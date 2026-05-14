/**
 * Bridge the MCP Mini browser tools (`open_mini_browser`,
 * `mini_browser_execute`) into the renderer. The host app pushes the
 * work onto IPC channels; this hook subscribes and runs the real
 * React / DOM side-effects.
 *
 * The hook is generic — it never reaches for a specific `window.*`
 * namespace. The host injects a `bridge` object that wires the three
 * IPC subscriptions (typically the slice of its preload API that
 * forwards the ECUI Mini browser channels).
 */

import { useEffect } from 'react'
import { logger } from '../services/logger'

/**
 * IPC bridge the host injects. Each method maps to one of the ECUI
 * Mini browser channels (see `MINI_BROWSER_*_CHANNEL` in
 * `src/types/ipcChannels.ts`):
 * - `onMcpOpenMiniBrowser` ← `MINI_BROWSER_OPEN_CHANNEL`
 * - `onMcpMiniBrowserExecute` ← `MINI_BROWSER_EXECUTE_CHANNEL`
 * - `replyMiniBrowserExecute` → `MINI_BROWSER_EXECUTE_REPLY_CHANNEL`
 */
export interface MiniBrowserBridgeApi {
  onMcpOpenMiniBrowser: (cb: (payload: { url?: string }) => void) => () => void
  onMcpMiniBrowserExecute: (cb: (payload: { requestId: string; code: string }) => void) => () => void
  replyMiniBrowserExecute: (payload: { requestId: string; result?: unknown; error?: string }) => void
}

export interface UseMcpMiniBrowserBridgeInput {
  enabled: boolean
  /**
   * IPC bridge object. When `null` / `undefined` (e.g. the host hasn't
   * wired its preload yet, or runs in a non-Electron context) the hook
   * no-ops cleanly.
   */
  bridge: MiniBrowserBridgeApi | null | undefined
  /**
   * Triggered when MCP asks to open the singleton Mini browser tab.
   * The host owns the tab tree mutation — this hook just forwards.
   */
  openMiniBrowser: () => void
  /**
   * Persist a URL on the Mini browser tab record. The webview reads
   * the tab's URL to set its initial `src`, so writing here also
   * navigates the embedded page.
   */
  setMiniBrowserUrl: (url: string) => void
  /**
   * CSS selector for the Mini browser `<webview>` element.
   * Defaults to the `data-testid` `MiniBrowserPanel` emits.
   */
  webviewSelector?: string
}

interface WebviewLike extends HTMLElement {
  executeJavaScript: (code: string) => Promise<unknown>
}

const DEFAULT_WEBVIEW_SELECTOR = '[data-testid="mini-browser-iframe"]'

export function useMcpMiniBrowserBridge(input: UseMcpMiniBrowserBridgeInput): void {
  const { enabled, bridge, openMiniBrowser, setMiniBrowserUrl, webviewSelector } = input

  useEffect(() => {
    if (!enabled || !bridge) return
    const api = bridge
    const selector = webviewSelector ?? DEFAULT_WEBVIEW_SELECTOR

    const offOpen = api.onMcpOpenMiniBrowser((payload) => {
      openMiniBrowser()
      if (typeof payload.url === 'string' && payload.url !== '') {
        // Tab mount + ref-assignment for the webview takes a render
        // tick — schedule the URL set after the tab mutation flushes
        // so the new tab actually picks up its URL.
        const targetUrl = payload.url
        setTimeout(() => { setMiniBrowserUrl(targetUrl) }, 50)
      }
    })

    const runExecute = async ({ requestId, code }: { requestId: string; code: string }): Promise<void> => {
      try {
        const wv = document.querySelector(selector) as unknown as WebviewLike | null
        if (!wv) {
          api.replyMiniBrowserExecute({ requestId, error: 'mini_browser_execute: no Mini browser tab is open' })
          return
        }
        if (typeof wv.executeJavaScript !== 'function') {
          api.replyMiniBrowserExecute({ requestId, error: 'mini_browser_execute: webview not ready yet' })
          return
        }
        const result = await wv.executeJavaScript(code)
        api.replyMiniBrowserExecute({ requestId, result })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn('[mcp:mini-browser-execute] script failed', { error: message })
        api.replyMiniBrowserExecute({ requestId, error: message })
      }
    }
    const offExec = api.onMcpMiniBrowserExecute((payload) => { void runExecute(payload) })

    return () => { offOpen(); offExec() }
  }, [enabled, bridge, openMiniBrowser, setMiniBrowserUrl, webviewSelector])
}
