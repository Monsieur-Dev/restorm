import type { FolderItem, Request } from '../types/collections'
import {
  isEnvironmentFolder, isAnyFolder, isScenario,
  isHTTPRequest, isGraphQLRequest, isSoapRequest, isWebSocketRequest,
  isODataRequest, isAuthenticationRequest, isGrpcRequest
} from '../types/collections'
import type { FirewallOrigin } from '../types/firewall'

/**
 * Walk the project tree, collect every request's URL, resolve any `{{var}}`
 * references against the available environments, and extract the deduped set of
 * `(scheme, host, port)` origins.
 *
 * The main-process `PermissionService` uses this set as one of its three "known
 * destination" sources, so a request to a project URL doesn't trigger a firewall
 * prompt. Shared so BOTH the renderer hook (`useFirewallProjectOriginsSync`,
 * which pushes the result over IPC) AND the headless CLI (which has no renderer
 * and sets it on `permissionService` directly) derive origins identically.
 *
 * Substitution is a simple `{{key}}` → value pass; if a URL still has unresolved
 * variables we skip it (can't infer an origin from a parametric host).
 */
export function collectProjectOrigins(rootItems: FolderItem[]): FirewallOrigin[] {
  const requests = collectRequests(rootItems)
  const envContexts = collectEnvironmentContexts(rootItems)
  const seen = new Map<string, FirewallOrigin>()
  for (const request of requests) {
    const rawUrl = extractRawUrl(request)
    if (rawUrl === null) continue
    // No env vars referenced → evaluate once; otherwise try every env context
    // (a template may render to several hosts depending on the active env).
    const candidates = rawUrl.includes('{{') && envContexts.length > 0
      ? envContexts.map((ctx) => substitute(rawUrl, ctx))
      : [rawUrl]
    // Add a no-substitution attempt too in case the URL is fully literal.
    if (!candidates.includes(rawUrl)) candidates.push(rawUrl)
    for (const candidate of candidates) {
      const origin = parseOrigin(candidate)
      if (origin === null) continue
      const key = `${origin.scheme}://${origin.host}:${String(origin.port)}`
      if (!seen.has(key)) seen.set(key, origin)
    }
  }
  return Array.from(seen.values())
}

function collectRequests(items: FolderItem[]): Request[] {
  const out: Request[] = []
  const visit = (item: FolderItem): void => {
    if (isAnyFolder(item) || isEnvironmentFolder(item)) {
      for (const child of item.items) visit(child)
      return
    }
    // A scenario is a folder-like container too: requests authored INSIDE it
    // (`scenario.items`) must be collected like any other request, else a
    // request nested under a scenario isn't recognised as a known origin and the
    // firewall prompts for it. Recurse into its children (which may include
    // sub-scenarios), then stop — the scenario itself has no URL.
    if (isScenario(item)) {
      for (const child of item.items ?? []) visit(child)
      return
    }
    if (isHTTPRequest(item) || isGraphQLRequest(item) || isSoapRequest(item) || isWebSocketRequest(item) || isODataRequest(item) || isAuthenticationRequest(item) || isGrpcRequest(item)) {
      out.push(item as Request)
    }
  }
  for (const item of items) visit(item)
  return out
}

type EnvContext = Record<string, string>

function collectEnvironmentContexts(items: FolderItem[]): EnvContext[] {
  const out: EnvContext[] = []
  const visit = (item: FolderItem): void => {
    if (isEnvironmentFolder(item)) {
      const envs = Array.isArray(item.environments) ? item.environments : []
      for (const env of envs) {
        const ctx: EnvContext = {}
        const vars = Array.isArray(env.variables) ? env.variables : []
        for (const v of vars) {
          if (typeof v.key !== 'string') continue
          const str = extractValueString(v.value)
          if (str !== '') ctx[v.key] = str
        }
        out.push(ctx)
      }
      for (const child of item.items) visit(child)
      return
    }
    if (isAnyFolder(item)) {
      for (const child of item.items) visit(child)
    }
  }
  for (const item of items) visit(item)
  return out
}

/**
 * Coerce a `KeyValue.value` of unknown shape (live `ValueType` instance, POJO
 * `{ type, value }`, raw string) into the plain string the origin sync needs.
 */
function extractValueString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    const inner = (value as { value?: unknown }).value
    if (typeof inner === 'string') return inner
    const toStr = (value as { toString?: () => string }).toString
    if (typeof toStr === 'function' && toStr !== Object.prototype.toString) {
      return toStr.call(value)
    }
  }
  return ''
}

function extractRawUrl(request: Request): string | null {
  const r = request as { url?: unknown; baseUrl?: unknown; endpoint?: unknown }
  for (const candidate of [r.url, r.baseUrl, r.endpoint]) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return null
}

function substitute(input: string, ctx: EnvContext): string {
  return input.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key: string) => {
    const value = ctx[key]
    return typeof value === 'string' ? value : match
  })
}

function parseOrigin(rawUrl: string): FirewallOrigin | null {
  if (rawUrl.includes('{{')) return null  // unresolved variable, can't infer host
  let candidate = rawUrl.trim()
  if (candidate.length === 0) return null
  if (!candidate.includes('://')) candidate = `http://${candidate}`
  let parsed: URL
  try { parsed = new URL(candidate) } catch { return null }
  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase()
  if (parsed.hostname.length === 0) return null
  const defaultPort = scheme === 'https' || scheme === 'wss' ? 443 : 80
  const port = parsed.port !== '' ? Number(parsed.port) : defaultPort
  if (!Number.isFinite(port) || port < 0 || port > 65535) return null
  return { scheme, host: parsed.hostname.toLowerCase(), port }
}
