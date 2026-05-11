/**
 * Bridge MCP Mini browser tools (`open_mini_browser`,
 * `mini_browser_execute`) into the renderer. Symmetric to
 * `useMcpNavigation` / `useMcpRequestPatch`: main pushes the work
 * onto an IPC channel; this hook subscribes and runs the real React
 * / DOM side-effects.
 */

import { useEffect } from 'react'
import { logger } from 'electron-core-ui/renderer'

interface RestormMiniBrowserBridge {
  onMcpOpenMiniBrowser: (cb: (payload: { url?: string }) => void) => () => void
  onMcpMiniBrowserExecute: (cb: (payload: { requestId: string; code: string }) => void) => () => void
  replyMiniBrowserExecute: (payload: { requestId: string; result?: unknown; error?: string }) => void
}

export interface UseMcpMiniBrowserBridgeInput {
  enabled: boolean
  /**
   * Triggered when MCP asks to open the singleton Mini browser tab.
   * Forwarded straight to `App.tsx`'s `handleOpenMiniBrowser` callback
   * — keeps the singleton-tab tree mutation in its existing home
   * instead of duplicating the logic in this hook.
   */
  openMiniBrowser: () => void
  /**
   * Persist a URL on the Mini browser tab record. The webview reads
   * `tab.url` to set its initial `src`, so writing here also
   * navigates the embedded page. Reuses the same setter the user's
   * address-bar typing path uses.
   */
  setMiniBrowserUrl: (url: string) => void
}

interface WebviewLike extends HTMLElement {
  executeJavaScript: (code: string) => Promise<unknown>
}

export function useMcpMiniBrowserBridge(input: UseMcpMiniBrowserBridgeInput): void {
  const { enabled, openMiniBrowser, setMiniBrowserUrl } = input

  useEffect(() => {
    if (!enabled) return
    const api = (window as { restorm?: { runtime?: RestormMiniBrowserBridge } }).restorm?.runtime
    if (!api) return

    const offOpen = api.onMcpOpenMiniBrowser((payload) => {
      openMiniBrowser()
      if (typeof payload.url === 'string' && payload.url !== '') {
        // Tab mount + ref-assignment for the webview takes a render
        // tick — schedule the URL set after the tab mutation flushes
        // so the new tab actually picks up `tab.url`.
        const targetUrl = payload.url
        setTimeout(() => { setMiniBrowserUrl(targetUrl) }, 50)
      }
    })

    const runExecute = async ({ requestId, code }: { requestId: string; code: string }): Promise<void> => {
      try {
        const wv = document.querySelector('[data-testid="mini-browser-iframe"]') as unknown as WebviewLike | null
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
  }, [enabled, openMiniBrowser, setMiniBrowserUrl])
}
