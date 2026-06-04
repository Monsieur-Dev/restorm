import Handlebars from 'handlebars'
import { registerHandlebarsHelpers } from './handlebars/registerAll'
import type { ScenarioNode, ScenarioEdge } from '../types/scenario'
import { readInputParams } from '../scenarioInputParams'
import { readOutputDecls } from '../scenarioOutputDecls'
import { STATIC_PREVIEW_KINDS } from '../scenarioNodeCapabilities'

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

export function concreteValue(persisted: unknown): unknown {
  if (persisted === null || persisted === undefined) return null
  if (typeof persisted !== 'object') return persisted
  const p = persisted as { type?: unknown; value?: unknown; label?: unknown; labels?: unknown }
  switch (p.type) {
    case 'null':
      return null
    case 'numeric': {
      const n = typeof p.value === 'number' ? p.value : Number(p.value)
      return Number.isFinite(n) ? n : 0
    }
    case 'boolean':
      return p.value === true || p.value === 'true'
    case 'customList':
      return typeof p.label === 'string' ? p.label : ''
    case 'customListMulti':
      return Array.isArray(p.labels) ? p.labels.filter((v): v is string => typeof v === 'string').join(',') : ''
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
    // 'string' | 'expression' | 'password' | 'color' | 'datetime' | 'enum' |
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

/** Map of scenario variable name → its declared value, from `input` and
 * `setVariable` boxes — used to resolve a `getVariable`'s reference. */
function variableValues(nodes: readonly StaticPreviewNode[]): Map<string, unknown> {
  const m = new Map<string, unknown>()
  for (const n of nodes) {
    if (n.kind === 'input') {
      // Each declared param is a scenario variable carrying its typed default —
      // so a `{{param1}}` reference resolves in the preview exactly as it does
      // at runtime (where `inputExecutor` publishes the same names).
      for (const param of readInputParams(n.config)) {
        const name = param.name.trim()
        // A multi-select default resolves to its ARRAY (mirrors the runtime
        // `resolveOperand`), so list ops / comparisons see a real list.
        if (name) m.set(name, listValueArray(param.valueType) ?? concreteValue(param.valueType))
      }
    } else if (n.kind === 'setVariable') {
      const name = str(n.config['name'])
      if (name) m.set(name, listValueArray(n.config['value']) ?? concreteValue(n.config['value']))
    }
  }
  return m
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
    const v = edge.selector ? resolveSelectorPath(sp, edge.selector) : sp
    return Array.isArray(v) ? v : null
  }
  const lit = literalConfigItems(cfg)
  if (lit) return lit
  // An inline `variable` items resolves to that variable's STATIC value (from a
  // `setVariable` / `input` box) — so `setVariable list → aggregate over the
  // variable` previews its count/items, not nothing.
  const raw = cfg['items'] as { type?: unknown; value?: unknown } | null | undefined
  if (raw && typeof raw === 'object' && raw.type === 'variable' && typeof raw.value === 'string') {
    const v = variableValues(nodes).get(raw.value)
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
    const p = v as { type?: unknown; labels?: unknown; value?: unknown }
    if (p.type === 'customListMulti' && Array.isArray(p.labels)) return p.labels as unknown[]
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
    const nums: number[] = []
    for (const item of items) {
      const n = asNumber(valueOf(item))
      if (n !== null) nums.push(n)
    }
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
  edges: readonly StaticPreviewEdge[]
): unknown {
  const edge = edges.find((e) => e.to.nodeId === nodeId && e.to.portId === portId)
  if (!edge) {
    // An inline `variable` operand resolves to that variable's STATIC value
    // (from the setVariable / input nodes), not the `{{name}}` template
    // `concreteValue` renders — otherwise an operand fed by a variable makes the
    // whole node's preview NaN/null (so a downstream box has nothing to suggest).
    const lit = configLiteral as { type?: unknown; value?: unknown } | null | undefined
    if (lit !== null && typeof lit === 'object' && lit.type === 'variable' && typeof lit.value === 'string') {
      return variableValues(nodes).get(lit.value)
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

/** Apply a comparator-style operator (`<`/`≤`/`=`/`≥`/`>`/`≠`/`contains`) to
 * two resolved values. Returns `null` for combinations the operator can't
 * handle (e.g. ordering on objects) so the caller drops the preview. Shared
 * by `comparator` and `if` (both branch on the same op set). */
function compareValues(op: string, a: unknown, b: unknown): boolean | null {
  const na = asNumber(a); const nb = asNumber(b)
  const numeric = na !== null && nb !== null
  const bothStr = typeof a === 'string' && typeof b === 'string'
  if (op === '=') return numeric ? na === nb : a === b
  if (op === '≠') return numeric ? na !== nb : a !== b
  if (op === 'contains') {
    if (typeof a === 'string' && (typeof b === 'string' || typeof b === 'number' || typeof b === 'boolean')) {
      return a.includes(typeof b === 'string' ? b : String(b))
    }
    if (Array.isArray(a)) return a.includes(b)
    return null
  }
  if (numeric) {
    switch (op) {
      case '<': return na < nb
      case '≤': return na <= nb
      case '≥': return na >= nb
      case '>': return na > nb
      default: return null
    }
  }
  if (bothStr) {
    switch (op) {
      case '<': return a < b
      case '≤': return a <= b
      case '≥': return a >= b
      case '>': return a > b
      default: return null
    }
  }
  return null
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
      return { [name]: variableValues(nodes).get(name) ?? null }
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
      return applyListOp({ id: node.id, kind: node.kind, config: cfg }, items)
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
