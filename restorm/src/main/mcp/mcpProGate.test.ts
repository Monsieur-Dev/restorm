import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  FREE_MCP_TOOLS,
  PRO_MCP_TOOLS,
  GIT_CLIENT_MCP_TOOLS,
  MCP_PRO_CAPABILITY,
  GIT_CLIENT_CAPABILITY,
  MCP_PRO_DESCRIPTION_SUFFIX,
  mcpToolPlan,
  isProMcpTool,
  requiredCapability,
  buildProRefusal,
  createMcpProGate
} from './mcpProGate'

/** A stand-in for the channel-resolved pricing URL the host injects. */
const TEST_PRICING_URL = 'https://test.restorm.example/pricing'

/**
 * Collect every MCP tool NAME registered across the codebase by source-scanning
 * the `registerTool('<name>', …)` call sites — both ECUI's built-ins
 * (`McpService.ts`) and restorm's domain tools (`mcp/**`). Cheap + dependency-free
 * (mirrors `toolTitleKeys.test.ts`), and it's the same set ECUI would expose via
 * `getRegisteredToolTitleKeys()` at runtime.
 */
function collectRegisteredToolNames(): Set<string> {
  const names = new Set<string>()
  const files: string[] = []

  // restorm domain tools: mcp/ + mcp/tools/, non-test .ts
  const mcpDir = join(__dirname)
  const toolsDir = join(__dirname, 'tools')
  for (const dir of [mcpDir, toolsDir]) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue
      files.push(join(dir, f))
    }
  }
  // ECUI built-in tools
  files.push(
    join(__dirname, '../../../../electron-core-ui/src/main/services/McpService.ts')
  )

  for (const file of files) {
    const src = readFileSync(file, 'utf-8')
    for (const m of src.matchAll(/registerTool\(\s*'([^']+)'/g)) names.add(m[1])
  }
  return names
}

describe('mcpProGate — classification', () => {
  const registered = collectRegisteredToolNames()

  it('scans a non-trivial set of registered tools', () => {
    // Sanity: the scan actually found the registry (guards against a regex /
    // path regression silently classifying nothing).
    expect(registered.size).toBeGreaterThan(90)
  })

  it('classifies EVERY registered tool (no tool unclassified)', () => {
    const unclassified = [...registered].filter((n) => mcpToolPlan(n) === 'unknown')
    expect(unclassified).toEqual([])
  })

  it('never classifies a tool as both free and Pro', () => {
    const both = [...FREE_MCP_TOOLS].filter((n) => PRO_MCP_TOOLS.has(n) || GIT_CLIENT_MCP_TOOLS.has(n))
    expect(both).toEqual([])
  })

  it('never classifies a tool under both mcp.pro and git.client', () => {
    const both = [...PRO_MCP_TOOLS].filter((n) => GIT_CLIENT_MCP_TOOLS.has(n))
    expect(both).toEqual([])
  })

  it('has no stale classification entry (every classified name is actually registered)', () => {
    const stale = [...FREE_MCP_TOOLS, ...PRO_MCP_TOOLS, ...GIT_CLIENT_MCP_TOOLS].filter((n) => !registered.has(n))
    expect(stale).toEqual([])
  })

  it('keeps the request-driving tools free', () => {
    for (const name of ['run_request', 'run_request_batch', 'get_response', 'create_request', 'set_env_variable', 'batch']) {
      expect(mcpToolPlan(name)).toBe('free')
      expect(isProMcpTool(name)).toBe(false)
    }
  })

  it('gates scenarios, capture, UI automation and multi-instance behind mcp.pro', () => {
    for (const name of ['run_scenario', 'create_scenario', 'list_scenarios', 'screenshot', 'screencast-start', 'dom-query', 'evaluate', 'create_instance', 'list-instances']) {
      expect(mcpToolPlan(name)).toBe('pro')
      expect(isProMcpTool(name)).toBe(true)
      expect(requiredCapability(name)).toBe(MCP_PRO_CAPABILITY)
    }
  })

  it('gates the git routes behind git.client, not mcp.pro', () => {
    for (const name of ['git_commit_push', 'git_confirm_push', 'git_pull', 'git_resolve_conflicts']) {
      expect(mcpToolPlan(name)).toBe('pro')
      expect(isProMcpTool(name)).toBe(true)
      expect(requiredCapability(name)).toBe(GIT_CLIENT_CAPABILITY)
    }
  })

  it('treats an unknown tool as free (never break a forgotten tool)', () => {
    expect(mcpToolPlan('some_tool_we_never_heard_of')).toBe('unknown')
    expect(isProMcpTool('some_tool_we_never_heard_of')).toBe(false)
    expect(requiredCapability('some_tool_we_never_heard_of')).toBeNull()
  })
})

describe('mcpProGate — refusal payload', () => {
  it('is an isError tool-result with an agent-readable message + machine-readable 402 block', () => {
    const refusal = buildProRefusal('run_scenario', MCP_PRO_CAPABILITY, TEST_PRICING_URL)
    expect(refusal.isError).toBe(true)
    expect(refusal.content[0]?.type).toBe('text')
    expect(refusal.content[0]?.text).toContain('Restorm Pro')
    expect(refusal.content[0]?.text).toContain('run_scenario')
    expect(refusal.content[0]?.text).toContain(TEST_PRICING_URL)
    expect(refusal.structuredContent).toEqual({
      code: 'payment_required',
      httpEquivalent: 402,
      plan: 'pro',
      capability: MCP_PRO_CAPABILITY,
      upgradeUrl: TEST_PRICING_URL
    })
  })

  it('embeds the SPECIFIC capability the tool requires, not always mcp.pro', () => {
    const refusal = buildProRefusal('git_commit_push', GIT_CLIENT_CAPABILITY, TEST_PRICING_URL)
    expect(refusal.structuredContent?.capability).toBe(GIT_CLIENT_CAPABILITY)
  })

  it('embeds the host-injected (channel-resolved) pricing URL, not a hardcoded one', () => {
    const devUrl = 'https://dev.restorm.example/pricing'
    const gate = createMcpProGate({ hasCapability: () => false, pricingUrl: devUrl })
    const refusal = gate.authorize('screenshot')
    expect(refusal?.structuredContent?.upgradeUrl).toBe(devUrl)
    expect(refusal?.content[0]?.text).toContain(devUrl)
  })
})

describe('mcpProGate — gate behaviour', () => {
  it('a FREE tool always executes regardless of plan', () => {
    const communityGate = createMcpProGate({ hasCapability: () => false, pricingUrl: TEST_PRICING_URL })
    const proGate = createMcpProGate({ hasCapability: () => true, pricingUrl: TEST_PRICING_URL })
    expect(communityGate.authorize('run_request')).toBeNull()
    expect(proGate.authorize('run_request')).toBeNull()
    expect(communityGate.isGated('run_request')).toBe(false)
  })

  it('a PRO tool WITHOUT the capability is refused with the 402 payload', () => {
    const gate = createMcpProGate({ hasCapability: () => false, pricingUrl: TEST_PRICING_URL })
    const refusal = gate.authorize('run_scenario')
    expect(refusal).not.toBeNull()
    expect(refusal?.isError).toBe(true)
    expect(refusal?.structuredContent?.httpEquivalent).toBe(402)
  })

  it('a PRO tool WITH the capability executes', () => {
    const gate = createMcpProGate({ hasCapability: () => true, pricingUrl: TEST_PRICING_URL })
    expect(gate.authorize('run_scenario')).toBeNull()
  })

  it('reads the capability LIVE on each authorize (login/logout flips it)', () => {
    let pro = false
    const gate = createMcpProGate({ hasCapability: () => pro, pricingUrl: TEST_PRICING_URL })
    expect(gate.authorize('screenshot')).not.toBeNull()
    pro = true
    expect(gate.authorize('screenshot')).toBeNull()
    pro = false
    expect(gate.authorize('screenshot')).not.toBeNull()
  })

  it('marks Pro tools as gated for the tools/list annotation, free tools as not', () => {
    const gate = createMcpProGate({ hasCapability: () => true, pricingUrl: TEST_PRICING_URL })
    expect(gate.isGated('run_scenario')).toBe(true)
    expect(gate.isGated('run_request')).toBe(false)
    expect(gate.gatedDescriptionSuffix).toBe(MCP_PRO_DESCRIPTION_SUFFIX)
  })

  it('gates a git tool behind git.client SPECIFICALLY — granting mcp.pro alone does not unlock it', () => {
    const gate = createMcpProGate({ hasCapability: (capability) => capability === MCP_PRO_CAPABILITY, pricingUrl: TEST_PRICING_URL })
    const refusal = gate.authorize('git_commit_push')
    expect(refusal).not.toBeNull()
    expect(refusal?.structuredContent?.capability).toBe(GIT_CLIENT_CAPABILITY)
  })

  it('unlocks a git tool once git.client is granted, independent of mcp.pro', () => {
    const gate = createMcpProGate({ hasCapability: (capability) => capability === GIT_CLIENT_CAPABILITY, pricingUrl: TEST_PRICING_URL })
    expect(gate.authorize('git_commit_push')).toBeNull()
    // mcp.pro-gated tools stay locked — the two capabilities are independent.
    expect(gate.authorize('run_scenario')).not.toBeNull()
  })
})
