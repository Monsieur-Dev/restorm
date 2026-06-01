/**
 * Shared condition evaluation for the comparison-based nodes (`if`,
 * `comparator`, `assert`) AND the conditional loops (`while`, `doWhile`,
 * which the scheduler re-evaluates each iteration). Centralised here so
 * the executors and the scheduler agree on operand resolution + the
 * operator vocabulary.
 */
import { concreteValue } from '../../shared/utils/scenarioStaticPreview'
import { collectionStore } from '../services/CollectionStore'
import { contextService } from '../services/ContextService'

/** The operator toggle persists its symbol vocabulary (`<` `≤` `=` `≥`
 * `>` `≠`, and `∋`/`contains`); the comparison speaks the canonical
 * name vocabulary. Map both. Unknown / absent → equality. */
const OPERATOR_ALIASES: Record<string, string> = {
  '<': 'lt', '≤': 'lte', '=': 'eq', '≥': 'gte', '>': 'gt', '≠': 'ne', '∋': 'contains',
  lt: 'lt', lte: 'lte', eq: 'eq', gte: 'gte', gt: 'gt', ne: 'ne', contains: 'contains'
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  return ''
}

/** Compare two values with the operator (toggle symbols OR canonical names). */
/** Structural equality for `=` / `≠`. Primitives compare by value (identical
 * to `===`); objects/arrays compare by their CONTENTS, recursively — so two
 * values that carry the same data are equal even when they're distinct
 * instances (e.g. the same environment read into two operands resolves to two
 * `{ name, variables }` objects that should still test equal). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const ka = Object.keys(a as Record<string, unknown>)
  const kb = Object.keys(b as Record<string, unknown>)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}

export function compareValues(op: string | undefined, l: unknown, r: unknown): boolean {
  switch (op !== undefined ? OPERATOR_ALIASES[op] ?? op : 'eq') {
    case 'lt': return (l as number) < (r as number)
    case 'lte': return (l as number) <= (r as number)
    case 'eq': return deepEqual(l, r)
    case 'gte': return (l as number) >= (r as number)
    case 'gt': return (l as number) > (r as number)
    case 'ne': return !deepEqual(l, r)
    case 'contains': return stringify(l).includes(stringify(r))
    default: return deepEqual(l, r)
  }
}

/** Resolve a comparison operand: a wired port wins; otherwise the box's
 * inline typed-value config (resolved to a primitive). An ABSENT config
 * operand stays `undefined` so a bare `if`/`while` with no operands falls
 * back to the `in` trigger's truthiness rather than comparing null==null.
 *
 * A `variable` operand resolves to the run's LIVE value (read from
 * `variables` each call) — so a `while`/`doWhile` condition reacts to the
 * body mutating that variable across iterations (e.g. `while counter < 10`). */
export function resolveOperand(wired: unknown, cfgVal: unknown, variables?: ReadonlyMap<string, unknown>): unknown {
  if (wired !== undefined) return wired
  if (cfgVal === undefined || cfgVal === null) return undefined
  if (variables && typeof cfgVal === 'object' && (cfgVal as { type?: unknown }).type === 'variable') {
    const name = (cfgVal as { value?: unknown }).value
    return typeof name === 'string' ? variables.get(name) : undefined
  }
  // An `environment` operand is a reference to an environment BY ITS ID (see
  // `EnvironmentValue`). A pure node that reads it (if / switch / comparator /
  // object / log…) gets the environment as a structured value: its `name`
  // (what the user branches on — `switch env.name → localhost / production`)
  // plus `variables`, the FULLY RESOLVED variable map of that environment
  // (`env.variables.baseUrl`). Not the opaque `{{$<id>}}` template
  // `concreteValue` would render.
  if (typeof cfgVal === 'object' && (cfgVal as { type?: unknown }).type === 'environment') {
    const id = (cfgVal as { value?: unknown }).value
    if (typeof id !== 'string') return undefined
    const env = collectionStore.findEnvironmentById(id)
    if (!env) return undefined
    // Omit `variables` entirely for an env with none — an empty `{}` rendered a
    // misleading expandable-but-empty node in the run log.
    const variables = { ...(contextService.getContext(id) ?? {}) }
    return Object.keys(variables).length > 0 ? { name: env.name, variables } : { name: env.name }
  }
  return concreteValue(cfgVal)
}

/** Evaluate an `if`/`while`/`doWhile` condition: operands `left`/`right`
 * (wired input wins, else inline config) compared by the operator. With no
 * operands at all, falls back to the truthiness of the `in` trigger. Pass
 * `variables` so a `variable` operand reads the run's live value. */
export function evaluateCondition(config: Record<string, unknown>, inputs: Record<string, unknown>, variables?: ReadonlyMap<string, unknown>): boolean {
  const left = resolveOperand(inputs['left'], config['left'], variables)
  const right = resolveOperand(inputs['right'], config['right'], variables)
  const hasOperands = left !== undefined || right !== undefined
  if (!hasOperands) return Boolean(inputs['in'])
  const op = typeof config['operator'] === 'string' ? config['operator'] : (typeof config['op'] === 'string' ? config['op'] : undefined)
  return compareValues(op, left, right)
}
