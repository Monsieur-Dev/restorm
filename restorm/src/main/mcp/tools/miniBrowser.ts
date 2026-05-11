/**
 * Mini browser MCP tools — open / drive the singleton Mini browser
 * tab without forcing the agent to scrape menu testids.
 *
 * Flow mirrors `navigation.ts`: main fires an IPC the renderer's
 * `useMcpMiniBrowserBridge` listens to. For `open` we broadcast +
 * return immediately (renderer is forgiving about repeat opens —
 * it focuses the existing tab if one is already there). For
 * `execute` we round-trip through main↔renderer via a request id
 * so the agent gets the guest-script return value (or error).
 */

import { z } from 'zod'
import { BrowserWindow, ipcMain } from 'electron'
import { McpService } from 'electron-core-ui'

function jsonReply(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorReply(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/**
 * Round-trip executor: send a request with a unique id to every
 * renderer window, wait for the first matching reply on the `-reply`
 * channel, then resolve. Times out cleanly so an agent doesn't
 * hang on a window that has no webview mounted.
 */
function executeInMiniBrowser(code: string, timeoutMs: number): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return new Promise((resolve) => {
    let settled = false
    const handler = (_e: unknown, payload: unknown): void => {
      if (settled) return
      const p = payload as { requestId?: string; result?: unknown; error?: string }
      if (p.requestId !== requestId) return
      settled = true
      ipcMain.off('mcp:mini-browser-execute-reply', handler)
      if (typeof p.error === 'string' && p.error.length > 0) {
        resolve({ ok: false, error: p.error })
      } else {
        resolve({ ok: true, result: p.result })
      }
    }
    ipcMain.on('mcp:mini-browser-execute-reply', handler)
    broadcast('mcp:mini-browser-execute', { requestId, code })
    setTimeout(() => {
      if (settled) return
      settled = true
      ipcMain.off('mcp:mini-browser-execute-reply', handler)
      resolve({ ok: false, error: `mini_browser_execute: no renderer reply within ${timeoutMs}ms — is the Mini browser tab open?` })
    }, timeoutMs)
  })
}

export function registerMiniBrowserTools(mcp: McpService): void {
  mcp.registerTool(
    'open_mini_browser',
    {
      title: 'Open the Mini browser workbench tab',
      description:
        'Open (or focus, if already open) the singleton Mini browser tab in the active window. ' +
        'Optional `url` navigates the embedded webview to that address. Equivalent to clicking ' +
        '`View → Mini browser` in the title bar — but without scraping menu testids, and the ' +
        'optional URL skips the address-bar typing step.',
      inputSchema: {
        url: z.string().min(1).optional().describe(
          'Optional URL to navigate to immediately. Accepts bare hosts (e.g. `example.com`) — ' +
            'the renderer normalises them the same way as user-typed addresses.'
        )
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const url = typeof argRecord['url'] === 'string' ? argRecord['url'] : null
      broadcast('mcp:mini-browser-open', url !== null ? { url } : {})
      return jsonReply({ opened: true, ...(url !== null ? { url } : {}) })
    }
  )

  mcp.registerTool(
    'mini_browser_execute',
    {
      title: 'Run a script inside the Mini browser guest',
      description:
        'Execute a JavaScript expression inside the Mini browser\'s `<webview>` guest context ' +
        '(NOT the restorm renderer) and return the result. Wraps Electron\'s ' +
        '`webview.executeJavaScript(code)`. Use it to fill login forms in the embedded site, ' +
        'extract a JWT from the page\'s `localStorage`, click a button, or read a DOM node — ' +
        'anything you\'d do in DevTools on a normal browser tab. The result is whatever the ' +
        'expression resolves to (JSON-serialisable values come back as-is; functions and ' +
        'circular refs become `null`). Returns an error if no Mini browser tab is open or the ' +
        'webview hasn\'t finished its initial load.',
      inputSchema: {
        code: z.string().min(1).describe('JavaScript expression to evaluate in the guest context. Wrap multi-statement code in an IIFE.'),
        timeoutMs: z.coerce.number().int().min(500).max(60_000).optional().describe('Max time to wait for the renderer to forward the result. Default 5000ms.')
      } as Record<string, unknown>
    },
    async (args) => {
      const argRecord = args
      const code = typeof argRecord['code'] === 'string' ? argRecord['code'] : ''
      if (!code) return errorReply('code is required')
      const timeoutMs = typeof argRecord['timeoutMs'] === 'number' ? argRecord['timeoutMs'] : 5_000
      const outcome = await executeInMiniBrowser(code, timeoutMs)
      if (outcome.ok) return jsonReply({ result: outcome.result })
      return errorReply(outcome.error)
    }
  )
}
