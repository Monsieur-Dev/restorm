/**
 * The MCP per-tool capability gate — the SINGLE source of truth for which MCP
 * tools are free (Community) and which require a paid capability, plus the
 * refusal an agent gets when it calls a gated tool without the entitlement.
 *
 * Product model (Yoann, 2026-06-30): the MCP server stays available to EVERYONE
 * — Community uses an AI agent to drive REQUESTS for free (the adoption hook).
 * The advanced surface (scenarios, screenshots/screencast, low-level UI
 * automation, multi-instance, and the git routes) requires a Pro-tier
 * capability. So we do NOT gate `--mcp` startup; each gated tool
 * checks its OWN required capability at call time and, if absent, returns a
 * clean `isError` tool-result (the JSON-RPC transport stays 200) that
 * (a) tells the AI agent in plain English why it failed + how to fix it, and
 * (b) carries a machine-readable `payment_required` / 402 block naming the
 * specific capability it needs.
 *
 * Most gated tools require `mcp.pro` (`PRO_MCP_TOOLS`); the git routes
 * require `git.client` instead (`GIT_CLIENT_MCP_TOOLS`) — both are Pro-tier
 * entitlements, just gating different features, so a Community user without
 * EITHER sees the same refusal shape on both. Per-tool
 * capability is resolved via `TOOL_CAPABILITY` below; `McpService` only ever
 * holds a SINGLE `McpToolGate`, so a second capability is added by widening
 * this map rather than by composing a second gate.
 *
 * The classification below is exhaustive over every registered MCP tool (ECUI
 * built-ins + restorm domain tools); `mcpProGate.test.ts` asserts no registered
 * tool is left unclassified. DECIDED: an unknown / forgotten tool defaults to
 * FREE at runtime — flipping the runtime to fail-closed would make a
 * legitimate, merely-unclassified request-driving tool paid or broken, which
 * contradicts the Community adoption hook. The fail-closed guard lives in CI
 * instead: the exhaustiveness test scans every `registerTool` call site
 * recursively (restorm `mcp/**` AND `electron-core-ui/src/main/services/**`),
 * refuses non-literal tool names, and goes RED before an unclassified tool can
 * ship as silently free.
 */

import type { McpToolGate, McpToolResult } from 'electron-core-ui'

/**
 * The capability most advanced MCP tools require. Minted into the entitlement
 * JWT for `pro` + `enterprise` plans (never `community`) by the backend
 * `capabilitiesFor` (restorm-cloud `_shared/providers/capabilities.ts`). Mirrors
 * the `scenario.headless` gating machinery.
 */
export const MCP_PRO_CAPABILITY = 'mcp.pro' as const

/**
 * The capability the git MCP routes require (`git.client`, LOCKED in the
 * capability→UX gating map) — separate from `mcp.pro` because the git
 * client is its own Pro-tier feature, gated the same way whether driven from
 * the UI or from an MCP tool call.
 */
export const GIT_CLIENT_CAPABILITY = 'git.client' as const

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
  'update_environment',
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
  // design domain — EDITING a design is free on every plan (the same
  // decision as the UI: the plan gates PLAYING it, not building it).
  // The RUN + EXPORT surface (serve/steer/status/export/codegen) sits in
  // PRO below, aligned with DESIGN_RUN_CAPABILITY and mirroring the
  // scenario gate (Yoann 2026-08-17: run and export are paid).
  'list_designs',
  'get_design',
  'create_design',
  'create_design_from_documentation',
  'update_design',
  'delete_design',
  'create_design_model',
  'update_design_model',
  'delete_design_model',
  'set_design_property',
  'delete_design_property',
  'create_design_enum',
  'update_design_enum',
  'delete_design_enum',
  'set_design_example',
  'delete_design_example',
  'create_design_route_group',
  'update_design_route_group',
  'delete_design_route_group',
  'create_design_route',
  'update_design_route',
  'delete_design_route',
  'generate_design_crud',
  'generate_design_search_routes',
  'set_favorite',
  // application settings — the generic read/write routes over every setting
  'get_settings',
  'set_setting',
  'patch_settings',
  'reset_setting'
])

/**
 * PRO tools — require the `mcp.pro` capability: the whole scenario domain (incl.
 * read-only, since scenarios ARE the Pro differentiator and read-only scenario
 * data isn't needed to drive a request), multi-instance, screenshots/screencast,
 * and ALL low-level app/UI automation, inspection, capture + devtools.
 */
export const PRO_MCP_TOOLS: ReadonlySet<string> = new Set([
  // cookie jar (read + mutate the per-environment cookie store)
  'list_cookies',
  'add_cookie',
  'remove_cookie',
  'clear_cookie_domain',
  'clear_cookies',
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
  'get_workbench_layout',
  'set_workbench_layout',
  // design RUN + EXPORT surface — playing a design (serving, hot
  // steering, status), generating code, and exporting a descriptor are
  // the paid half of the design domain, mirroring DESIGN_RUN_CAPABILITY
  // on the UI's spin button and the scenario gate (edit free, run+export
  // paid — Yoann 2026-08-17).
  'serve_design',
  'stop_design_server',
  'set_design_route_response',
  'get_design_server_status',
  'generate_design_code',
  'export_design'
])

/**
 * The git MCP routes — Pro-gated behind `git.client` instead of `mcp.pro`
 * (see the file-level doc). A 2-step commit+push confirm flow plus a pull
 * flow with ZOD-validated conflict resolution; see `tools/git.ts`.
 */
export const GIT_CLIENT_MCP_TOOLS: ReadonlySet<string> = new Set([
  'git_commit_push',
  'git_confirm_push',
  'git_pull',
  'git_resolve_conflicts'
])

/**
 * Per-tool required capability, for every tool gated behind ANY Pro-tier
 * capability. `mcpToolPlan`/`isProMcpTool` stay capability-agnostic (both
 * `mcp.pro` and `git.client` tools report `'pro'` / `true`) — call
 * `requiredCapability` when the SPECIFIC capability matters (building the
 * refusal, wiring the live entitlement check).
 */
const TOOL_CAPABILITY: ReadonlyMap<string, string> = new Map([
  ...[...PRO_MCP_TOOLS].map((name): [string, string] => [name, MCP_PRO_CAPABILITY]),
  ...[...GIT_CLIENT_MCP_TOOLS].map((name): [string, string] => [name, GIT_CLIENT_CAPABILITY])
])

/** The plan a tool belongs to. `unknown` = not in any gated set (a tool we
 * forgot to classify — treated as free at runtime, caught by the
 * exhaustiveness test). */
export type McpToolPlan = 'free' | 'pro' | 'unknown'

/** Classify a tool by name. */
export function mcpToolPlan(toolName: string): McpToolPlan {
  if (TOOL_CAPABILITY.has(toolName)) return 'pro'
  if (FREE_MCP_TOOLS.has(toolName)) return 'free'
  return 'unknown'
}

/** True when `toolName` is gated behind SOME Pro-tier capability (`mcp.pro`
 * OR `git.client`) — use {@link requiredCapability} for which one. */
export function isProMcpTool(toolName: string): boolean {
  return TOOL_CAPABILITY.has(toolName)
}

/** The specific capability `toolName` requires, or `null` when it's free /
 * unclassified. */
export function requiredCapability(toolName: string): string | null {
  return TOOL_CAPABILITY.get(toolName) ?? null
}

/**
 * Build the `isError` refusal an agent gets when it calls a gated tool
 * without `capability`. The `content` text is the human/agent-readable
 * English explanation; `structuredContent` is the machine-readable block a
 * tool-using agent can branch on (`code` / `httpEquivalent` / `plan` /
 * `capability` / `upgradeUrl`).
 *
 * `pricingUrl` is the channel-resolved upgrade URL (dev site on preview builds,
 * restorm.app on release) — the SAME value the renderer's upsell link uses, so
 * an agent and the human are pointed at the same page. Resolved by the host
 * (`shared/config/site` `pricingUrl(resolveChannel(app.getVersion()))`).
 */
export function buildProRefusal(toolName: string, capability: string, pricingUrl: string): McpToolResult {
  const message =
    `This tool ("${toolName}") requires Restorm Pro. The Community plan lets AI agents drive ` +
    `requests for free; scenarios, screenshots/screencast, low-level UI automation, multi-instance ` +
    `control, and the git client require Pro. Ask the user to upgrade: ${pricingUrl}`
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
    structuredContent: {
      code: 'payment_required',
      httpEquivalent: 402,
      plan: 'pro',
      capability,
      upgradeUrl: pricingUrl
    }
  }
}

/**
 * Create the {@link McpToolGate} restorm injects into ECUI's `McpService`.
 *
 * `hasCapability` is read LIVE on every authorize() so the gate reflects the
 * current entitlement (a login / logout / refresh flips it immediately, no
 * restart) — checked against whichever capability THIS tool requires (not
 * hardcoded to `mcp.pro`), via `hasCapability(getEntitlementService().getState(),
 * requiredCapability(toolName))`. `pricingUrl` is the channel-resolved
 * upgrade URL embedded in the refusal.
 */
export function createMcpProGate(deps: {
  hasCapability: (capability: string) => boolean
  pricingUrl: string
}): McpToolGate {
  return {
    gatedDescriptionSuffix: MCP_PRO_DESCRIPTION_SUFFIX,
    isGated(toolName: string): boolean {
      return isProMcpTool(toolName)
    },
    authorize(toolName: string): McpToolResult | null {
      const capability = requiredCapability(toolName)
      if (capability === null) return null
      if (deps.hasCapability(capability)) return null
      return buildProRefusal(toolName, capability, deps.pricingUrl)
    }
  }
}
