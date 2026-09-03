import { useSyncExternalStore } from 'react'
import type { ApiDesign, DesignProtocol, FolderItem, EnvironmentFolder, Request } from '../../../shared/types/collections'
import type { ApiDocumentation } from '../../../shared/types/apiDocumentation'
import { designSectionRowId } from '../../../shared/design/designSections'
import { apiKeyHeaderName } from '../../../shared/design/designServing'
import { designToGraphqlSdl } from '../../../shared/design/graphqlProjection'
import { processAfterDeserialization } from '../utils/serialization'
import { reidentifyForest } from '../../../shared/utils/reidentifyTree'
import { resolveUrlAgainstEnv, flattenEnvVars, coerceEnvVarValue } from '../../../shared/utils/resolveUrlAgainstEnv'
import { findOperationForRoute } from '../../../shared/utils/findOperationForRoute'
import { routeFromRequest } from '../hooks/routeFromRequest'

/**
 * Transient "clients" generated for a served design. When the mock server
 * starts we import its OWN metadata endpoints (the dogfood loop) — one bundle
 * per served protocol — and hold the parsed request trees HERE only. They are
 * never written to the .restorm file and are dropped when the server stops.
 */
export interface ClientBundle {
  protocol: DesignProtocol
  /** Freshly-reidentified request tree — safe to render + open, never saved. */
  items: FolderItem[]
}

const EMPTY: ClientBundle[] = []
const byDesignId = new Map<string, ClientBundle[]>()
const subscribers = new Set<() => void>()
let version = 0

function notify(): void {
  version += 1
  for (const sub of subscribers) sub()
}

export function getDesignClients(designId: string): ClientBundle[] {
  return byDesignId.get(designId) ?? EMPTY
}

export function subscribeDesignClients(cb: () => void): () => void {
  subscribers.add(cb)
  return () => { subscribers.delete(cb) }
}

/** Monotonic version — feeds the sidebar's `useSyncExternalStore` snapshot so
 *  the tree re-renders when any design's clients (re)generate or clear. */
export function getDesignClientsVersion(): number {
  return version
}

const CLIENT_ROW_PREFIX = 'design-client:'

/** Sidebar row id for a transient client node (folder or request). Not a tree
 *  item — these live only in the client store's view model. */
export function designClientRowId(designId: string, itemId: string): string {
  return `${CLIENT_ROW_PREFIX}${designId}:${itemId}`
}

/** Parse a client row id back to `{ designId, itemId }`, or `null`. */
export function parseDesignClientRowId(rowId: string): { designId: string; itemId: string } | null {
  if (!rowId.startsWith(CLIENT_ROW_PREFIX)) return null
  const rest = rowId.slice(CLIENT_ROW_PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep <= 0) return null
  return { designId: rest.slice(0, sep), itemId: rest.slice(sep + 1) }
}

/** The transient client REQUEST with `itemId` under `designId`, or `undefined`
 *  when the id is a folder / unknown — used to open a tab on row click. */
export function findClientRequest(designId: string, itemId: string): FolderItem | undefined {
  const walk = (items: FolderItem[]): FolderItem | undefined => {
    for (const item of items) {
      const children = (item as { items?: FolderItem[] }).items
      if (Array.isArray(children)) {
        const hit = walk(children)
        if (hit) return hit
      } else if (item.id === itemId) {
        return item
      }
    }
    return undefined
  }
  for (const bundle of getDesignClients(designId)) {
    const hit = walk(bundle.items)
    if (hit) return hit
  }
  return undefined
}

/** Ids of every transient client REQUEST flagged deprecated (across all designs)
 *  — merged into the sidebar's deprecated set so those rows dim like a
 *  deprecated imported request. */
export function getDesignClientsDeprecatedIds(): Set<string> {
  const out = new Set<string>()
  const walk = (items: FolderItem[]): void => {
    for (const item of items) {
      const children = (item as { items?: FolderItem[] }).items
      if (Array.isArray(children)) { walk(children); continue }
      if ((item as { deprecated?: boolean }).deprecated === true) out.add(item.id)
    }
  }
  for (const bundles of byDesignId.values()) {
    for (const bundle of bundles) walk(bundle.items)
  }
  return out
}

/** Live client bundles for a design — re-renders when they (re)generate or clear. */
export function useDesignClients(designId: string): ClientBundle[] {
  return useSyncExternalStore(subscribeDesignClients, () => getDesignClients(designId))
}

/** App-registered closer for the tabs a client request opened — invoked for
 *  every transient request when its design's clients are dropped. */
let tabCloser: ((requestId: string) => void) | null = null
export function setClientTabCloser(fn: ((requestId: string) => void) | null): void {
  tabCloser = fn
}

/** App-registered opener — the workbench's `openAnyRequestTab` bound to the
 *  no-environment, synthetic-breadcrumb form these transient requests need
 *  (their URLs are already baked absolute). Lets the Clients PAGE open a client
 *  in a tab without threading the workbench tab API down through the design
 *  tab. Mirrors {@link setClientTabCloser}. */
interface ClientTabBreadcrumb { id: string; label: string }
type ClientTabOpener = (request: FolderItem, breadcrumbs: ClientTabBreadcrumb[], rowId: string) => void
let tabOpener: ClientTabOpener | null = null
export function setClientTabOpener(fn: ClientTabOpener | null): void {
  tabOpener = fn
}

/** Open a transient client request in a workbench tab via the app-registered
 *  opener — no-op when nothing is registered yet. `rowId` is the sidebar row id
 *  (`design-client:…`) so the opener can also select + reveal it in the tree. */
export function openDesignClientTab(request: FolderItem, breadcrumbs: ClientTabBreadcrumb[], rowId: string): void {
  tabOpener?.(request, breadcrumbs, rowId)
}

/** Sidebar row ids to expand so a client row (its prefixed `rowId`) is REVEALED:
 *  the design node, its Clients section, the protocol folder, and any
 *  intermediate request-group folders on the path down to the leaf. Lets the
 *  Clients PAGE select a client and have the sidebar scroll it into view even
 *  when its branch was collapsed. */
export function designClientRowAncestorIds(rowId: string): string[] {
  const parsed = parseDesignClientRowId(rowId)
  if (parsed === null) return []
  const { designId, itemId } = parsed
  const ids: string[] = [designId, designSectionRowId(designId, 'clients')]
  const findPath = (items: FolderItem[], acc: string[]): string[] | null => {
    for (const item of items) {
      const children = (item as { items?: FolderItem[] }).items
      if (Array.isArray(children)) {
        const hit = findPath(children, [...acc, item.id])
        if (hit !== null) return hit
      } else if (item.id === itemId) {
        return acc
      }
    }
    return null
  }
  for (const bundle of getDesignClients(designId)) {
    const path = findPath(bundle.items, [])
    if (path !== null) {
      ids.push(designClientRowId(designId, `proto:${bundle.protocol}`))
      for (const folderId of path) ids.push(designClientRowId(designId, folderId))
      break
    }
  }
  return ids
}

/** The protocol + intermediate folder names on the path down to a client leaf —
 *  lets a client tab's breadcrumb mirror the sidebar (Design / Clients /
 *  <protocol> / <folder…>) instead of stopping at the design name. */
export function designClientBreadcrumbSegments(
  rowId: string
): { protocol: DesignProtocol; folders: { id: string; name: string }[] } | null {
  const parsed = parseDesignClientRowId(rowId)
  if (parsed === null) return null
  const { designId, itemId } = parsed
  const findPath = (items: FolderItem[], acc: { id: string; name: string }[]): { id: string; name: string }[] | null => {
    for (const item of items) {
      const children = (item as { items?: FolderItem[] }).items
      if (Array.isArray(children)) {
        const hit = findPath(children, [...acc, { id: item.id, name: (item as { name?: string }).name ?? '' }])
        if (hit !== null) return hit
      } else if (item.id === itemId) {
        return acc
      }
    }
    return null
  }
  for (const bundle of getDesignClients(designId)) {
    const folders = findPath(bundle.items, [])
    if (folders !== null) return { protocol: bundle.protocol, folders }
  }
  return null
}

/** Drop a design's generated clients (server stopped / a fresh regenerate),
 *  closing any tabs they opened. */
export function clearDesignClients(designId: string): void {
  const openedIds = designClientRequestIds(designId)
  if (byDesignId.delete(designId)) {
    notify()
    if (tabCloser) for (const id of openedIds) tabCloser(id)
  }
}

/** Every transient request id currently held for a design — for closing the
 *  tabs they opened when the server stops. */
export function designClientRequestIds(designId: string): string[] {
  const ids: string[] = []
  const collect = (items: FolderItem[]): void => {
    for (const item of items) {
      if ('items' in item && Array.isArray((item as { items?: FolderItem[] }).items)) {
        collect((item as { items: FolderItem[] }).items)
      } else {
        ids.push(item.id)
      }
    }
  }
  for (const bundle of getDesignClients(designId)) collect(bundle.items)
  return ids
}

// ── Import pipeline ───────────────────────────────────────────────────────

/** The metadata endpoint each protocol exposes on the served port. HTTP uses
 *  the root `/swagger.json` alias (always reachable, no base path, no auth);
 *  the projections sit at their fixed paths. gRPC (reflection on a separate
 *  port) is handled elsewhere. */
function metadataUrl(protocol: DesignProtocol, port: number): string | null {
  const base = `http://127.0.0.1:${String(port)}`
  switch (protocol) {
    case 'http': return `${base}/swagger.json`
    case 'graphql': return `${base}/graphql`
    case 'soap': return `${base}/soap?wsdl`
    case 'odata': return `${base}/odata/$metadata`
    default: return null
  }
}

/** A sample credential satisfying the design's default-auth PRESENCE check, so
 *  the gated projections (graphql/soap/odata) can be introspected. The HTTP
 *  descriptor is ungated and needs none. `undefined` when auth is off. */
function sampleAuthHeaders(design: ApiDesign): Record<string, string> | undefined {
  switch (design.defaultAuth ?? 'none') {
    case 'bearer': return { Authorization: 'Bearer restorm-sample-token' }
    case 'basic': return { Authorization: `Basic ${btoa('restorm:sample')}` }
    case 'apiKeyHeader': return { [apiKeyHeaderName(design)]: 'restorm-sample-key' }
    default: return undefined
  }
}

async function importProtocol(
  protocol: DesignProtocol,
  port: number,
  design: ApiDesign,
  extraHeaders: Record<string, string> | undefined
): Promise<FolderItem[]> {
  // GraphQL: a plain GET on /graphql returns the GraphiQL playground, not the
  // schema. Import the design's own SDL instead (identical to what the server
  // serves) — the generated graphql requests then point at the live endpoint.
  let result
  if (protocol === 'graphql') {
    result = await window.restorm?.import.preview(designToGraphqlSdl(design))
  } else {
    const url = metadataUrl(protocol, port)
    if (url === null) return []
    result = await window.restorm?.import.preview(url, extraHeaders ? { extraHeaders } : undefined)
  }
  if (result?.success !== true || !Array.isArray(result.items) || result.items.length === 0) {
    return []
  }
  // Rehydrate class instances, then reidentify IN PLACE with fresh ids so the
  // transient tree can never collide with a persisted item.
  const items = processAfterDeserialization(result.items as FolderItem[])
  reidentifyForest(items)
  // Resolve `{{baseUrl}}` (and any other import-env variable) to a LITERAL so
  // the client requests carry the real served URL — no hidden env, no chance
  // of colliding with a variable in the user's env folder. Path params like
  // `{{id}}` are not in the env, so resolveUrlAgainstEnv leaves them untouched.
  // GraphQL's SDL import has no env, so we point `{{baseUrl}}` at the endpoint.
  const vars = protocol === 'graphql'
    ? { baseUrl: `http://127.0.0.1:${String(port)}/graphql` }
    : importEnvVars(items)
  resolveClientUrls(items, vars)
  markDeprecatedClients(items)
  return unwrapImport(items)
}

/** Before the env-folder wrapper is dropped, use its imported apiDocumentation
 *  to stamp `deprecated: true` on every client request that maps to a deprecated
 *  operation — the design route's deprecation, carried through the served
 *  /swagger.json. The transient tree keeps the flag so the sidebar dims the row
 *  and the tab shows the deprecation callout, exactly like an imported request
 *  (whose deprecation is otherwise derived live from its folder's apiDoc, which
 *  these transient clients don't keep). */
function markDeprecatedClients(items: FolderItem[]): void {
  const apiDoc = (items[0] as { apiDocumentation?: ApiDocumentation }).apiDocumentation
  if (apiDoc === undefined) return
  const walk = (nodes: FolderItem[]): void => {
    for (const node of nodes) {
      const children = (node as { items?: FolderItem[] }).items
      if (Array.isArray(children)) { walk(children); continue }
      const op = findOperationForRoute(apiDoc, routeFromRequest(node as Request))
      if (op?.deprecated === true) (node as { deprecated?: boolean }).deprecated = true
    }
  }
  walk(items)
}

/** OpenAPI / GraphQL / SOAP imports wrap everything in one env-folder named
 *  after the API. Drop that single wrapper so the protocol folder holds the
 *  request groups (or requests) directly, one level shallower. */
function unwrapImport(items: FolderItem[]): FolderItem[] {
  if (items.length === 1) {
    const children = (items[0] as { items?: FolderItem[] }).items
    if (Array.isArray(children)) return children
  }
  return items
}

/** The import wrapper's env, flattened to a `{{var}} -> value` map (its
 *  `baseUrl` points at the served address; Swagger composes it from
 *  scheme/host/port sub-vars, hence flattenEnvVars). */
function importEnvVars(items: FolderItem[]): Record<string, string> {
  const env = (items[0] as Partial<EnvironmentFolder>).environments?.[0]
  if (env === undefined) return {}
  const raw: Record<string, string> = {}
  for (const variable of env.variables) {
    if (variable.enabled === false) continue
    const coerced = coerceEnvVarValue(variable.value)
    if (coerced !== undefined) raw[variable.key] = coerced
  }
  return flattenEnvVars(raw)
}

/** Bake the import-env variables into every request URL, in place. */
function resolveClientUrls(items: FolderItem[], vars: Record<string, string>): void {
  if (Object.keys(vars).length === 0) return
  for (const item of items) {
    const children = (item as { items?: FolderItem[] }).items
    if (Array.isArray(children)) {
      resolveClientUrls(children, vars)
    } else {
      const req = item as { url?: unknown }
      if (typeof req.url === 'string') req.url = resolveUrlAgainstEnv(req.url, vars)
    }
  }
}

/**
 * Import the served design's metadata for every enabled protocol and stash the
 * resulting client trees. HTTP is always served, so it is always imported;
 * the ungated descriptor means the HTTP bundle survives even when the auth
 * credential guess is wrong for the projections.
 */
/** gRPC clients come from the served reflection service on the design's
 *  separate gRPC port — the generated grpc-requests already carry the reflected
 *  address, so no URL resolution is needed. */
async function importGrpc(grpcPort: number): Promise<FolderItem[]> {
  const result = await window.restorm?.grpc.reflectImport({ address: `127.0.0.1:${String(grpcPort)}` })
  if (result?.success !== true || result.folder === undefined) return []
  const items = processAfterDeserialization([result.folder] as FolderItem[])
  reidentifyForest(items)
  return unwrapImport(items)
}

export async function generateDesignClients(design: ApiDesign, port: number): Promise<void> {
  const enabled = new Set<DesignProtocol>(['http', ...(design.serving?.protocols ?? [])])
  const headers = sampleAuthHeaders(design)
  const bundles: ClientBundle[] = []
  for (const protocol of ['http', 'graphql', 'soap', 'odata'] as const) {
    if (!enabled.has(protocol)) continue
    // Only the projections are auth-gated; the HTTP descriptor is open.
    const items = await importProtocol(protocol, port, design, protocol === 'http' ? undefined : headers)
    if (items.length > 0) bundles.push({ protocol, items })
  }
  // gRPC lives on its own port + reflection channel, discovered from status.
  if (enabled.has('grpc')) {
    const status = await window.restorm?.designServer.status(design.id)
    if (status?.grpcPort !== undefined) {
      const items = await importGrpc(status.grpcPort)
      if (items.length > 0) bundles.push({ protocol: 'grpc', items })
    }
  }
  byDesignId.set(design.id, bundles)
  notify()
}
