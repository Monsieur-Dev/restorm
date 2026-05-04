/**
 * Bridge MCP `run_request` IPC into the renderer's existing
 * Send-button flow. Main broadcasts `mcp:run-request` with an item id;
 * we click the matching tab's Send button so:
 *   - the response panel populates as the user would see
 *   - the URL bar updates with the resolved URL
 *   - the response history panel ticks up
 *   - the toaster / dirty / save flows fire normally
 *
 * Works only when the request is open in a workbench tab; main is
 * expected to call `mcp:open-tab` before `mcp:run-request` for
 * consistency. Logs + no-ops if no Send button is found.
 */

import { useEffect } from 'react'
import { logger } from 'electron-core-ui/renderer'

interface RestormRunRequestBridge {
  onMcpRunRequest: (cb: (payload: { itemId: string }) => void) => () => void
}

export interface UseMcpRunRequestInput {
  enabled: boolean
}

// Test-ids vary per protocol — the matching button kind also varies
// (HTTP "Send", GraphQL/SOAP "Action", WS "Connect", gRPC "Send",
// OData "Send"). Whichever is mounted is the one we click.
const SEND_BUTTON_SELECTORS: readonly string[] = [
  '[data-testid="http-request-send-button"]',
  '[data-testid="graphql-action-button"]',
  '[data-testid="grpc-send-button"]',
  '[data-testid="soap-request-action-button"]',
  '[data-testid="websocket-connect-button"]',
  '[data-testid="odata-request-send"]',
  '[data-testid="local-auth-form-send-button"]'
]

/**
 * Find the Send/Connect button to click. Walks every protocol selector
 * and prefers a candidate that's actually visible (non-null
 * `offsetParent`) — split-pane / multi-tab future layouts could mount
 * two protocol panels at once, and we never want to fire Send on the
 * hidden one. Falls back to the first match if no visible candidate
 * exists (covers headless test environments where layout hasn't
 * settled yet).
 */
function clickSendButton(): boolean {
  let firstMatch: HTMLElement | null = null
  for (const selector of SEND_BUTTON_SELECTORS) {
    const candidates = document.querySelectorAll(selector)
    for (const el of Array.from(candidates)) {
      if (!(el instanceof HTMLElement)) continue
      firstMatch ??= el
      if (el.offsetParent !== null) {
        el.click()
        return true
      }
    }
  }
  if (firstMatch !== null) {
    firstMatch.click()
    return true
  }
  return false
}

export function useMcpRunRequest(input: UseMcpRunRequestInput): void {
  const { enabled } = input

  useEffect(() => {
    if (!enabled) return
    const root = window as { restorm?: { runtime?: RestormRunRequestBridge } }
    const api = root.restorm?.runtime
    if (!api) return
    const off = api.onMcpRunRequest(({ itemId }) => {
      // Tab activation arrives via the parallel `mcp:open-tab` event
      // main fires; React re-renders the panel before this listener
      // runs, so by the time we look for the Send button it's mounted.
      // A short tick gives React time to flush the activation render.
      setTimeout(() => {
        const ok = clickSendButton()
        if (!ok) {
          logger.warn('[mcp:run-request] no Send button found in DOM', { itemId })
        }
      }, 100)
    })
    return off
  }, [enabled])
}
