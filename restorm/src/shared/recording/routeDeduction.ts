/**
 * Route deduction — turns the raw calls captured during a recording session
 * into a tree of folders + route candidates, telling path PARAMETERS apart
 * from fixed path SEGMENTS.
 *
 * Pure and synchronous: the input is the light capture summary the main
 * process already holds (protocol, method, url, status, a few protocol
 * specifics), the output is a description the caller materialises into
 * real folders + requests. Nothing here knows about tree items.
 *
 * ## The central difficulty: is `123` a route or a parameter?
 *
 * Every url is split on `/` and folded into a trie per origin. Two nodes
 * with the same parent are candidates for being the SAME route with a
 * varying segment. The decision, per group of sibling segments, weighs:
 *
 * 1. **The value's shape** — an integer, a UUID, a long hex run
 *    (Mongo ids), or a long mixed token is an identifier on its own, and
 *    one occurrence is enough (`collapseSingletonIds`). A segment that
 *    merely *contains* a digit or is unusually long is a weak identifier
 *    and needs `paramThreshold` distinct values.
 * 2. **Cardinality + structural similarity** — plain words (`john`,
 *    `mary`) are treated as parameters only when at least
 *    `paramThreshold` distinct siblings share the SAME sub-shape (same
 *    methods, same child segments one level down) AND that shape is
 *    non-trivial (they have children). Two bare leaves `/api/users` and
 *    `/api/posts` look identical structurally, and collapsing them would
 *    erase two real resources — so bare leaves never collapse on words.
 * 3. **A short deny-list** of conventional static words (`me`, `new`,
 *    `search`, …) that are never parameters.
 *
 * A wrong "static" costs the user one duplicate request to merge; a wrong
 * "parameter" hides a whole resource. Every heuristic errs on static.
 *
 * ## Protocols without a REST path
 *
 * - GraphQL: one route per operation (type + name) on the endpoint.
 * - gRPC-web: the url is `/package.Service/Method` by construction, so the
 *   trie is bypassed — a folder per service, a route per method.
 * - WebSocket: one route per (socket url, message type).
 *
 * ## Folders
 *
 * Folders nest per STATIC segment of the template; parameter segments
 * create no folder, and a static segment that is a lone leaf (one request,
 * no sub-route) does not open one either. `api/users/{{userId}}/posts`
 * lives in api › users › posts; `api/comments` alone lives in api. When captures span several origins, each origin gets a top-level
 * folder named after its host.
 */

import type { RecordingProtocol } from '../types/recordingSession'

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** The light description of one captured call the deduction works from. */
export interface CaptureSummary {
  id: string
  protocol: RecordingProtocol
  /** Epoch milliseconds; orders the captures inside a route. */
  timestamp: number
  /** HTTP verb (upper-case). WebSocket captures carry `'WS'`. */
  method: string
  url: string
  /** Transport status when known (HTTP / GraphQL / gRPC-web). */
  status?: number
  /** GraphQL operation, when the protocol is `graphql`. */
  graphql?: { operationType: 'query' | 'mutation' | 'subscription'; operationName: string | null }
  /** gRPC-web service + method, when the protocol is `grpc-web`. */
  grpc?: { service: string; method: string }
  /** WebSocket message discriminant (a `type` / `event` field), when known. */
  websocket?: { messageType: string | null }
}

export interface DeductionOptions {
  /** Distinct sibling values needed before a weak identifier or a plain
   * word is treated as a path parameter. Default 2. */
  paramThreshold?: number
  /** Whether a single strongly-shaped identifier (integer, UUID, long hex)
   * is a parameter on its own. Default true. */
  collapseSingletonIds?: boolean
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type PathSegment =
  | { kind: 'static'; value: string }
  | { kind: 'param'; name: string; samples: string[] }

export interface DeducedPathParam {
  name: string
  /** Distinct observed values, in first-seen order. */
  samples: string[]
  /** The value the last successful (2xx) capture used — the prefill. */
  lastSuccessValue: string | null
}

export interface DeducedQueryParam {
  key: string
  samples: string[]
  /** `true` when every capture of the route carried the key. */
  alwaysPresent: boolean
  lastSuccessValue: string | null
}

export interface DeducedRoute {
  /**
   * Stable identity of the route across re-deductions: protocol + method +
   * origin + template (+ operation / message type). A later deduction
   * that finds the same key is the same route — the caller merges into
   * the existing request instead of creating a duplicate.
   */
  key: string
  protocol: RecordingProtocol
  method: string
  origin: string
  /** `/api/users/{{userId}}` — handlebars placeholders, as Restorm urls spell them. */
  template: string
  /** `origin + template`. */
  url: string
  segments: PathSegment[]
  pathParams: DeducedPathParam[]
  queryParams: DeducedQueryParam[]
  /** Suggested request name. */
  name: string
  /** Every contributing capture, chronological. */
  captureIds: string[]
  /** The last 2xx capture (falls back to the most recent one). */
  lastSuccessCaptureId: string | null
  graphql?: { operationType: 'query' | 'mutation' | 'subscription'; operationName: string | null }
  grpc?: { service: string; method: string }
  websocket?: { messageType: string | null }
}

export interface DeducedFolder {
  name: string
  folders: DeducedFolder[]
  routes: DeducedRoute[]
}

/** The root of the deduction: top-level folders + routes (a route whose
 * template has no static segment sits at the root). */
export interface DeducedTree {
  folders: DeducedFolder[]
  routes: DeducedRoute[]
}

// ---------------------------------------------------------------------------
// Segment classification
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INT_RE = /^-?\d+$/
const HEX_RE = /^[0-9a-f]{16,}$/i
const LONG_TOKEN_RE = /^[A-Za-z0-9_-]{24,}$/

/** Words that are conventional static segments and never parameters, even
 * when they sit next to identifiers. */
const STATIC_WORDS = new Set([
  'me', 'self', 'current', 'new', 'edit', 'search', 'count', 'all', 'latest', 'recent',
  'list', 'export', 'import', 'bulk', 'batch', 'stats', 'status', 'health', 'login', 'logout'
])

type SegmentClass = 'strong-id' | 'weak-id' | 'word'

export function classifySegment(segment: string): SegmentClass {
  if (STATIC_WORDS.has(segment.toLowerCase())) return 'word'
  if (INT_RE.test(segment) || UUID_RE.test(segment) || HEX_RE.test(segment)) return 'strong-id'
  if (LONG_TOKEN_RE.test(segment) && /\d/.test(segment) && /[A-Za-z]/.test(segment)) return 'strong-id'
  if (/\d/.test(segment) || segment.length >= 24 || segment.includes('@') || segment.includes('%')) return 'weak-id'
  if (/[a-z]/.test(segment) && /[A-Z]/.test(segment) && segment.length >= 8) return 'weak-id'
  return 'word'
}

/** `users` → `userId`, `categories` → `categoryId`, `` → `id`. */
export function paramNameFor(parentSegment: string | null): string {
  if (parentSegment === null || parentSegment === '') return 'id'
  const cleaned = parentSegment.replace(/[^A-Za-z0-9]+/g, ' ').trim()
  if (cleaned === '') return 'id'
  const words = cleaned.split(' ')
  const last = words[words.length - 1] ?? ''
  const singular = singularize(last)
  const camel = words.slice(0, -1).map((w, i) => i === 0 ? w.toLowerCase() : capitalize(w.toLowerCase())).join('')
  const stem = camel === '' ? singular.toLowerCase() : camel + capitalize(singular.toLowerCase())
  return `${stem}Id`
}

function singularize(word: string): string {
  const lower = word.toLowerCase()
  if (lower.endsWith('ies') && lower.length > 3) return word.slice(0, -3) + 'y'
  if (lower.endsWith('ses') || lower.endsWith('xes') || lower.endsWith('zes') || lower.endsWith('ches') || lower.endsWith('shes')) return word.slice(0, -2)
  if (lower.endsWith('s') && !lower.endsWith('ss') && lower.length > 1) return word.slice(0, -1)
  return word
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

// ---------------------------------------------------------------------------
// Trie
// ---------------------------------------------------------------------------

interface TrieNode {
  /** Static segment value, or `null` for a parameter node. */
  segment: string | null
  /** Raw values folded into this node when it is a parameter. */
  samples: string[]
  children: Map<string, TrieNode>
  /** Parameter child, once siblings have been collapsed. */
  paramChild: TrieNode | null
  /** Captures terminating here, keyed by their route discriminant. */
  captures: Map<string, CaptureSummary[]>
}

function newNode(segment: string | null): TrieNode {
  return { segment, samples: [], children: new Map(), paramChild: null, captures: new Map() }
}

function pathSegmentsOf(url: URL): string[] {
  return url.pathname.split('/').filter((s) => s !== '').map(safeDecode)
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** The discriminant that separates routes sharing one path. */
function methodKeyOf(capture: CaptureSummary): string {
  if (capture.protocol === 'graphql') {
    const op = capture.graphql
    return `graphql:${op?.operationType ?? 'query'}:${op?.operationName ?? ''}`
  }
  if (capture.protocol === 'websocket') {
    return `ws:${capture.websocket?.messageType ?? ''}`
  }
  return capture.method.toUpperCase()
}

function insert(root: TrieNode, segments: string[], capture: CaptureSummary): void {
  let node = root
  for (const segment of segments) {
    let child = node.children.get(segment)
    if (child === undefined) {
      child = newNode(segment)
      node.children.set(segment, child)
    }
    node = child
  }
  const key = methodKeyOf(capture)
  const list = node.captures.get(key)
  if (list) list.push(capture)
  else node.captures.set(key, [capture])
}

// ---------------------------------------------------------------------------
// Collapse
// ---------------------------------------------------------------------------

interface ResolvedOptions {
  paramThreshold: number
  collapseSingletonIds: boolean
}

/** Merge `source` into `target` (same logical node): captures, samples,
 * children (recursively) and parameter children. */
function mergeInto(target: TrieNode, source: TrieNode): void {
  for (const [key, list] of source.captures) {
    const existing = target.captures.get(key)
    if (existing) existing.push(...list)
    else target.captures.set(key, [...list])
  }
  for (const sample of source.samples) {
    if (!target.samples.includes(sample)) target.samples.push(sample)
  }
  for (const [segment, child] of source.children) {
    const existing = target.children.get(segment)
    if (existing) mergeInto(existing, child)
    else target.children.set(segment, child)
  }
  if (source.paramChild) {
    if (target.paramChild) mergeInto(target.paramChild, source.paramChild)
    else target.paramChild = source.paramChild
  }
}

/** One-level structural signature: the methods terminating at the node and
 * the names of its static children (+ whether it has a parameter child). */
function shapeOf(node: TrieNode): string {
  const methods = [...node.captures.keys()].sort()
  const children = [...node.children.keys()].sort()
  return JSON.stringify({ methods, children, param: node.paramChild !== null })
}

function isTrivialShape(node: TrieNode): boolean {
  return node.children.size === 0 && node.paramChild === null
}

/** Post-order: normalise the children first, then decide which siblings of
 * `node` are one parameter. */
function collapse(node: TrieNode, options: ResolvedOptions): void {
  for (const child of node.children.values()) collapse(child, options)
  if (node.paramChild) collapse(node.paramChild, options)

  const strong: string[] = []
  const weak: string[] = []
  const words: string[] = []
  for (const segment of node.children.keys()) {
    const cls = classifySegment(segment)
    if (cls === 'strong-id') strong.push(segment)
    else if (cls === 'weak-id') weak.push(segment)
    else words.push(segment)
  }

  const toCollapse: string[] = []
  if (strong.length > 0 && (options.collapseSingletonIds || strong.length >= options.paramThreshold)) {
    toCollapse.push(...strong)
  }
  if (weak.length >= options.paramThreshold || (weak.length > 0 && toCollapse.length > 0)) {
    // Weak identifiers ride along with strong ones (`/users/42` + `/users/u-7`)
    // or need the threshold on their own.
    toCollapse.push(...weak)
  }
  if (toCollapse.length === 0 && words.length >= options.paramThreshold && node.segment !== null) {
    // Plain words: only when they all share a non-trivial one-level shape.
    const firstWord = words[0]
    const first = firstWord === undefined ? undefined : node.children.get(firstWord)
    if (first !== undefined && !isTrivialShape(first)) {
      const shape = shapeOf(first)
      const alike = words.every((w) => {
        const sibling = node.children.get(w)
        return sibling !== undefined && shapeOf(sibling) === shape
      })
      if (alike) toCollapse.push(...words)
    }
  }

  if (toCollapse.length === 0) return

  const param = node.paramChild ?? newNode(null)
  for (const segment of toCollapse) {
    const child = node.children.get(segment)
    if (child === undefined) continue
    node.children.delete(segment)
    if (!param.samples.includes(segment)) param.samples.push(segment)
    mergeInto(param, child)
  }
  node.paramChild = param
  // The merge may have brought new sibling groups together under the
  // parameter node (`/users/1/posts/7` + `/users/2/posts/9`).
  collapse(param, options)
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

function isSuccess(capture: CaptureSummary): boolean {
  return capture.status !== undefined && capture.status >= 200 && capture.status < 300
}

function lastSuccessOf(captures: CaptureSummary[]): CaptureSummary | null {
  for (let i = captures.length - 1; i >= 0; i--) {
    const c = captures[i]
    if (c !== undefined && isSuccess(c)) return c
  }
  return captures[captures.length - 1] ?? null
}

function queryParamsOf(captures: CaptureSummary[], lastSuccess: CaptureSummary | null): DeducedQueryParam[] {
  const seen = new Map<string, { samples: string[]; count: number }>()
  const successValues = new Map<string, string>()
  for (const capture of captures) {
    const url = tryParseUrl(capture.url)
    if (url === null) continue
    const keysInThisCapture = new Set<string>()
    for (const [key, value] of url.searchParams) {
      let entry = seen.get(key)
      if (!entry) {
        entry = { samples: [], count: 0 }
        seen.set(key, entry)
      }
      if (!entry.samples.includes(value) && entry.samples.length < 20) entry.samples.push(value)
      if (!keysInThisCapture.has(key)) {
        entry.count++
        keysInThisCapture.add(key)
      }
      if (capture === lastSuccess) successValues.set(key, value)
    }
  }
  return [...seen.entries()].map(([key, entry]) => ({
    key,
    samples: entry.samples,
    alwaysPresent: entry.count === captures.length,
    lastSuccessValue: successValues.get(key) ?? null
  }))
}

function tryParseUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/** The raw value a capture used at a parameter position. */
function segmentValueAt(capture: CaptureSummary, index: number): string | null {
  const url = tryParseUrl(capture.url)
  if (url === null) return null
  return pathSegmentsOf(url)[index] ?? null
}

interface EmitContext {
  options: ResolvedOptions
}

/** A WebSocket bucket without a message type is a socket seen without a
 *  recognisable message (closed before its first message, a reconnect…). Next
 *  to a typed bucket on the same url it is the same endpoint, not a second
 *  route: fold it into the first typed bucket. Alone, it stays a route. */
function foldUntypedWebSocket(node: TrieNode): void {
  const untyped = node.captures.get('ws:')
  if (untyped === undefined) return
  const typedKey = [...node.captures.keys()].find((key) => key.startsWith('ws:') && key !== 'ws:')
  if (typedKey === undefined) return
  node.captures.get(typedKey)?.push(...untyped)
  node.captures.delete('ws:')
}

function emitRoutes(node: TrieNode, segments: PathSegment[], folder: DeducedFolder, ctx: EmitContext): void {
  foldUntypedWebSocket(node)
  for (const [methodKey, list] of node.captures) {
    const captures = [...list].sort((a, b) => a.timestamp - b.timestamp)
    const lastSuccess = lastSuccessOf(captures)
    const template = '/' + segments.map((s) => s.kind === 'static' ? encodeSegment(s.value) : `{{${s.name}}}`).join('/')
    const pathParams: DeducedPathParam[] = []
    segments.forEach((segment, index) => {
      if (segment.kind !== 'param') return
      const samples: string[] = []
      for (const capture of captures) {
        const value = segmentValueAt(capture, index)
        if (value !== null && !samples.includes(value)) samples.push(value)
      }
      const successValue = lastSuccess ? segmentValueAt(lastSuccess, index) : null
      pathParams.push({ name: segment.name, samples, lastSuccessValue: successValue })
    })
    const first = captures[0]
    if (first === undefined) continue
    const protocol = first.protocol
    const origin = originOf(first)
    const route: DeducedRoute = {
      key: `${protocol}|${methodKey}|${origin}${template}`,
      protocol,
      method: first.method.toUpperCase(),
      origin,
      template,
      url: origin + template,
      segments,
      pathParams,
      queryParams: queryParamsOf(captures, lastSuccess),
      name: routeName(protocol, methodKey, first, template),
      captureIds: captures.map((c) => c.id),
      lastSuccessCaptureId: lastSuccess?.id ?? null,
      ...(first.graphql !== undefined && { graphql: first.graphql }),
      ...(first.websocket !== undefined && { websocket: first.websocket })
    }
    folder.routes.push(route)
  }

  for (const [segment, child] of [...node.children.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // A static segment opens a folder when it is a PREFIX of other routes or
    // hosts several routes itself; a lone leaf (`/assets/app.js`,
    // `/api/comments`) stays in its parent's folder — one request does not
    // deserve a folder of its own.
    foldUntypedWebSocket(child)
    const opensFolder = !isTrivialShape(child) || child.captures.size > 1
    const sub = opensFolder ? ensureFolder(folder, segment) : folder
    emitRoutes(child, [...segments, { kind: 'static', value: segment }], sub, ctx)
  }
  if (node.paramChild) {
    const parentStatic = [...segments].reverse().find((s) => s.kind === 'static')
    const base = paramNameFor(parentStatic?.kind === 'static' ? parentStatic.value : null)
    const name = uniqueParamName(base, segments)
    emitRoutes(node.paramChild, [...segments, { kind: 'param', name, samples: node.paramChild.samples }], folder, ctx)
  }
}

function uniqueParamName(base: string, segments: PathSegment[]): string {
  const taken = new Set(segments.filter((s): s is Extract<PathSegment, { kind: 'param' }> => s.kind === 'param').map((s) => s.name))
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}${i}`)) i++
  return `${base}${i}`
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(/%3A/gi, ':').replace(/%40/g, '@').replace(/%2C/gi, ',')
}

function routeName(protocol: RecordingProtocol, methodKey: string, first: CaptureSummary, template: string): string {
  if (protocol === 'graphql') {
    const op = first.graphql
    const label = op?.operationName ?? (op?.operationType ?? 'query')
    return op?.operationName ? label : `${label} ${template}`
  }
  if (protocol === 'websocket') {
    const type = first.websocket?.messageType
    return type ? `WS ${template} · ${type}` : `WS ${template}`
  }
  void methodKey
  return `${first.method.toUpperCase()} ${template}`
}

function ensureFolder(parent: DeducedFolder, name: string): DeducedFolder {
  const existing = parent.folders.find((f) => f.name === name)
  if (existing) return existing
  const created: DeducedFolder = { name, folders: [], routes: [] }
  parent.folders.push(created)
  return created
}

/** Drop folders that hold nothing (a static prefix with no terminating call
 * still needs to exist as a path, but an empty folder chain adds noise). */
function pruneEmpty(folder: DeducedFolder): boolean {
  folder.folders = folder.folders.filter((f) => pruneEmpty(f))
  return folder.folders.length > 0 || folder.routes.length > 0
}

// ---------------------------------------------------------------------------
// gRPC-web
// ---------------------------------------------------------------------------

function emitGrpc(captures: CaptureSummary[], root: DeducedFolder): void {
  const byRoute = new Map<string, CaptureSummary[]>()
  for (const capture of captures) {
    const url = tryParseUrl(capture.url)
    const segments = url ? pathSegmentsOf(url) : []
    const service = capture.grpc?.service ?? segments[segments.length - 2] ?? 'grpc'
    const method = capture.grpc?.method ?? segments[segments.length - 1] ?? 'call'
    const key = `${service}/${method}`
    const list = byRoute.get(key)
    if (list) list.push(capture)
    else byRoute.set(key, [capture])
  }
  for (const [key, list] of [...byRoute.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const captures = [...list].sort((a, b) => a.timestamp - b.timestamp)
    const [service, method] = key.split('/') as [string, string]
    const lastSuccess = lastSuccessOf(captures)
    const firstCapture = captures[0]
    const origin = firstCapture === undefined ? '' : originOf(firstCapture)
    const url = firstCapture === undefined ? null : tryParseUrl(firstCapture.url)
    const prefix = url ? pathSegmentsOf(url).slice(0, -2) : []
    let folder = root
    for (const segment of prefix) folder = ensureFolder(folder, segment)
    folder = ensureFolder(folder, service)
    const template = '/' + [...prefix, service, method].map(encodeSegment).join('/')
    folder.routes.push({
      key: `grpc-web|POST|${origin}${template}`,
      protocol: 'grpc-web',
      method: 'POST',
      origin,
      template,
      url: origin + template,
      segments: [...prefix, service, method].map((value) => ({ kind: 'static' as const, value })),
      pathParams: [],
      queryParams: [],
      name: `${service}.${method}`,
      captureIds: captures.map((c) => c.id),
      lastSuccessCaptureId: lastSuccess?.id ?? null,
      grpc: { service, method }
    })
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function deduceRoutes(captures: readonly CaptureSummary[], options: DeductionOptions = {}): DeducedTree {
  const resolved: ResolvedOptions = {
    paramThreshold: Math.max(1, options.paramThreshold ?? 2),
    collapseSingletonIds: options.collapseSingletonIds ?? true
  }

  // One bucket per HOST: a site's `http://` and `ws://` (or `https://`)
  // calls are one site for the user, not two origins deserving two folders.
  // Each route still keeps the origin (scheme included) of its own captures.
  const byHost = new Map<string, { trie: TrieNode; grpc: CaptureSummary[] }>()
  for (const capture of captures) {
    const url = tryParseUrl(capture.url)
    if (url === null) continue
    let bucket = byHost.get(url.host)
    if (!bucket) {
      bucket = { trie: newNode(null), grpc: [] }
      byHost.set(url.host, bucket)
    }
    if (capture.protocol === 'grpc-web') bucket.grpc.push(capture)
    else insert(bucket.trie, pathSegmentsOf(url), capture)
  }

  const hosts = [...byHost.keys()].sort()
  const tree: DeducedTree = { folders: [], routes: [] }
  for (const host of hosts) {
    const bucket = byHost.get(host)
    if (bucket === undefined) continue
    collapse(bucket.trie, resolved)
    const target: DeducedFolder = hosts.length > 1
      ? ensureFolder({ name: '', folders: tree.folders, routes: tree.routes }, host)
      : { name: '', folders: tree.folders, routes: tree.routes }
    emitRoutes(bucket.trie, [], target, { options: resolved })
    emitGrpc(bucket.grpc, target)
    target.folders = target.folders.filter((f) => pruneEmpty(f))
    if (hosts.length === 1) {
      tree.folders = target.folders
      tree.routes = target.routes
    }
  }
  return tree
}

/** The origin (scheme + host) a capture was made against. */
function originOf(capture: CaptureSummary): string {
  const url = tryParseUrl(capture.url)
  if (url === null) return ''
  return url.origin === 'null' ? `${url.protocol}//${url.host}` : url.origin
}

/** Every route of a tree, depth-first — handy for tests and for the merge. */
export function flattenRoutes(tree: DeducedTree | DeducedFolder): DeducedRoute[] {
  const out: DeducedRoute[] = [...tree.routes]
  for (const folder of tree.folders) out.push(...flattenRoutes(folder))
  return out
}
