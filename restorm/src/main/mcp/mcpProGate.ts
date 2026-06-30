/**
 * The MCP per-tool Pro gate — the SINGLE source of truth for which MCP tools are
 * free (Community) and which require Restorm Pro, plus the refusal an agent gets
 * when it calls a Pro tool without the entitlement.
 *
 * Product model (Yoann, 2026-06-30): the MCP server stays available to EVERYONE
 * — Community uses an AI agent to drive REQUESTS for free (the adoption hook).
 * The advanced surface (scenarios, screenshots/screencast, low-level UI
 * automation, multi-instance) requires Pro. So we do NOT gate `--mcp` startup;
 * each Pro tool checks the live `mcp.pro` capability at call time and, if absent,
 * returns a clean `isError` tool-result (the JSON-RPC transport stays 200) that
 * (a) tells the AI agent in plain English why it failed + how to fix it, and
 * (b) carries a machine-readable `payment_required` / 402 block.
 *
 * The classification below is exhaustive over every registered MCP tool (ECUI
 * built-ins + restorm domain tools); `mcpProGate.test.ts` asserts no registered
 * tool is left unclassified. An unknown / forgotten tool defaults to FREE at
 * runtime (never break a tool we failed to classify — the exhaustiveness test is
 * the real guard against a Pro tool slipping through as free).
 */

import type { McpToolGate, McpToolResult } from 'electron-core-ui'

/**
 * The capability that the advanced MCP tools require. Minted into the entitlement
 * JWT for `pro` + `enterprise` plans (never `community`) by the backend
 * `capabilitiesFor` (restorm-cloud `_shared/providers/capabilities.ts`). Mirrors
 * the `scenario.headless` gating machinery.
 */
export const MCP_PRO_CAPABILITY = 'mcp.pro' as const

/** The `tools/list` description marker appended to a Pro-gated tool, so an agent
 * enumerating tools sees the tool exists but needs an upgrade (kept listed). */
export const MCP_PRO_DESCRIPTION_SUFFIX = ' (Restorm Pro)'

/**
 * FREE (Community) tools — the "request workspace" domain: drive + author
 * requests, read their responses/history, and the project / environment /
 * variable / value-list / quick-config / favorites / search / tab-navigation /
 * firewall scaffolding needed to use them. `batch` is free but each of its
 * sub-calls is independently re-gated (see {@link McpService.invokeTool}), so it
 * can't smuggle a Pro tool.
 */
export const FREE_MCP_TOOLS: ReadonlySet<string> = new Set([
  // execute — run a request + read its result
  'run_request',
  'run_request_batch',
  'cancel_request',
  'get_response',
  'get_response_history',
  'read_stream',
  'send_message',
  // batch — chains other (independently gated) tool calls
  'batch',
  // import — populate the workspace from a URL (collection / spec / curl)
  'import_from_url',
  // navigation — open / close / reveal a request tab
  'open_tab',
  'close_tab',
  'reveal_in_tree',
  // project — the container holding requests
  'create_project',
  'open_project',
  'save_project',
  'list_recent_projects',
  // quick-configs
  'add_quick_config',
  'update_quick_config',
  'delete_quick_config',
  'list_quick_configs',
  'describe_quick_config_schema',
  // read-only request/workspace helpers
  'get_request',
  'get_active_env',
  'get_current_tab',
  'list_requests',
  'list_folders',
  'list_favorites',
  'list_value_sources',
  'search',
  // firewall — let a request reach a new host (resolve the prompt to finish it)
  'firewall_allow',
  'firewall_deny',
  'firewall_list_pending_prompts',
  'firewall_list_rules',
  'firewall_resolve_prompt',
  'open_firewall',
  // write — author requests / folders / environments / variables / value-lists
  'create_request',
  'update_request',
  'create_folder',
  'update_folder',
  'delete_item',
  'move_item',
  'rename_item',
  'create_environment',
  'delete_environment',
  'rename_environment',
  'refresh_environment',
  'list_environments',
  'set_env_variable',
  'delete_env_variable',
  'list_env_variables',
  'create_custom_value_list',
  'update_custom_value_list',
  'delete_custom_value_list',
  'list_custom_value_lists',
  'set_favorite'
])

/**
 * PRO tools — require the `mcp.pro` capability: the whole scenario domain (incl.
 * read-only, since scenarios ARE the Pro differentiator and read-only scenario
 * data isn't needed to drive a request), multi-instance, screenshots/screencast,
 * and ALL low-level app/UI automation, inspection, capture + devtools.
 */
export const PRO_MCP_TOOLS: ReadonlySet<string> = new Set([
  // scenario domain (authoring + execution + read-only)
  'create_scenario',
  'list_scenarios',
  'get_scenario',
  'describe_scenario_kinds',
  'list_scenario_nodes',
  'create_scenario_node',
  'update_scenario_node',
  'delete_scenario_node',
  'connect_scenario_nodes',
  'disconnect_scenario_nodes',
  'arrange_scenario',
  'move_scenario_node',
  'set_edge_selector',
  'define_param',
  'update_scenario',
  'run_scenario',
  'stop_scenario_run',
  'answer_scenario_input',
  'get_scenario_run_status',
  'list_scenario_runs',
  'run_scenario_node',
  'cancel_scenario_node',
  'get_scenario_node_result',
  'get_scenario_node_status',
  // multi-instance
  'create_instance',
  'terminate_instance',
  'list-instances',
  // capture
  'screenshot',
  'screencast-start',
  'screencast-stop',
  // low-level UI driving / inspection / app automation / devtools
  'dom-query',
  'evaluate',
  'dispatch-event',
  'mouse-input',
  'type-text',
  'drag-drop',
  'keyboard-shortcut',
  'scroll-into-view',
  'get-computed-style',
  'inject-css',
  'storage',
  'get-windows',
  'window-info',
  'refresh',
  'set_tab_maximized',
  'devtools',
  'console-logs',
  'console_clear',
  'open_console',
  'mini_browser_execute',
  'open_mini_browser',
  'wait',
  'wait-for',
  'exit',
  'get_current_theme',
  'list_themes',
  'switch_theme',
  'get_workbench_layout',
  'set_workbench_layout'
])

/** The plan a tool belongs to. `unknown` = not in either set (a tool we forgot
 * to classify — treated as free at runtime, caught by the exhaustiveness test). */
export type McpToolPlan = 'free' | 'pro' | 'unknown'

/** Classify a tool by name. */
export function mcpToolPlan(toolName: string): McpToolPlan {
  if (PRO_MCP_TOOLS.has(toolName)) return 'pro'
  if (FREE_MCP_TOOLS.has(toolName)) return 'free'
  return 'unknown'
}

/** True when `toolName` is gated behind Pro. */
export function isProMcpTool(toolName: string): boolean {
  return PRO_MCP_TOOLS.has(toolName)
}

/**
 * Build the `isError` refusal an agent gets when it calls a Pro tool without the
 * `mcp.pro` capability. The `content` text is the human/agent-readable English
 * explanation; `structuredContent` is the machine-readable block a tool-using
 * agent can branch on (`code` / `httpEquivalent` / `plan` / `upgradeUrl`).
 *
 * `pricingUrl` is the channel-resolved upgrade URL (dev site on preview builds,
 * restorm.app on release) — the SAME value the renderer's upsell link uses, so
 * an agent and the human are pointed at the same page. Resolved by the host
 * (`shared/config/site` `pricingUrl(resolveChannel(app.getVersion()))`).
 */
export function buildProRefusal(toolName: string, pricingUrl: string): McpToolResult {
  const message =
    `This tool ("${toolName}") requires Restorm Pro. The Community plan lets AI agents drive ` +
    `requests for free; scenarios, screenshots/screencast, low-level UI automation and ` +
    `multi-instance control require Pro. Ask the user to upgrade: ${pricingUrl}`
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
    structuredContent: {
      code: 'payment_required',
      httpEquivalent: 402,
      plan: 'pro',
      capability: MCP_PRO_CAPABILITY,
      upgradeUrl: pricingUrl
    }
  }
}

/**
 * Create the {@link McpToolGate} restorm injects into ECUI's `McpService`.
 *
 * `hasProCapability` is read LIVE on every authorize() so the gate reflects the
 * current entitlement (a login / logout / refresh flips it immediately, no
 * restart). The host wires it to
 * `hasCapability(getEntitlementService().getState(), MCP_PRO_CAPABILITY)`.
 * `pricingUrl` is the channel-resolved upgrade URL embedded in the refusal.
 */
export function createMcpProGate(deps: {
  hasProCapability: () => boolean
  pricingUrl: string
}): McpToolGate {
  return {
    gatedDescriptionSuffix: MCP_PRO_DESCRIPTION_SUFFIX,
    isGated(toolName: string): boolean {
      return isProMcpTool(toolName)
    },
    authorize(toolName: string): McpToolResult | null {
      if (!isProMcpTool(toolName)) return null
      if (deps.hasProCapability()) return null
      return buildProRefusal(toolName, deps.pricingUrl)
    }
  }
}
