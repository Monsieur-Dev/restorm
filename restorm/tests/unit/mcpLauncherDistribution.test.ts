import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards for distributing the MCP launcher (`scripts/mcp-launcher.mjs`) to end
 * users through several channels — the npm `restorm-mcp` package, the bundled
 * app resource, and the CLI. Two invariants, both of which fail silently in
 * production if they drift:
 *
 *  1. SINGLE SOURCE. Every channel must wrap the ONE launcher file, never a
 *     committed fork. A forked copy diverges the moment someone edits the
 *     original, and a user on that channel silently gets stale behaviour.
 *
 *  2. COLD-START MANIFEST SYNC. The launcher answers `tools/list` from a
 *     built-in manifest before Restorm has booted (so an MCP client starts
 *     fast). That manifest mirrors ECUI's `McpService.registerBuiltinTools`.
 *     If a builtin tool is added there but not mirrored here, a user's AI
 *     never sees it until a live call refreshes the cache — an invisible gap.
 *     (App-domain tools — designs, scenarios, requests… — are NOT in the
 *     manifest; they arrive via the live tool list. Only the ECUI builtins
 *     are mirrored, so only those are compared.)
 */

const MONOREPO_ROOT = join(__dirname, '../../../')
const LAUNCHER = join(MONOREPO_ROOT, 'scripts/mcp-launcher.mjs')
const MCP_SERVICE = join(MONOREPO_ROOT, 'electron-core-ui/src/main/services/McpService.ts')
const APP_PKG = join(MONOREPO_ROOT, 'restorm/package.json')
const NPM_MCP_PKG = join(MONOREPO_ROOT, 'npm-mcp/package.json')
const NPM_MCP_GITIGNORE = join(MONOREPO_ROOT, 'npm-mcp/.gitignore')

/** Names registered by `McpService.registerBuiltinTools()` — parsed from the
 *  method body (from its signature to the next private method). */
function mcpServiceBuiltinToolNames(): string[] {
  const src = readFileSync(MCP_SERVICE, 'utf8')
  const start = src.indexOf('registerBuiltinTools(): void {')
  expect(start, 'registerBuiltinTools() not found in McpService.ts').toBeGreaterThan(-1)
  // The method ends at the next top-level `private ` member declaration.
  const after = src.slice(start + 1)
  const endRel = after.search(/\n {2}(?:private|public|static|async) /)
  const body = endRel === -1 ? after : after.slice(0, endRel)
  const names = [...body.matchAll(/registerTool\(\s*['"]([a-z-]+)['"]/g)].map((m) => m[1])
  return [...new Set(names)].sort()
}

/** Names in the launcher's `BUILTIN_TOOLS` array (the cold-start manifest). */
function launcherBuiltinToolNames(): string[] {
  const src = readFileSync(LAUNCHER, 'utf8')
  const start = src.indexOf('const BUILTIN_TOOLS = [')
  expect(start, 'BUILTIN_TOOLS not found in mcp-launcher.mjs').toBeGreaterThan(-1)
  // The array literal ends at the first line that is exactly `]` after it.
  const after = src.slice(start)
  const endRel = after.search(/\n\]/)
  const arr = endRel === -1 ? after : after.slice(0, endRel)
  const names = [...arr.matchAll(/name:\s*['"]([a-z-]+)['"]/g)].map((m) => m[1])
  return [...new Set(names)].sort()
}

describe('MCP launcher distribution — single source', () => {
  it('the app bundles the launcher by reference to the single source, not a copy', () => {
    const pkg = JSON.parse(readFileSync(APP_PKG, 'utf8')) as {
      build?: { extraResources?: { from: string; to: string }[] }
    }
    const entries = pkg.build?.extraResources ?? []
    const launcherEntry = entries.find((e) => e.to === 'restorm-resources/mcp-launcher.mjs')
    expect(launcherEntry, 'app must bundle the launcher as an extraResource').toBeDefined()
    // Points AT the single source (relative to restorm/), never a vendored copy.
    expect(launcherEntry?.from).toBe('../scripts/mcp-launcher.mjs')
  })

  it('the npm restorm-mcp package copies the single source at pack time, keeps no committed fork', () => {
    const pkg = JSON.parse(readFileSync(NPM_MCP_PKG, 'utf8')) as {
      name?: string
      bin?: Record<string, string>
      scripts?: Record<string, string>
    }
    expect(pkg.name).toBe('restorm-mcp')
    expect(pkg.bin?.['restorm-mcp']).toBe('mcp-launcher.mjs')
    // prepack copies from the single source…
    expect(pkg.scripts?.prepack ?? '').toContain('../scripts/mcp-launcher.mjs')
    // …and the copied artifact is gitignored, so no divergent fork can be committed.
    const ignore = readFileSync(NPM_MCP_GITIGNORE, 'utf8')
    expect(ignore).toMatch(/^mcp-launcher\.mjs$/m)
  })
})

describe('MCP launcher distribution — cold-start manifest sync', () => {
  it('the launcher BUILTIN_TOOLS manifest exactly mirrors McpService.registerBuiltinTools', () => {
    const fromService = mcpServiceBuiltinToolNames()
    const fromLauncher = launcherBuiltinToolNames()
    expect(fromService.length).toBeGreaterThan(0)
    // Exact match: a builtin added to McpService but not mirrored here (or a
    // stale entry left behind) fails the build instead of reaching users as an
    // invisible gap in the cold-start tool list.
    expect(fromLauncher).toEqual(fromService)
  })
})
