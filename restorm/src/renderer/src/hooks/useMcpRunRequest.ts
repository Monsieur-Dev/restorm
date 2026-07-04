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
  '[data-testid="sse-connect-button"]',
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

// Cold-open of a never-mounted request tab can take longer than a
// single tick — Monaco bundles, Handlebars resolvers, large body
// previews, and React StrictMode's double-render all contend with
// the first paint. A flat `setTimeout(100)` after `mcp:run-request`
// would fire before the Send button was in the DOM, hit nothing, and
// silently no-op — leaving main to time out at 30s with an opaque
// "renderer did not produce a response" error. Poll instead.
const CLICK_RETRY_INTERVAL_MS = 50
const CLICK_TIMEOUT_MS = 5000

export function useMcpRunRequest(input: UseMcpRunRequestInput): void {
  const { enabled } = input

  useEffect(() => {
    if (!enabled) return
    const root = window as { restorm?: { runtime?: RestormRunRequestBridge } }
    const api = root.restorm?.runtime
    if (!api) return
    const off = api.onMcpRunRequest(({ itemId }) => {
      const deadline = Date.now() + CLICK_TIMEOUT_MS
      const tryClick = (): void => {
        if (clickSendButton()) return
        if (Date.now() >= deadline) {
          logger.warn('[mcp:run-request] no Send button found in DOM after retries', { itemId, waitedMs: CLICK_TIMEOUT_MS })
          return
        }
        setTimeout(tryClick, CLICK_RETRY_INTERVAL_MS)
      }
      tryClick()
    })
    return off
  }, [enabled])
}
