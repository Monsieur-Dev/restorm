/**
 * MCP tools for the singleton Firewall workbench tab + the firewall
 * rule control plane. (`open_console` / `console_clear` and the Mini
 * browser tools are now `McpService` built-ins in electron-core-ui.)
 *
 * Each tool either broadcasts an IPC the renderer turns into a
 * `setWorkbenchTree` mutation, or reaches into a main-side service
 * directly (firewall allow/deny rules live on `PermissionService`
 * and don't need the renderer in the loop).
 */

import { z } from 'zod'
import { BrowserWindow } from 'electron'
import { McpService, permissionService, logger } from 'electron-core-ui'
import type { FirewallOrigin } from 'electron-core-ui'

function jsonReply(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

/**
 * Audit an agent-driven firewall change. An MCP client (not the user) just
 * mutated the firewall, so leave a trail: a stamped log line AND a renderer
 * broadcast so the UI can surface that an agent — not a human click — added the
 * rule. Silent agent whitelisting is exactly what the firewall guards against.
 */
function auditAgentFirewallChange(action: string, detail: Record<string, unknown>): void {
  logger.warn(`[firewall][audit] MCP agent ${action}`, { ...detail, source: 'mcp-agent' })
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('firewall:agent-rule-changed', { action, ...detail, at: new Date().toISOString() })
    } catch { /* window torn down */ }
  }
}

function errorReply(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function broadcast(channel: string, payload: unknown = {}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/**
 * Parse a free-form origin string into the `{scheme, host, port}`
 * shape `PermissionService` expects. Accepts
 *   - `host` (defaults to https / 443)
 *   - `scheme://host`
 *   - `scheme://host:port`
 * Rejects anything that doesn't yield a non-empty host or a valid
 * 1-65535 port.
 */
/** Parse a user/agent-supplied origin string into a firewall origin tuple, or
 * `null` when it isn't a usable origin. Exported for unit-test coverage; the
 * production call sites stay inside this module (firewall_allow / firewall_deny). */
export function parseOriginString(raw: string): FirewallOrigin | null {
  let candidate = raw.trim()
  if (candidate.length === 0) return null
  if (!candidate.includes('://')) candidate = `https://${candidate}`
  let parsed: URL
  try { parsed = new URL(candidate) } catch { return null }
  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase()
  if (scheme === '') return null
  const host = parsed.hostname.toLowerCase()
  if (host === '') return null
  const defaultPort = scheme === 'https' || scheme === 'wss' ? 443 : 80
  const port = parsed.port !== '' ? Number(parsed.port) : defaultPort
  // Port 0 is not a real listening port, so a rule keyed on it can never match
  // an actual connection — reject it rather than persist a dead rule.
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null
  return { scheme, host, port }
}

export function registerWorkbenchTabTools(mcp: McpService): void {
  mcp.registerTool(
    'open_firewall',
    {
      titleKey: 'mcpToolTitles.openFirewall',
      title: 'Open the Firewall workbench tab',
      description:
        'Open (or focus, if already open) the singleton Firewall tab. The Firewall panel shows ' +
        'the active whitelist / blacklist plus a "Test outbound" probe. Use it to surface the ' +
        'rule state when the agent is about to add or remove a rule.',
      inputSchema: {} as Record<string, unknown>
    },
    () => {
      broadcast('mcp:open-firewall')
      return jsonReply({ opened: true })
    }
  )

  mcp.registerTool(
    'firewall_list_rules',
    {
      titleKey: 'mcpToolTitles.firewallListRules',
      title: 'List firewall whitelist + blacklist',
      description:
        'Return the active firewall rules: `{ whitelist: FirewallOrigin[], blacklist: FirewallOrigin[] }`. ' +
        'Each origin is `{ scheme, host, port }`. Read-only — use `firewall_allow` / `firewall_deny` ' +
        'to mutate.',
      inputSchema: {} as Record<string, unknown>
    },
    () => {
      return jsonReply({
        whitelist: permissionService.listWhitelist(),
        blacklist: permissionService.listBlacklist()
      })
    }
  )

  mcp.registerTool(
    'firewall_allow',
    {
      titleKey: 'mcpToolTitles.firewallAllow',
      title: 'Add an origin to the firewall whitelist',
      description:
        'Add the given origin to the firewall whitelist so future requests to it pass through ' +
        'without prompting. Accepts a bare host (defaults to `https://...:443`), `scheme://host`, ' +
        'or `scheme://host:port`. Returns the parsed origin.',
      inputSchema: {
        origin: z.string().min(1).describe('Origin to allow. Examples: `api.example.com`, `https://api.example.com`, `https://api.example.com:8443`.')
      } as Record<string, unknown>
    },
    (args) => {
      const raw = typeof args['origin'] === 'string' ? args['origin'] : ''
      if (!raw) return errorReply('origin is required')
      const parsed = parseOriginString(raw)
      if (!parsed) return errorReply(`origin could not be parsed: ${raw}`)
      permissionService.addToWhitelist(parsed)
      auditAgentFirewallChange('allowed origin', { origin: parsed })
      return jsonReply({ added: parsed, list: 'whitelist' })
    }
  )

  mcp.registerTool(
    'firewall_deny',
    {
      titleKey: 'mcpToolTitles.firewallDeny',
      title: 'Add an origin to the firewall blacklist',
      description:
        'Add the given origin to the firewall blacklist so future requests to it are denied ' +
        'without prompting. Same input shape as `firewall_allow`. Use sparingly — restorm\'s ' +
        'whole point is to let through the user\'s API; the blacklist is for outright-malicious ' +
        'destinations.',
      inputSchema: {
        origin: z.string().min(1).describe('Origin to deny. Same shape as `firewall_allow`.')
      } as Record<string, unknown>
    },
    (args) => {
      const raw = typeof args['origin'] === 'string' ? args['origin'] : ''
      if (!raw) return errorReply('origin is required')
      const parsed = parseOriginString(raw)
      if (!parsed) return errorReply(`origin could not be parsed: ${raw}`)
      permissionService.addToBlacklist(parsed)
      auditAgentFirewallChange('denied origin', { origin: parsed })
      return jsonReply({ added: parsed, list: 'blacklist' })
    }
  )

  mcp.registerTool(
    'firewall_list_pending_prompts',
    {
      titleKey: 'mcpToolTitles.firewallListPendingPrompts',
      title: 'List firewall prompts awaiting a user decision',
      description:
        'Return every outbound-request prompt currently waiting on the user to click Allow / Deny ' +
        '(or auto-deny on timeout). Each entry is ' +
        '`{ promptId, origin, source, startedAt, originHint? }` — `promptId` is the key you pass ' +
        'back to `firewall_resolve_prompt` to answer one programmatically. Empty array when no ' +
        'prompt is in flight. Useful when a `run_request` looks stalled — surface the pending ' +
        'prompt to the user (or auto-allow it after they\'ve given a higher-level "go ahead").',
      inputSchema: {} as Record<string, unknown>
    },
    () => {
      return jsonReply({ pending: permissionService.listPendingPrompts() })
    }
  )

  mcp.registerTool(
    'firewall_resolve_prompt',
    {
      titleKey: 'mcpToolTitles.firewallResolvePrompt',
      title: 'Resolve a pending firewall prompt programmatically',
      description:
        'Answer a single firewall prompt without waiting for the user to click. Pass the ' +
        '`promptId` returned by `firewall_list_pending_prompts` and the verdict you want to ' +
        'apply (`"allow"` or `"deny"`). Persists the decision to the matching list ' +
        '(same as a real user click), so future calls to the same origin short-circuit.',
      inputSchema: {
        promptId: z.string().min(1).describe('promptId from `firewall_list_pending_prompts`.'),
        verdict: z.enum(['allow', 'deny']).describe('Decision to apply (and persist).')
      } as Record<string, unknown>
    },
    (args) => {
      const promptId = typeof args['promptId'] === 'string' ? args['promptId'] : ''
      const verdict = args['verdict']
      if (!promptId) return errorReply('promptId is required')
      if (verdict !== 'allow' && verdict !== 'deny') return errorReply('verdict must be "allow" or "deny"')
      permissionService.resolvePrompt(promptId, verdict)
      auditAgentFirewallChange('resolved prompt', { promptId, verdict })
      return jsonReply({ resolved: promptId, verdict })
    }
  )
}
