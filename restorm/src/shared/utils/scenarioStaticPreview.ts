import Handlebars from 'handlebars'
import { registerHandlebarsHelpers } from './handlebars/registerAll'
import type { ScenarioNode, ScenarioEdge } from '../types/scenario'
import { readInputParams } from '../scenarioInputParams'
import { readOutputDecls } from '../scenarioOutputDecls'
import { STATIC_PREVIEW_KINDS } from '../scenarioNodeCapabilities'
import { compareValues as compareValuesShared } from '../scenarioComparison'
import { castValue, isScenarioCastType } from '../scenarioCast'
import { applyRegex, isRegexOp } from '../scenarioRegex'
import { applyJson, isJsonOp } from '../scenarioJson'
import { applyXml, isXmlOp } from '../scenarioXml'
import { applyYaml, isYamlOp } from '../scenarioYaml'
import { applyCrypto, isCryptoOp } from '../scenarioCrypto'
import { applyJwt } from '../scenarioJwt'
import { applyDateTime, isDateTimeOp, isDateTimeUnit } from '../scenarioDateTime'
import { applyObjectOp, isObjectOp } from '../scenarioObject'
import { applyUrl, isUrlOp } from '../scenarioUrl'
import { applyRandom, isRandomOp } from '../scenarioRandom'
import { applyListOp as applyListReshape, isListOp } from '../scenarioList'
import { applyCsv, isCsvOp } from '../scenarioCsv'
import { applyMath, isMathOp } from '../scenarioMath'
import { validateAgainstSchema } from '../schemaValidate'
import { LIST_MUTATION_DEFAULT_VALUE_ID } from '../scenarioListMutationValues'

// Register the full helper suite on first import so a chained `transform`
// preview can use `{{year now}}`, `{{add a b}}`, `{{upper x}}`, … directly —
// same surface the runtime exposes. The helper module is idempotent.
registerHandlebarsHelpers()

// Node kinds whose inspector preview is derived directly from their config (no
// run / no play needed) — sourced from the per-kind capability table (the
// single source of truth) and re-exported so existing importers keep working.
export { STATIC_PREVIEW_KINDS }

/** The minimal node + edge shapes the static-preview resolvers read. */
export interface StaticPreviewNode {
  id: string
  kind: ScenarioNode['kind']
  config: Record<string, unknown>
}
export interface StaticPreviewEdge {
  from: { nodeId: string; portId: string }
  to: { nodeId: string; portId: string }
  selector?: string
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** A persisted typed value (the on-disk `{ type, value, … }` shape) → a
 * concrete JS value: numbers/booleans keep their type; everything else renders
 * to a string. Self-contained so the module is usable from both renderer and
 * main (which loads scenarios from disk as plain JSON, never as instantiated
 * `ValueType` instances). */
/** Renderer-injected resolver turning an environment id into its preview shape
 * `{ name, variables }`, mirroring the runtime. The preview lives in shared
 * code that can't reach the renderer's env store, so the renderer registers a
 * lookup once; when absent (e.g. main-process callers), an environment operand
 * falls back to its `{{$id}}` template. */
let environmentPreviewResolver: ((envId: string) => unknown) | null = null
export function setEnvironmentPreviewResolver(fn: ((envId: string) => unknown) | null): void {
  environmentPreviewResolver = fn
}

/** Resolves a custom value list's label → its substituted value (e.g. the
 * "Pet Colors" list maps `Rouge` → `FF0000`). Set by the renderer (from the
 * live store) and by the headless engine (from the loaded project) so a
 * `customList` / `customListMulti` resolves to its VALUE everywhere — the
 * dispatch semantic — rather than the bare label. Returns `undefined` when the
 * list / label is unknown (callers fall back to the label). */
let customListResolver: ((listId: string, label: string) => string | undefined) | null = null
export function setCustomListResolver(fn: ((listId: string, label: string) => string | undefined) | null): void {
  customListResolver = fn
}

/** The value behind a custom-list label, or the label itself when there's no
 * resolver / no match (so a registry-less context — unit tests, a preview
 * before the project loads — still renders something sensible). */
function customListValueOrLabel(listId: unknown, label: unknown): string {
  const lbl = typeof label === 'string' ? label : ''
  if (customListResolver === null || typeof listId !== 'string') return lbl
  return customListResolver(listId, lbl) ?? lbl
}

/** Resolves a `SecretValue`'s `(source, params)` to its plaintext for the
 * inspector's static preview. Secret resolution is asynchronous (a main-process
 * IPC), so the renderer installs a SYNCHRONOUS lookup over a cache it fills in
 * the background: a cache HIT returns the plaintext; a MISS returns `undefined`
 * (the preview shows `''` for that pass) AND lets the resolver kick off the
 * async fetch + trigger a re-render once it lands — exactly the "render '' first,
 * fill in next frame" behaviour of the environment preview. Absent (main-process
 * / unit-test callers) → a secret operand stays empty, never leaking plaintext
 * into a context that shouldn't have it. */
let secretPreviewResolver: ((source: string, params: Record<string, unknown>) => string | undefined) | null = null
export function setSecretPreviewResolver(
  fn: ((source: string, params: Record<string, unknown>) => string | undefined) | null
): void {
  secretPreviewResolver = fn
}

export function concreteValue(persisted: unknown): unknown {
  if (persisted === null || persisted === undefined) return null
  if (typeof persisted !== 'object') return persisted
  const p = persisted as { type?: unknown; value?: unknown; label?: unknown; labels?: unknown }
  switch (p.type) {
    case 'null':
      return null
    case 'list': {
      // A `list` is a real JS array — each item resolved recursively (lists nest).
      const items = (p as { items?: unknown }).items
      return Array.isArray(items) ? items.map((it) => concreteValue(it)) : []
    }
    case 'numeric': {
      const n = typeof p.value === 'number' ? p.value : Number(p.value)
      return Number.isFinite(n) ? n : 0
    }
    case 'boolean':
      return p.value === true || p.value === 'true'
    case 'customList':
      return customListValueOrLabel((p as { listId?: unknown }).listId, p.label)
    case 'customListMulti':
      return Array.isArray(p.labels)
        ? p.labels
            .filter((v): v is string => typeof v === 'string')
            .map((lbl) => customListValueOrLabel((p as { listId?: unknown }).listId, lbl))
            .join(',')
        : ''
    case 'variable':
      return typeof p.value === 'string' ? `{{${p.value}}}` : ''
    case 'environment': {
      // No environment selected yet → no value (null), not a `{{$}}` template
      // with an empty id. A selected-but-unresolved id keeps its `{{$id}}` form
      // (mirrors how a `variable` operand renders `{{name}}`).
      if (typeof p.value !== 'string' || p.value === '') return null
      const resolved = environmentPreviewResolver?.(p.value)
      return resolved !== undefined ? resolved : `{{$${p.value}}}`
    }
    case 'secret': {
      // A persisted secret carries only `{ source, params }` (the plaintext is
      // never on disk), so there's no `value` to render. Ask the renderer's
      // resolver for the live plaintext; a cache miss / no resolver → `''`
      // (filled on a later pass once the async resolve lands).
      const source = (p as { source?: unknown }).source
      const params = (p as { params?: unknown }).params
      if (secretPreviewResolver === null || typeof source !== 'string') return ''
      return secretPreviewResolver(source, params && typeof params === 'object' ? (params as Record<string, unknown>) : {}) ?? ''
    }
    // 'string' | 'expression' | 'color' | 'datetime' | 'enum' |
    // 'enumList' | unknown — value carries the renderable string.
    default:
      if (typeof p.value === 'string') return p.value
      if (typeof p.value === 'number' || typeof p.value === 'boolean') return p.value
      return ''
  }
}

/** Target inputs whose semantic is "consume the source's whole object" (not a
 * drilled-in primitive) — the JSON-path auto-deduce defaults to the identity
 * selector `.` (or the source's single top-level key when there's only one),
 * so the upstream object flows through as-is. */
export function expectsObjectInput(targetKind: ScenarioNode['kind'], targetPortId: string): boolean {
  return (
    (targetKind === 'transform' && targetPortId === 'value')
    || (targetKind === 'log' && targetPortId === 'data')
  )
}

/** Kinds whose output token genuinely IS the wrapper object their preview
 * models — `transform` emits `{ result }`, `input` emits `{ <name>: value }`.
 * For these the wrapper must NOT be unwrapped (the downstream selector drills
 * into it). Every other static-preview kind emits the BARE value, with the
 * preview key only a display label. */
const PREVIEW_WRAPPER_KINDS = new Set<ScenarioNode['kind']>(['transform', 'input', 'object'])

/**
 * The runtime VALUE a given output port carries, unwrapped from the preview's
 * display object.
 *
 * The preview wraps each output under a meaningful name for the inspector tree,
 * but most nodes emit the BARE value on the port — so a downstream selector /
 * preview must unwrap it (else it deduces the wrapper's KEY, e.g. `result` or
 * the variable name, as the path — wrong, since the token already IS that
 * value). Unwrap when the port id is a key (`arithmetic` → `{ result }`,
 * `filter` → `{ kept, rejected }`) or when the wrapper is a single display-named
 * entry (`now` → `{ now }`, `getVariable` → `{ <var> }`). The genuine wrappers
 * (`transform`, `input`, `object` — see {@link PREVIEW_WRAPPER_KINDS}) are
 * returned unchanged: their token IS the object (so a single-property object
 * isn't mistaken for a single display-named wrapper and unwrapped to its value).
 */
export function portPreviewValue(preview: Record<string, unknown>, portId: string, kind?: ScenarioNode['kind']): unknown {
  if (kind !== undefined && PREVIEW_WRAPPER_KINDS.has(kind)) return preview
  if (portId in preview) return preview[portId]
  const keys = Object.keys(preview)
  const only = keys.length === 1 ? keys[0] : undefined
  return only !== undefined ? preview[only] : preview
}

/** If the value is an object with exactly one top-level key, return that key.
 * Used by the JSON-path auto-deduce on object-input ports: a source with a
 * single top-level property is unambiguous (use that property), otherwise we
 * fall back to the identity selector `.`. */
export function singleTopLevelKey(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const keys = Object.keys(value as Record<string, unknown>)
  return keys.length === 1 ? keys[0] ?? null : null
}

/** If a preview object resolves to a single primitive value through a chain of
 * single-property objects, return its dot-path — otherwise null. Used to
 * auto-fill a data link's selector when the source's output is unambiguous:
 * `{ timer: 5 }` → `"timer"`; `{ foo: { bar: { hello: "x" } } }` →
 * `"foo.bar.hello"`; anything with a branch, an array, or 0 keys → null. */
export function singleDeepPath(value: unknown): string | null {
  const segments: string[] = []
  let cur: unknown = value
  // Guard against pathological / cyclic structures.
  for (let depth = 0; depth < 64; depth++) {
    // An array leaf isn't auto-deducible (must end on a primitive).
    if (Array.isArray(cur)) return null
    if (cur === null || typeof cur !== 'object') {
      // Reached a primitive leaf — valid only if we descended at least once.
      return segments.length > 0 ? segments.join('.') : null
    }
    const entries = Object.entries(cur as Record<string, unknown>)
    if (entries.length !== 1) return null
    const entry = entries[0]
    if (entry === undefined) return null
    segments.push(entry[0])
    cur = entry[1]
  }
  return null
}

/** Try to parse a string as JSON (object or array). Returns `undefined` for
 * non-JSON strings. Used while walking selectors so an HTTP response body
 * stored as a raw JSON string (the runtime keeps it stringified) is drilled
 * into transparently — same trick the picker tree applies. */
function maybeParseJson(value: string): unknown {
  const t = value.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return undefined
  try {
    const parsed: unknown = JSON.parse(t)
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Walk a JSON-path selector (dot fields, `[index]`, `['key']`) into a value.
 * Transparently parses any string segment that's a JSON object/array so
 * `response.body.data.…` works whether `body` is already an object or still
 * a JSON-encoded string. */
export function resolveSelectorPath(value: unknown, path: string): unknown {
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\['([^']*)'\]/g, '.$1')
    .replace(/\["([^"]*)"\]/g, '.$1')
    .split('.')
    .filter(Boolean)
  let cur: unknown = value
  for (const seg of segments) {
    if (typeof cur === 'string') {
      const parsed = maybeParseJson(cur)
      if (parsed === undefined) return undefined
      cur = parsed
    }
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

const VARIABLE_RESOLVE_MAX_DEPTH = 16

/** Does `node` WRITE the variable `name`? A `setVariable(name)`, OR an
 * `addToList`/`removeFromList` whose `list` target IS the variable `name` and
 * which has `updateSourceVariable` on (it pushes its `result` back into that
 * variable). */
function writesVariable(node: StaticPreviewNode, name: string): boolean {
  if (node.kind === 'setVariable') return str(node.config['name']) === name
  if (node.kind === 'addToList' || node.kind === 'removeFromList') {
    if (node.config['updateSourceVariable'] !== true) return false
    const ref = node.config['list'] as { type?: unknown; value?: unknown } | null | undefined
    return ref?.type === 'variable' && typeof ref.value === 'string' && ref.value.trim() === name
  }
  return false
}

/** Walk BACKWARD from `consumerNodeId` along incoming edges (the execution
 * ancestry) to the NEAREST node WRITING `name` (see {@link writesVariable}) —
 * the "dominating assignment" closest to where the variable is read. Returns it,
 * or null when no upstream writer exists (e.g. the variable is an input param,
 * or set on a parallel branch). BFS, so nearest-by-hops wins; a visited set
 * guards cycles (loop-backs). */
function nearestUpstreamWriter(
  name: string,
  consumerNodeId: string,
  nodes: readonly StaticPreviewNode[],
  edges: readonly StaticPreviewEdge[]
): StaticPreviewNode | null {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const visited = new Set<string>([consumerNodeId])
  let frontier = edges.filter((e) => e.to.nodeId === consumerNodeId).map((e) => e.from.nodeId)
  let hops = 0
  while (frontier.length > 0 && hops < 1024) {
    hops += 1
    const next: string[] = []
    for (const nid of frontier) {
      if (visited.has(nid)) continue
      visited.add(nid)
      const node = nodeById.get(nid)
      if (node && writesVariable(node, name)) return node
      for (const e of edges) if (e.to.nodeId === nid && !visited.has(e.from.nodeId)) next.push(e.from.nodeId)
    }
    frontier = next
  }
  return null
}

/** Resolve a variable's STATIC value AT a given consumer node, following the
 * graph: the nearest upstream writer of `name` is evaluated — a `setVariable`'s
 * value (literal or wired source preview), or a push-mutation's `result` (an
 * addToList/removeFromList writing the variable). Falls back to the order-less
 * global map (input params / off-path setVariables) when no upstream writer is
 * found. `depth` bounds a chain of variable→variable references. */
function resolveVariableAt(
  name: string,
  consumerNodeId: string,
  nodes: readonly StaticPreviewNode[],
  edges: readonly StaticPreviewEdge[],
  depth: number
): unknown {
  if (depth >= VARIABLE_RESOLVE_MAX_DEPTH) return globalVariableValue(name, nodes, edges)
  const writer = nearestUpstreamWriter(name, consumerNodeId, nodes, edges)
  if (!writer) return globalVariableValue(name, nodes, edges)
  // A push-mutation (addToList/removeFromList) writes its `result` output into
  // the variable; a setVariable writes its `value` input. Evaluate accordingly.
  if (writer.kind === 'addToList' || writer.kind === 'removeFromList') {
    const sp = staticScenarioPreview(writer, nodes, edges)
    return sp === null ? globalVariableValue(name, nodes, edges) : portPreviewValue(sp, 'result', writer.kind)
  }
  // A list-typed LITERAL value (customListMulti / enumList) resolves to its ARRAY
  // — mirrors the runtime `resolveOperand` — so list comparisons / contains see a
  // real list, not the joined display string `concreteValue` would render.
  const litArray = listValueArray(writer.config['value'])
  if (litArray) return litArray
  return operandPreviewValue(writer.id, 'value', writer.config['value'], nodes, edges, depth + 1)
}

/** A variable's value from the UP-FRONT scope only — an `input` param, or a
 * predecessor-LESS `setVariable` (one that runs at the very start). A mid-flow
 * setVariable (its `in` or `value` is wired) is NOT globally available: it only
 * resolves DOWNSTREAM of itself via {@link nearestUpstreamWriter}, so a read
 * placed BEFORE it (the writer isn't a predecessor) correctly sees nothing
 * instead of the future value. */
function globalVariableValue(name: string, nodes: readonly StaticPreviewNode[], edges: readonly StaticPreviewEdge[]): unknown {
  for (const n of nodes) {
    if (n.kind === 'input') {
      for (const p of readInputParams(n.config)) {
        if (p.name.trim() === name) return listValueArray(p.valueType) ?? concreteValue(p.valueType)
      }
    } else if (n.kind === 'setVariable' && str(n.config['name']) === name) {
      const hasPredecessor = edges.some((e) => e.to.nodeId === n.id && (e.to.portId === 'in' || e.to.portId === 'value'))
      if (!hasPredecessor) return listValueArray(n.config['value']) ?? concreteValue(n.config['value'])
    }
  }
  return undefined
}

/** Resolve the `items` input of a list-operating box (`map`/`filter`/
 * `aggregate`) to a plain JS array — either by reading a static upstream
 * source (selector applied) or by extracting a config literal of a list-typed
 * `ValueType` (`enumList` / `customListMulti`). Returns `null` when the array
 * isn't statically resolvable (wired to a non-static source, etc.). */
export function resolveItems(
  nodeId: string,
  cfg: Record<string, unknown>,
  nodes: readonly StaticPreviewNode[],
  edges: readonly StaticPreviewEdge[]
): unknown[] | null {
  const edge = edges.find((e) => e.to.nodeId === nodeId && e.to.portId === 'items')
  if (edge) {
    const source = nodes.find((n) => n.id === edge.from.nodeId)
    if (!source || !STATIC_PREVIEW_KINDS.has(source.kind)) return null
    const sp = staticScenarioPreview(source, nodes, edges)
    if (sp === null) return null
    // Unwrap to the value the SOURCE PORT carries before applying the selector
    // (a `result`/`mapped`-keyed node exposes `{ result: [...] }` as its preview;
    // the wired `items` link's selector — typically `.` for an array — is
    // relative to that port's bare value, exactly as the runtime delivers it).
    // Applying the selector to the whole `{ result: … }` wrapper instead yielded
    // the wrapper object (not an array) → `null` → an empty inspector preview.
    const portValue = portPreviewValue(sp, edge.from.portId, source.kind)
    const v = edge.selector ? resolveSelectorPath(portValue, edge.selector) : portValue
    return Array.isArray(v) ? v : null
  }
  const lit = literalConfigItems(cfg)
  if (lit) return lit
  // An inline `variable` items resolves to that variable's STATIC value,
  // following the graph (nearest upstream `setVariable`) — so an aggregate over
  // a variable built by a chain (object→addToList→setVariable) previews the real
  // list, not nothing.
  const raw = cfg['items'] as { type?: unknown; value?: unknown } | null | undefined
  if (raw && typeof raw === 'object' && raw.type === 'variable' && typeof raw.value === 'string') {
    const v = resolveVariableAt(raw.value, nodeId, nodes, edges, 0)
    if (Array.isArray(v)) return v as unknown[]
  }
  return null
}

/** Resolve a list box's `items` from its CONFIG literal alone (no wired
 * edge): a `customListMulti` yields its picked labels, an `enumList` its
 * values. Returns `null` when the config carries no literal list. Shared
 * by the static preview AND the runtime executors (`forEach` / `map` /
 * `filter` / `aggregate`) so an unwired list box iterates over its
 * configured items instead of nothing. */
export function literalConfigItems(cfg: Record<string, unknown>): unknown[] | null {
  return listValueArray(cfg['items'])
}

/** The ARRAY form of a list-typed value: a `customListMulti` yields its picked
 * labels, an `enumList` its values. `null` for anything else. A multi-select IS
 * a list, so this is its data representation — distinct from `concreteValue`,
 * which joins it to a display string. */
export function listValueArray(v: unknown): unknown[] | null {
  if (v && typeof v === 'object') {
    const p = v as { type?: unknown; listId?: unknown; labels?: unknown; value?: unknown }
    // A multi-select resolves each picked label to its custom-list VALUE (the
    // dispatch semantic), mirroring `concreteValue`'s scalar path.
    if (p.type === 'customListMulti' && Array.isArray(p.labels)) {
      return p.labels.map((lbl) => customListValueOrLabel(p.listId, lbl))
    }
    if (p.type === 'enumList' && Array.isArray(p.value)) return p.value as unknown[]
  }
  return null
}

/** Runtime `items` resolution for the list boxes (`forEach` / `map` / `filter`
 * / `aggregate`): a literal list value, OR a `variable` reference whose LIVE
 * value is an array (so `setVariable list → aggregate over that variable`
 * works). `null` when nothing list-like is configured. The variable arm needs
 * the run's `variables`; the static preview passes none and gets the literal
 * arm only. */
export function resolveConfigItems(cfg: Record<string, unknown>, variables?: ReadonlyMap<string, unknown>): unknown[] | null {
  const lit = listValueArray(cfg['items'])
  if (lit) return lit
  const raw = cfg['items']
  // An inline `list` value → its concrete array (each item resolved). Lets an
  // `aggregate`/`forEach`/`map`/`filter` iterate a list authored directly in
  // the `items` field, not only one stashed in a variable.
  if (raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'list') {
    const arr = concreteValue(raw)
    if (Array.isArray(arr)) return arr as unknown[]
  }
  if (raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'variable' && variables) {
    const name = (raw as { value?: unknown }).value
    const v = typeof name === 'string' ? variables.get(name) : undefined
    if (Array.isArray(v)) return v as unknown[]
  }
  return null
}

/** Stringify a value for the `aggregate.join` op without tripping ESLint's
 * `no-base-to-string` rule on plain objects. */
function joinPart(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  try { return JSON.stringify(v) } catch { return '' }
}

/** Compute the preview output of a list-operating box (`map` / `filter` /
 * `aggregate`) given an already-resolved items array. Pulled out of the main
 * `staticScenarioPreview` switch so the inspector can call it with a runtime-
 * fetched items array (e.g. items wired to an `httpRequest`'s response body)
 * — the static path can't know that array on its own, but once the inspector
 * has it the rest of the computation is identical. */
export function applyListOp(
  node: StaticPreviewNode,
  items: unknown[]
): Record<string, unknown> | null {
  const cfg = node.config
  if (node.kind === 'map') {
    const expr = cfg['expression'] as { value?: unknown } | undefined
    const template = typeof expr?.value === 'string' ? expr.value : ''
    if (template === '') return { mapped: items }
    try {
      const compiled = Handlebars.compile(template, { noEscape: true })
      const mapped = items.map((item) => {
        try { return compiled(item ?? {}) }
        catch { return null }
      })
      return { mapped }
    } catch {
      return null
    }
  }
  if (node.kind === 'filter') {
    const field = typeof cfg['field'] === 'string' ? cfg['field'] : ''
    const op = typeof cfg['operator'] === 'string' ? cfg['operator'] : '='
    const compareTo = concreteValue(cfg['value'])
    const kept: unknown[] = []
    const rejected: unknown[] = []
    for (const item of items) {
      const left = field ? resolveSelectorPath(item, field) : item
      if (compareValues(op, left, compareTo) === true) kept.push(item)
      else rejected.push(item)
    }
    return { kept, rejected }
  }
  if (node.kind === 'aggregate') {
    const op = typeof cfg['op'] === 'string' ? cfg['op'] : 'count'
    const field = typeof cfg['field'] === 'string' ? cfg['field'] : ''
    const separator = typeof cfg['separator'] === 'string' ? cfg['separator'] : ','
    const valueOf = (item: unknown): unknown => field ? resolveSelectorPath(item, field) : item
    if (op === 'count') return { result: items.length }
    if (op === 'join') return { result: items.map((item) => joinPart(valueOf(item))).join(separator) }
    // sum/min/max/average require EVERY item to be a number (a numeric string is
    // accepted). A non-numeric value — a boolean, an object, an empty/garbage
    // string, or an invalid `field` path that yields nothing — is a genuine
    // mistake, so THROW rather than silently coercing (boolean true → 1) or
    // skipping. The runtime routes the throw to the error port; the preview
    // catches it and shows no (misleading) result.
    const nums = items.map((item) => {
      const raw = valueOf(item)
      const n = strictAggregateNumber(raw)
      if (n === null) throw new Error(`Cannot ${op} a non-numeric value: ${aggregateValueLabel(raw)}`)
      return n
    })
    if (op === 'sum') return { result: nums.reduce((a, b) => a + b, 0) }
    if (op === 'min') return { result: nums.length === 0 ? null : Math.min(...nums) }
    if (op === 'max') return { result: nums.length === 0 ? null : Math.max(...nums) }
    if (op === 'average') return { result: nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length }
  }
  if (node.kind === 'forEach') {
    // `forEach`'s ports are signal-only (`each` / `done`) — no data flows
    // out — so the inspector summary is a sizing readout: how many items
    // will fire `each`, in how many parallel batches.
    const total = items.length
    const parRaw = cfg['parallelism']
    const par = parRaw && typeof parRaw === 'object' ? parRaw as Record<string, unknown> : null
    const enabled = par?.['enabled'] === true
    const rawCount = par?.['count']
    const itemsPerBatch = enabled && typeof rawCount === 'number' && rawCount >= 2 ? Math.floor(rawCount) : 1
    const batches = total === 0 ? 0 : Math.ceil(total / itemsPerBatch)
    return { totalItems: total, itemsPerBatch, batches }
  }
  if (node.kind === 'for') {
    // A numeric-range forEach: count the `for i = from; i <op> to; i += step`
    // iterations (ignoring `items` — the range comes from config) and report
    // the iteration / batch sizing readout.
    const num = (v: unknown, fallback: number): number => asNumber(concreteValue(v)) ?? fallback
    const from = num(cfg['from'], 0)
    const to = num(cfg['to'], 0)
    const stepRaw = num(cfg['step'], 1)
    const step = stepRaw === 0 ? 1 : stepRaw
    const op = typeof cfg['operator'] === 'string' ? cfg['operator'] : '<'
    let total = 0
    if (Number.isFinite(from) && Number.isFinite(to)) {
      for (let i = from; compareValues(op, i, to) === true && total < 100_000; i += step) total += 1
    }
    const parRaw = cfg['parallelism']
    const par = parRaw && typeof parRaw === 'object' ? parRaw as Record<string, unknown> : null
    const enabled = par?.['enabled'] === true
    const rawCount = par?.['count']
    const itemsPerBatch = enabled && typeof rawCount === 'number' && rawCount >= 2 ? Math.floor(rawCount) : 1
    const batches = total === 0 ? 0 : Math.ceil(total / itemsPerBatch)
    return { totalItems: total, itemsPerBatch, batches }
  }
  return null
}

/** Preview helper for single-port "pass-through" boxes (`wait` / `waitUntil`):
 * surface `{ <portId>: <value> }` so the inspector can show what the box is
 * waiting on. Wired to a static source → resolved value (selector applied);
 * wired to a non-static source (httpRequest…) → `null` placeholder that the
 * inspector overrides asynchronously via `getWiredFetches`; unwired → use
 * the literal config (returns `null` overall when nothing meaningful exists). */
function previewSinglePortPassThrough(
  nodeId: string,
  portId: string,
  configLiteral: unknown,
  nodes: readonly StaticPreviewNode[],
  edges: readonly StaticPreviewEdge[]
): Record<string, unknown> | null {
  const edge = edges.find((e) => e.to.nodeId === nodeId && e.to.portId === portId)
  if (edge) {
    const source = nodes.find((n) => n.id === edge.from.nodeId)
    if (source && STATIC_PREVIEW_KINDS.has(source.kind)) {
      const sp = staticScenarioPreview(source, nodes, edges)
      if (sp === null) return null
      const v = edge.selector ? resolveSelectorPath(sp, edge.selector) : sp
      return v === undefined || v === null ? null : { [portId]: v }
    }
    // Wired to a non-static source — placeholder the inspector will fill in.
    return { [portId]: null }
  }
  const lit = concreteValue(configLiteral)
  return lit === undefined || lit === null || lit === '' ? null : { [portId]: lit }
}

/** The effective value reaching an operand port: from its wired source's
 * static preview (selector applied) when wired to a static-preview box, or the
 * config literal when unwired. `undefined` = wired to a non-static source
 * (e.g. an httpRequest) — the caller has no preview to compute on. */
function operandPreviewValue(
  nodeId: string,
  portId: string,
  configLiteral: unknown,
  nodes: readonly StaticPreviewNode[],
  edges: readonly StaticPreviewEdge[],
  depth = 0
): unknown {
  const edge = edges.find((e) => e.to.nodeId === nodeId && e.to.portId === portId)
  if (!edge) {
    // An inline `variable` operand resolves to that variable's STATIC value,
    // following the graph: the nearest upstream `setVariable` wins (so a variable
    // built by a chain — object→addToList→setVariable — previews the real list),
    // not the order-less global map. Otherwise an operand fed by a variable makes
    // the whole node's preview NaN/null (a downstream box has nothing to suggest).
    const lit = configLiteral as { type?: unknown; value?: unknown } | null | undefined
    if (lit !== null && typeof lit === 'object' && lit.type === 'variable' && typeof lit.value === 'string') {
      return resolveVariableAt(lit.value, nodeId, nodes, edges, depth)
    }
    return concreteValue(configLiteral)
  }
  const source = nodes.find((n) => n.id === edge.from.nodeId)
  if (!source || !STATIC_PREVIEW_KINDS.has(source.kind)) return undefined
  const sourcePreview = staticScenarioPreview(source, nodes, edges)
  if (sourcePreview === null) return undefined
  // Unwrap to the value the SOURCE PORT actually carries before applying the
  // selector, so a `result`-keyed node feeds its bare value (matching runtime),
  // not the `{ result: … }` display wrapper.
  const portValue = portPreviewValue(sourcePreview, edge.from.portId, source.kind)
  return edge.selector ? resolveSelectorPath(portValue, edge.selector) : portValue
}

/** Apply a comparator-style operator (`<`/`≤`/`=`/`≥`/`>`/`≠`/`contains`) to two
 * resolved values for the inspector preview. Delegates to the SHARED
 * `compareValues` — the SAME implementation the runtime uses, so the preview
 * can't drift — catching its throws: the shared comparator errors on undefined
 * orderings (null/object ordering, mixed types), but the preview wants `null` to
 * drop the preview rather than surface an error. Shared by `comparator` / `if` /
 * `filter` / `for` / `switch` / `assert`. */
function compareValues(op: string, a: unknown, b: unknown): boolean | null {
  try {
    return compareValuesShared(op, a, b)
  } catch {
    return null
  }
}

/** Coerce a preview value to a finite number for arithmetic / numeric
 * comparison. Strings that parse cleanly are accepted; everything else → null
 * (the caller drops the preview). */
function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  if (typeof v === 'boolean') return v ? 1 : 0
  return null
}

/** STRICT numeric coercion for aggregate sum/min/max/average: a number or a
 * clean numeric string only. Unlike {@link asNumber} it does NOT coerce a
 * boolean (true → 1) and rejects an empty string — those are non-numeric and
 * must surface as an error, not a silent 1/0. `null` = not a number. Exported so
 * the runtime aggregate executor shares the SAME rule as the preview. */
export function strictAggregateNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** A short, safe label for a non-numeric value in an aggregate error message. */
export function aggregateValueLabel(v: unknown): string {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  if (typeof v === 'string') return `"${v}"`
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  try { const s = JSON.stringify(v); return typeof s === 'string' ? s : 'value' } catch { return 'value' }
}

/**
 * The config-derived preview output for a box, or null when the kind isn't a
 * static-preview kind (it needs a run / upstream data instead). Every output is
 * an **object**: the box's value(s) keyed by a meaningful name, so the inspector
 * tree reads `name → value` like a real run result.
 */
export function staticScenarioPreview(
  node: StaticPreviewNode,
  nodes: readonly StaticPreviewNode[],
  edges: readonly StaticPreviewEdge[]
): Record<string, unknown> | null {
  const cfg = node.config
  switch (node.kind) {
    case 'now': {
      // `format` decides the JS type emitted: a real Date (Handlebars helpers
      // can operate on it), an epoch number, or a timezone-formatted string.
      // The static preview matches the runtime so the inspector + chained
      // transforms see the same shape.
      const format = typeof cfg['format'] === 'string' ? cfg['format'] : 'datetime'
      const localTz = (() => { try { return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } })()
      const tz = typeof cfg['timezone'] === 'string' && cfg['timezone'] !== '' ? cfg['timezone'] : localTz
      const d = new Date()
      if (format === 'epoch') return { now: d.getTime() }
      if (format === 'datetime') return { now: d }
      // string — UTC ISO by default, otherwise the IANA timezone format. A
      // bogus zone falls back to ISO so the preview never breaks.
      if (tz === 'UTC' || tz === '') return { now: d.toISOString() }
      try {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d)
        return { now: `${parts} (${tz})` }
      } catch {
        return { now: d.toISOString() }
      }
    }
    case 'input': {
      // The input emits one object keyed by EACH declared param's name, with
      // that param's typed default as the example value.
      const out: Record<string, unknown> = {}
      for (const param of readInputParams(cfg)) {
        out[param.name.trim() || 'value'] = concreteValue(param.valueType)
      }
      return out
    }
    case 'setVariable': {
      const name = str(cfg['name'])
      return name ? { [name]: concreteValue(cfg['value']) } : null
    }
    case 'getVariable': {
      const ref = cfg['value'] as { type?: unknown; value?: unknown } | undefined
      const name = ref?.type === 'variable' && typeof ref.value === 'string' ? ref.value : ''
      if (!name) return null
      // Resolve the variable AT this getVariable, following the graph (nearest
      // upstream setVariable), so reading a variable built mid-flow previews its
      // real value rather than only an up-front literal.
      return { [name]: resolveVariableAt(name, node.id, nodes, edges, 0) ?? null }
    }
    case 'arithmetic': {
      const a = operandPreviewValue(node.id, 'a', cfg['a'], nodes, edges)
      const b = operandPreviewValue(node.id, 'b', cfg['b'], nodes, edges)
      if (a === undefined || b === undefined) return null
      const na = asNumber(a); const nb = asNumber(b)
      if (na === null || nb === null) return null
      const op = typeof cfg['operator'] === 'string' ? cfg['operator'] : '+'
      let r: number
      switch (op) {
        case '+': r = na + nb; break
        case '−': r = na - nb; break
        case '×': r = na * nb; break
        case '÷': if (nb === 0) return null; r = na / nb; break
        case '%': if (nb === 0) return null; r = na % nb; break
        default: r = na + nb
      }
      return Number.isFinite(r) ? { result: r } : null
    }
    case 'comparator': {
      const a = operandPreviewValue(node.id, 'a', cfg['a'], nodes, edges)
      const b = operandPreviewValue(node.id, 'b', cfg['b'], nodes, edges)
      if (a === undefined || b === undefined) return null
      const op = typeof cfg['operator'] === 'string' ? cfg['operator'] : '='
      const r = compareValues(op, a, b)
      return r === null ? null : { result: r }
    }
    case 'map':
    case 'filter':
    case 'aggregate':
    case 'forEach': {
      const items = resolveItems(node.id, cfg, nodes, edges)
      if (items === null) return null
      // An aggregate over non-numeric values THROWS — catch it so the inspector
      // shows no result instead of crashing (the runtime surfaces it on `error`).
      try {
        return applyListOp({ id: node.id, kind: node.kind, config: cfg }, items)
      } catch {
        return null
      }
    }
    case 'addToList':
    case 'removeFromList': {
      // `list` resolves like any operand (a list literal, an enum/custom list,
      // or a list-typed variable's static value → an array). `values` is N rows
      // (`config.values` = `{ id, value }[]`, like object properties) — each one
      // an element to add/remove, resolved under its own port id.
      const listV = operandPreviewValue(node.id, 'list', cfg['list'], nodes, edges)
      const list: unknown[] = Array.isArray(listV) ? (listV as unknown[]) : []
      let valueRows = Array.isArray(cfg['values']) && cfg['values'].length > 0 ? cfg['values'] : []
      // The DEFAULT (unpersisted) value row carries a wired source under
      // LIST_MUTATION_DEFAULT_VALUE_ID without ever landing in `config.values`;
      // surface it so a lone wired value previews (matches the runtime).
      if (valueRows.length === 0 && edges.some((e) => e.to.nodeId === node.id && e.to.portId === LIST_MUTATION_DEFAULT_VALUE_ID)) {
        valueRows = [{ id: LIST_MUTATION_DEFAULT_VALUE_ID }]
      }
      const values: unknown[] = []
      for (const r of valueRows) {
        const row = r as { id?: unknown; value?: unknown }
        if (typeof row.id !== 'string') continue
        const v = operandPreviewValue(node.id, row.id, row.value, nodes, edges)
        // A list-valued row is CONCATENATED (spread), matching the runtime — so
        // adding a list to a list appends its elements, not a nested list.
        if (Array.isArray(v)) values.push(...(v as unknown[]))
        else if (v !== undefined) values.push(v)
      }
      const result = node.kind === 'addToList'
        ? [...list, ...values]
        : list.filter((x) => !values.some((v) => JSON.stringify(v) === JSON.stringify(x)))
      return { result }
    }
    case 'for':
      // Range comes from config (`from`/`to`/`step`), not an `items` edge —
      // `applyListOp` ignores the passed list for `for`.
      return applyListOp({ id: node.id, kind: node.kind, config: cfg }, [])
    case 'log': {
      // Terminal sink — no output port, but the inspector summarises what
      // would be logged so the user can sanity-check the level + payload.
      // Wired non-static inputs land as `null` placeholders that the inspector
      // overrides via `getObjectWiredProperties` + `getScenarioNodeResult`.
      // `timestamp` is computed at render-time so the user sees a current ISO
      // date next to the level — mirrors what the runtime stamps.
      const allowedLevels = ['debug', 'info', 'warn', 'error']
      const rawLevel = cfg['level']
      const level = typeof rawLevel === 'string' && allowedLevels.includes(rawLevel) ? rawLevel : 'info'
      const dataVal = operandPreviewValue(node.id, 'data', cfg['data'], nodes, edges)
      // Mirror `logExecutor`: an inline (un-wired) Expression message renders
      // Handlebars against the resolved `data` as its context (so `{{name}}`
      // reads `data.name`, `{{.}}` the scalar) — not the raw template the
      // generic operand preview would otherwise surface.
      const messageWired = edges.some((e) => e.to.nodeId === node.id && e.to.portId === 'message')
      const msgCfg = cfg['message'] as { type?: unknown; value?: unknown } | undefined
      let message: unknown
      if (!messageWired && msgCfg?.type === 'expression' && typeof msgCfg.value === 'string') {
        try {
          message = Handlebars.compile(msgCfg.value, { noEscape: true })(dataVal ?? {})
        } catch {
          message = msgCfg.value
        }
      } else {
        message = operandPreviewValue(node.id, 'message', cfg['message'], nodes, edges)
      }
      return {
        timestamp: new Date().toISOString(),
        level,
        message: message === undefined ? null : message,
        data: dataVal === undefined ? null : dataVal
      }
    }
    case 'assert': {
      // Same operands + operator as `comparator`/`if`. Signal outputs
      // (`pass` / `fail`); the preview surfaces which branch the assertion
      // would fire + the configured message.
      const a = operandPreviewValue(node.id, 'left', cfg['left'], nodes, edges)
      const b = operandPreviewValue(node.id, 'right', cfg['right'], nodes, edges)
      if (a === undefined || b === undefined) return null
      const op = typeof cfg['operator'] === 'string' ? cfg['operator'] : '='
      const r = compareValues(op, a, b)
      if (r === null) return null
      const msg = concreteValue(cfg['message'])
      const messagePart: Record<string, unknown> = typeof msg === 'string' && msg !== '' ? { message: msg } : {}
      return { pass: r, branch: r ? 'pass' : 'fail', ...messagePart }
    }
    case 'wait': return previewSinglePortPassThrough(node.id, 'duration', cfg['duration'], nodes, edges)
    case 'waitUntil': {
      // `until` is semantically a date-time. Cast a resolved epoch number or
      // ISO string to a Date so the inspector shows it as a real date (the
      // path tree renders Date as ISO + calendar icon) instead of an opaque
      // millisecond integer.
      const preview = previewSinglePortPassThrough(node.id, 'until', cfg['until'], nodes, edges)
      if (preview && preview['until'] !== null) {
        const v = preview['until']
        const d = typeof v === 'number' ? new Date(v)
          : typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v)
          : null
        if (d && !Number.isNaN(d.getTime())) return { until: d }
      }
      return preview
    }
    case 'switch': {
      // The `on` value is the routing key — resolve it (wired or literal),
      // then pick the first case whose persisted value equals it. No match →
      // the `default` branch. Case values are literal config (no incoming
      // links on case ports), so equality is on the resolved JS values.
      const onValue = operandPreviewValue(node.id, 'on', cfg['on'], nodes, edges)
      if (onValue === undefined) return null
      const rawCases = cfg['cases']
      const cases = Array.isArray(rawCases) ? rawCases : []
      // Branch is reported as the case's 1-based position (or `'default'`) —
      // the persisted case id (`case-…`) is meaningless to the user reading the
      // inspector; "case 2" mirrors the visual order in the box.
      for (let i = 0; i < cases.length; i++) {
        const entry = cases[i] as { id?: unknown; value?: unknown } | undefined
        if (!entry || typeof entry.id !== 'string') continue
        const caseValue = concreteValue(entry.value)
        const eq = compareValues('=', onValue, caseValue)
        if (eq === true) return { value: onValue, branch: i + 1 }
      }
      return { value: onValue, branch: 'default' }
    }
    case 'if': {
      // Same operands + operator as `comparator`, but the box's outputs are
      // signal branches (`then` / `else`) chosen by the boolean — reflect both
      // the underlying condition and the chosen branch so the inspector tells
      // the user what fires.
      const a = operandPreviewValue(node.id, 'left', cfg['left'], nodes, edges)
      const b = operandPreviewValue(node.id, 'right', cfg['right'], nodes, edges)
      if (a === undefined || b === undefined) return null
      const op = typeof cfg['operator'] === 'string' ? cfg['operator'] : '='
      const r = compareValues(op, a, b)
      if (r === null) return null
      return { condition: r, branch: r ? 'then' : 'else' }
    }
    case 'while':
    case 'doWhile': {
      // The `if` mechanism in a loop: same operands + operator; `then` is the
      // body (loop continues), `else` exits. Reflect the condition + branch.
      const a = operandPreviewValue(node.id, 'left', cfg['left'], nodes, edges)
      const b = operandPreviewValue(node.id, 'right', cfg['right'], nodes, edges)
      if (a === undefined || b === undefined) return null
      const op = typeof cfg['operator'] === 'string' ? cfg['operator'] : '='
      const r = compareValues(op, a, b)
      if (r === null) return null
      return { condition: r, branch: r ? 'then' : 'else' }
    }
    case 'boolean': {
      const a = operandPreviewValue(node.id, 'a', cfg['a'], nodes, edges)
      const b = operandPreviewValue(node.id, 'b', cfg['b'], nodes, edges)
      if (a === undefined || b === undefined) return null
      const ba = Boolean(a); const bb = Boolean(b)
      const op = typeof cfg['operator'] === 'string' ? cfg['operator'] : 'AND'
      let r: boolean
      switch (op) {
        case 'AND': r = ba && bb; break
        case 'OR': r = ba || bb; break
        case 'XOR': r = ba !== bb; break
        default: r = ba && bb
      }
      return { result: r }
    }
    case 'transform': {
      // `expression` is the persisted ExpressionValue ({ type: 'expression',
      // value: <template> }) — the Handlebars body to render. The optional
      // `value` input feeds the template's context as `{{value…}}`.
      const expr = cfg['expression'] as { value?: unknown } | undefined
      const template = typeof expr?.value === 'string' ? expr.value : ''
      const incoming = edges.find((e) => e.to.nodeId === node.id && e.to.portId === 'value')
      let valueCtx: unknown
      if (incoming) {
        const source = nodes.find((n) => n.id === incoming.from.nodeId)
        if (!source || !STATIC_PREVIEW_KINDS.has(source.kind)) return null
        const sp = staticScenarioPreview(source, nodes, edges)
        if (sp === null) return null
        valueCtx = incoming.selector ? resolveSelectorPath(sp, incoming.selector) : sp
      }
      if (template === '') return { result: '' }
      try {
        const compiled = Handlebars.compile(template, { noEscape: true })
        // Context = the input value itself: an object's keys are accessible
        // directly (`{{now}}` on a now → transform link), no `{{value.…}}`
        // intermediary. Primitives use `{{this}}` / `{{.}}`.
        const result: string = compiled(valueCtx ?? {})
        return { result }
      } catch {
        // Helpers aren't registered in the shared preview, so any template
        // that needs one (e.g. `{{date now}}`) falls back to no preview.
        return null
      }
    }
    case 'cast': {
      // Convert the resolved `value` operand to the configured target via the
      // SHARED `castValue` — the SAME implementation the runtime calls. It THROWS
      // on an impossible / null cast (which the runtime routes to `error`); the
      // preview catches it and shows no result.
      const value = operandPreviewValue(node.id, 'value', cfg['value'], nodes, edges)
      if (value === undefined) return null
      const target = isScenarioCastType(cfg['targetType']) ? cfg['targetType'] : 'string'
      try {
        return { result: castValue(value, target) }
      } catch {
        return null
      }
    }
    case 'regex': {
      // Run the configured op over the resolved `value` via the SHARED
      // `applyRegex` — the SAME implementation the runtime calls. An invalid
      // pattern THROWS (runtime → `error`); the preview catches it → no result.
      const value = operandPreviewValue(node.id, 'value', cfg['value'], nodes, edges)
      if (value === undefined) return null
      const op = isRegexOp(cfg['op']) ? cfg['op'] : 'extract'
      const pattern = typeof cfg['pattern'] === 'string' ? cfg['pattern'] : ''
      const flags = typeof cfg['flags'] === 'string' ? cfg['flags'] : ''
      const replacement = typeof cfg['replacement'] === 'string' ? cfg['replacement'] : ''
      try {
        return { result: applyRegex(value, op, pattern, flags, replacement) }
      } catch {
        return null
      }
    }
    case 'json': {
      // Parse / stringify the resolved `value` via the SHARED `applyJson` — the
      // SAME implementation the runtime calls. Malformed JSON / non-serialisable
      // value THROWS (runtime → `error`); the preview catches it → no result.
      const value = operandPreviewValue(node.id, 'value', cfg['value'], nodes, edges)
      if (value === undefined) return null
      const op = isJsonOp(cfg['op']) ? cfg['op'] : 'parse'
      const indent = typeof cfg['indent'] === 'number' ? cfg['indent'] : 0
      try {
        return { result: applyJson(value, op, indent) }
      } catch {
        return null
      }
    }
    case 'schema': {
      // Validate the resolved `value` against the config JSON Schema via the
      // SHARED `validateAgainstSchema` (ajv) — the SAME implementation the
      // runtime calls. Mirror the executor's port outputs: the value on
      // `valid`/`invalid` + the error list on `errors`. A malformed / empty
      // schema THROWS (runtime → `error`); the preview catches it → no result.
      const value = operandPreviewValue(node.id, 'value', cfg['value'], nodes, edges)
      if (value === undefined) return null
      const schemaText = typeof cfg['schema'] === 'string' ? cfg['schema'] : ''
      if (schemaText.trim() === '') return null
      try {
        const { valid, errors } = validateAgainstSchema(value, schemaText)
        return valid ? { valid: value, errors } : { invalid: value, errors }
      } catch {
        return null
      }
    }
    case 'xml': {
      // Parse / stringify the resolved `value` via the SHARED `applyXml` — the
      // SAME implementation the runtime calls. Malformed XML / non-serialisable
      // value THROWS (runtime → `error`); the preview catches it → no result.
      const value = operandPreviewValue(node.id, 'value', cfg['value'], nodes, edges)
      if (value === undefined) return null
      const op = isXmlOp(cfg['op']) ? cfg['op'] : 'parse'
      const indent = typeof cfg['indent'] === 'number' ? cfg['indent'] : 0
      try {
        return { result: applyXml(value, op, indent) }
      } catch {
        return null
      }
    }
    case 'yaml': {
      // Parse / stringify the resolved `value` via the SHARED `applyYaml` — the
      // SAME implementation the runtime calls. Malformed YAML / non-serialisable
      // value THROWS (runtime → `error`); the preview catches it → no result.
      const value = operandPreviewValue(node.id, 'value', cfg['value'], nodes, edges)
      if (value === undefined) return null
      const op = isYamlOp(cfg['op']) ? cfg['op'] : 'parse'
      const indent = typeof cfg['indent'] === 'number' ? cfg['indent'] : 2
      try {
        return { result: applyYaml(value, op, indent) }
      } catch {
        return null
      }
    }
    case 'crypto': {
      // Encode / hash / sign the resolved `value` via the SHARED `applyCrypto` —
      // the SAME implementation the runtime calls. A missing HMAC key / bad
      // base64 THROWS (runtime → `error`); the preview catches it → no result.
      const op = isCryptoOp(cfg['op']) ? cfg['op'] : 'sha256'
      const value = operandPreviewValue(node.id, 'value', cfg['value'], nodes, edges)
      // `uuid` ignores its input; every other op needs a resolved value.
      if (op !== 'uuid' && value === undefined) return null
      const key = typeof cfg['key'] === 'string' ? cfg['key'] : ''
      try {
        return { result: applyCrypto(value, op, key) }
      } catch {
        return null
      }
    }
    case 'jwt': {
      // Decode the resolved `value` token via the SHARED `applyJwt` — the SAME
      // implementation the runtime calls. A malformed token THROWS (runtime →
      // `error`); the preview catches it → no result.
      const value = operandPreviewValue(node.id, 'value', cfg['value'], nodes, edges)
      if (value === undefined) return null
      try {
        return { result: applyJwt(value) }
      } catch {
        return null
      }
    }
    case 'datetime': {
      // Shift / format / diff the resolved `value` date via the SHARED
      // `applyDateTime` — the SAME implementation the runtime calls. An unreadable
      // date THROWS (runtime → `error`); the preview catches it → no result.
      const value = operandPreviewValue(node.id, 'value', cfg['value'], nodes, edges)
      if (value === undefined) return null
      const op = isDateTimeOp(cfg['op']) ? cfg['op'] : 'add'
      const amount = typeof cfg['amount'] === 'number' ? cfg['amount'] : 0
      const unit = isDateTimeUnit(cfg['unit']) ? cfg['unit'] : 'days'
      const format = typeof cfg['format'] === 'string' ? cfg['format'] : ''
      const other = operandPreviewValue(node.id, 'other', cfg['other'], nodes, edges)
      try {
        return { result: applyDateTime(value, op, { amount, unit, format, other }) }
      } catch {
        return null
      }
    }
    case 'objectOp': {
      // Reshape the resolved `value` object via the SHARED `applyObjectOp`. A
      // non-object operand THROWS (runtime → `error`); the preview catches it.
      const value = operandPreviewValue(node.id, 'value', cfg['value'], nodes, edges)
      if (value === undefined) return null
      const op = isObjectOp(cfg['op']) ? cfg['op'] : 'get'
      const path = typeof cfg['path'] === 'string' ? cfg['path'] : ''
      const keys = typeof cfg['keys'] === 'string' ? cfg['keys'].split(',').map((k) => k.trim()).filter(Boolean) : []
      const other = operandPreviewValue(node.id, 'other', cfg['other'], nodes, edges)
      try {
        return { result: applyObjectOp(value, op, { path, keys, other }) }
      } catch {
        return null
      }
    }
    case 'url': {
      // Encode / decode / parse / build the resolved `value` via the SHARED
      // `applyUrl`. A malformed input THROWS (runtime → `error`); preview catches.
      const value = operandPreviewValue(node.id, 'value', cfg['value'], nodes, edges)
      if (value === undefined) return null
      const op = isUrlOp(cfg['op']) ? cfg['op'] : 'encode'
      try {
        return { result: applyUrl(value, op) }
      } catch {
        return null
      }
    }
    case 'random': {
      // Generate a value via the SHARED `applyRandom`. With a `seed` the preview
      // is stable; unseeded it shows a fresh sample. `pick` over an empty list
      // THROWS (runtime → `error`); the preview catches it.
      const op = isRandomOp(cfg['op']) ? cfg['op'] : 'int'
      const min = typeof cfg['min'] === 'number' ? cfg['min'] : undefined
      const max = typeof cfg['max'] === 'number' ? cfg['max'] : undefined
      const length = typeof cfg['length'] === 'number' ? cfg['length'] : undefined
      const seed = typeof cfg['seed'] === 'number' || typeof cfg['seed'] === 'string' ? cfg['seed'] : undefined
      const items = resolveConfigItems(cfg) ?? undefined
      try {
        return { result: applyRandom(op, { min, max, length, seed, items }) }
      } catch {
        return null
      }
    }
    case 'listOp': {
      // Reshape the resolved `value` list via the SHARED `applyListOp`
      // (scenarioList). A non-list operand THROWS (runtime → `error`); caught.
      const value = operandPreviewValue(node.id, 'value', cfg['value'], nodes, edges)
      if (value === undefined) return null
      const op = isListOp(cfg['op']) ? cfg['op'] : 'sort'
      const key = typeof cfg['key'] === 'string' && cfg['key'] !== '' ? cfg['key'] : undefined
      const order = cfg['order'] === 'desc' ? 'desc' : 'asc'
      const depth = typeof cfg['depth'] === 'number' ? cfg['depth'] : undefined
      const size = typeof cfg['size'] === 'number' ? cfg['size'] : undefined
      const start = typeof cfg['start'] === 'number' ? cfg['start'] : undefined
      const end = typeof cfg['end'] === 'number' ? cfg['end'] : undefined
      try {
        return { result: applyListReshape(value, op, { key, order, depth, size, start, end }) }
      } catch {
        return null
      }
    }
    case 'csv': {
      // Parse / stringify the resolved `value` via the SHARED `applyCsv`. The
      // wrong operand shape THROWS (runtime → `error`); the preview catches it.
      const value = operandPreviewValue(node.id, 'value', cfg['value'], nodes, edges)
      if (value === undefined) return null
      const op = isCsvOp(cfg['op']) ? cfg['op'] : 'parse'
      const delimiter = typeof cfg['delimiter'] === 'string' && cfg['delimiter'] !== '' ? cfg['delimiter'] : undefined
      const header = cfg['header'] !== false
      try {
        return { result: applyCsv(value, op, { delimiter, header }) }
      } catch {
        return null
      }
    }
    case 'math': {
      // Run the scalar op on the resolved `a` via the SHARED `applyMath`. A
      // non-finite operand (or negative sqrt) THROWS (runtime → `error`); caught.
      const a = operandPreviewValue(node.id, 'a', cfg['a'], nodes, edges)
      if (a === undefined) return null
      const op = isMathOp(cfg['op']) ? cfg['op'] : 'round'
      const b = operandPreviewValue(node.id, 'b', cfg['b'], nodes, edges)
      const min = operandPreviewValue(node.id, 'min', cfg['min'], nodes, edges)
      const max = operandPreviewValue(node.id, 'max', cfg['max'], nodes, edges)
      const precision = typeof cfg['precision'] === 'number' ? cfg['precision'] : undefined
      try {
        return { result: applyMath(a, op, { b, min, max, precision }) }
      } catch {
        return null
      }
    }
    case 'object': {
      const raw = cfg['properties']
      const props = Array.isArray(raw) ? raw : []
      const out: Record<string, unknown> = {}
      for (const p of props) {
        const prop = p as { id?: unknown; name?: unknown; value?: unknown }
        const name = str(prop.name)
        if (!name || typeof prop.id !== 'string') continue
        // A property wired to a non-static source (e.g. an httpRequest) has no
        // direct preview — keep the row visible with `null`, and the inspector
        // panel overrides it asynchronously with the source's actual run
        // result (via `getObjectWiredProperties` + `getScenarioNodeResult`).
        const value = operandPreviewValue(node.id, prop.id, prop.value, nodes, edges)
        out[name] = value === undefined ? null : value
      }
      return out
    }
    case 'output': {
      // The `output` sink is the symmetric counterpart of `object`: each decl
      // reads its OWN `value` input port (id = the decl id) — wired value wins,
      // else the decl's literal fallback. A property wired to a non-static
      // source lands as `null` and the inspector overrides it asynchronously.
      const out: Record<string, unknown> = {}
      for (const decl of readOutputDecls(cfg)) {
        const name = decl.name.trim()
        if (!name) continue
        const value = operandPreviewValue(node.id, decl.id, decl.value, nodes, edges)
        out[name] = value === undefined ? null : value
      }
      return out
    }
    default:
      return null
  }
}

/** One action of a scenario paired with the data suggestion the inspector shows
 * for it BEFORE any run — the static, config-derived preview. */
export interface ScenarioActionSuggestion {
  /** The action's node id (stable, persisted). */
  id: string
  kind: ScenarioNode['kind']
  /** The static preview the inspector would display, or `null` when the kind
   * has no config-derived suggestion (e.g. an `httpRequest`, or a box whose
   * only inputs are wired to non-static sources). */
  suggestion: Record<string, unknown> | null
}

/**
 * Extract every action of a scenario together with its inspector data
 * suggestion (the pre-run static preview). This mirrors how the editor computes
 * an action's `staticData`, so freezing the result into a snapshot and
 * re-extracting on each run detects regressions in the inspector's suggestions.
 *
 * Cross-scenario `runScenario` outputs are NOT resolved here (they need the
 * whole project tree, which a single scenario doesn't carry) — such a node gets
 * whatever {@link staticScenarioPreview} returns for it in isolation. The
 * scenarios this is first used on (e.g. the log-actions scenario) have no
 * `runScenario`, so the snapshot is faithful + deterministic.
 */
export function extractScenarioActionSuggestions(
  scenario: { nodes: readonly ScenarioNode[]; edges: readonly ScenarioEdge[] }
): ScenarioActionSuggestion[] {
  const nodes: StaticPreviewNode[] = scenario.nodes.map((n) => ({ id: n.id, kind: n.kind, config: n.config }))
  const edges: StaticPreviewEdge[] = scenario.edges.map((e) => ({
    from: e.from,
    to: e.to,
    ...(e.selector !== undefined ? { selector: e.selector } : {})
  }))
  return scenario.nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    suggestion: staticScenarioPreview({ id: n.id, kind: n.kind, config: n.config }, nodes, edges)
  }))
}
