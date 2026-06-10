import type { ListViewItemData } from 'electron-core-ui/renderer'
import type { PortFlow } from '../../../../shared/types/collections'

/**
 * Pure helpers for the JSON-path selector: deciding when a link carries data
 * into a pickable input, and turning an upstream box's output context into a
 * pickable tree whose item ids ARE the dot-paths. Kept free of React/DOM so
 * the path derivation can be unit-tested.
 */

/**
 * A link carries selectable data into an input when the upstream output pushes
 * a value (`value`/`both`, not a pure `signal` trigger) AND the receiving input
 * is a data (`value`) input rather than the header launch trigger (`signal`).
 */
export function isDataLink(inputFlow: PortFlow, sourceOutputFlow: PortFlow): boolean {
  return inputFlow === 'value' && sourceOutputFlow !== 'signal'
}

/** Root keys not worth picking from: run bookkeeping, plus `restormRequest`
 * (the raw unresolved request model — large, and not a runtime value to select
 * a path into; the resolved `request` + `response` are what carry pickable
 * data). */
const ROOT_HIDDEN = new Set(['nodeId', 'requestId', 'historyGuid', 'timestamp', 'restormRequest'])
const PREVIEW_MAX = 32

/** Parse a JSON-looking string (e.g. a response body) into its object/array,
 * so the picker can drill into it. Returns `undefined` for non-JSON strings. */
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

/** Short one-line preview of a leaf value for the row label. Objects/arrays
 * are rendered as expandable nodes, so they never reach here. */
function leafPreview(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') {
    const s = value.length > PREVIEW_MAX ? `${value.slice(0, PREVIEW_MAX)}…` : value
    return `"${s}"`
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return ''
}

/** Codicon (by name) hinting a value's type in the picker rows. */
function typeIcon(value: unknown): string {
  if (Array.isArray(value)) return 'symbol-array'
  if (value === null) return 'circle-slash'
  switch (typeof value) {
    case 'object': return 'symbol-namespace'
    case 'string': return 'symbol-string'
    case 'number': return 'symbol-number'
    case 'boolean': return 'symbol-boolean'
    default: return 'symbol-field'
  }
}

const BARE_IDENTIFIER = /^[A-Za-z_$][\w$]*$/

/** Bracket-quote an object key for a JSON path. Prefers single quotes; falls
 * back to double quotes when the key contains a single quote (the selector
 * grammar reads `['…']` / `["…"]` but not escaped quotes inside them). */
function bracketKey(key: string): string {
  return key.includes("'") ? `["${key}"]` : `['${key}']`
}

/** Append an object key to a parent path. A clean identifier uses dot notation
 * (`parent.key`); anything else (spaces, dots, punctuation) uses bracket
 * notation (`parent['key with spaces']`) so the path stays a VALID, resolvable
 * selector. An empty `parent` yields the root segment — a bare identifier, or a
 * leading `['key']` for a special root key. */
function appendKey(parent: string, key: string): string {
  if (BARE_IDENTIFIER.test(key)) return parent ? `${parent}.${key}` : key
  return `${parent}${bracketKey(key)}`
}

function buildNode(key: string, rawValue: unknown, path: string, expand: boolean): ListViewItemData {
  // A JSON-string body is shown drilled-into, not as one opaque string.
  const value = typeof rawValue === 'string' ? maybeParseJson(rawValue) ?? rawValue : rawValue

  // A `Date` (e.g. the `now` box's `datetime` output) is a leaf — show its
  // ISO form instead of recursing into the class instance (no enumerable
  // properties → would render as an empty object).
  if (value instanceof Date) {
    return { id: path, title: `${key}: ${value.toISOString()}`, icon: 'calendar', data: { path } }
  }
  if (Array.isArray(value)) {
    return {
      id: path,
      title: `${key} [${value.length}]`,
      icon: 'symbol-array',
      isExpandable: true,
      // `headers` is long + rarely picked, so keep it folded even inside an
      // expanded parent; every other array follows the inherited expansion.
      isExpanded: key === 'headers' ? false : expand,
      data: { path },
      children: value.map((item, i) => buildNode(String(i), item, `${path}.${i}`, false))
    }
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return {
      id: path,
      title: key,
      icon: 'symbol-namespace',
      isExpandable: true,
      isExpanded: expand,
      data: { path },
      children: entries.map(([k, v]) => buildNode(k, v, appendKey(path, k), true))
    }
  }
  return {
    id: path,
    title: `${key}: ${leafPreview(value)}`,
    icon: typeIcon(value),
    data: { path }
  }
}

/**
 * Turn a box's output context (the `get_scenario_node_result` shape) into a
 * pickable tree. Item ids are the dot-paths a click writes into the edge
 * selector (`response.body.users.0.id`). Run bookkeeping keys are dropped; the
 * `response` group starts expanded since it's what gets picked most.
 */
export function buildScenarioPathTree(context: unknown): ListViewItemData[] {
  if (context === null || typeof context !== 'object') return []
  return Object.entries(context as Record<string, unknown>)
    .filter(([k]) => !ROOT_HIDDEN.has(k))
    .map(([k, v]) => buildNode(k, v, appendKey('', k), k === 'response'))
}
