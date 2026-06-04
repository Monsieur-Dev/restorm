/**
 * Operand resolution + condition evaluation for the comparison-based nodes
 * (`if`, `comparator`, `assert`) AND the conditional loops (`while`, `doWhile`,
 * which the scheduler re-evaluates each iteration). This layer adds the
 * main-process-only resolution (environments via the collection/context
 * services, multi-select → array, inline typed-value → primitive) on top of the
 * PURE comparison core in `shared/scenarioComparison`, which the runtime AND the
 * inspector preview share so they can never drift.
 */
import { concreteValue, listValueArray } from '../../shared/utils/scenarioStaticPreview'
import { collectionStore } from '../services/CollectionStore'
import { contextService } from '../services/ContextService'
import { compareValues, isNumericString, type OperandKind, type OperandHint } from '../../shared/scenarioComparison'

// Re-exported so existing consumers (executors, scheduler) keep importing the
// comparison surface from here, while the implementation lives in `shared`.
export { compareValues, deepEqual } from '../../shared/scenarioComparison'
export type { OperandKind, OperandHint } from '../../shared/scenarioComparison'

/** Walk the whole collection tree for the custom value list with `listId`
 * (RuntimeIds are unique, so no folder context is needed) and report whether
 * EVERY entry label trims-and-casts to a finite number. `undefined` when the
 * list is unknown / empty, so callers can fall back to a per-value guess. */
export function enumOptionsAllNumeric(listId: string): boolean | undefined {
  const stack: unknown[] = [...collectionStore.getCollections()]
  while (stack.length > 0) {
    const item = stack.pop()
    if (item === null || typeof item !== 'object') continue
    const lists = (item as { customValueLists?: { id: string; entries?: { label?: unknown }[] }[] }).customValueLists
    const list = lists?.find((l) => l.id === listId)
    if (list) {
      const entries = list.entries ?? []
      return entries.length > 0 && entries.every((e) => typeof e.label === 'string' && isNumericString(e.label))
    }
    const children = (item as { items?: unknown[] }).items
    if (Array.isArray(children)) stack.push(...children)
  }
  return undefined
}

/** Build the comparison hint for an INLINE operand from its typed-value config:
 * its declared kind, plus (for an enum) whether its option set is all-numeric. */
export function hintFromConfig(cfg: unknown): OperandHint | undefined {
  const kind = kindFromConfig(cfg)
  if (kind === undefined) return undefined
  if (kind !== 'enum') return { kind }
  const listId = cfg !== null && typeof cfg === 'object' ? (cfg as { listId?: unknown }).listId : undefined
  return { kind, ...(typeof listId === 'string' ? { enumNumeric: enumOptionsAllNumeric(listId) } : {}) }
}

/** Declared kind of an INLINE operand (from its typed-value config). Wired
 * operands carry no config type, so their kind is inferred from the value —
 * which means a wired date/colour/enum (all plain strings at runtime) is
 * treated as a string. Returns undefined for kinds inferred from the value. */
export function kindFromConfig(cfg: unknown): OperandKind | undefined {
  if (cfg === null || typeof cfg !== 'object') return undefined
  switch ((cfg as { type?: string }).type) {
    case 'numeric': return 'number'
    case 'boolean': return 'boolean'
    case 'datetime': return 'date'
    case 'color': return 'color'
    case 'enum': case 'enumList': case 'customList': case 'customListMulti': return 'enum'
    case 'string': case 'password': case 'expression': return 'string'
    case 'null': return 'null'
    default: return undefined
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
export function resolveOperand(wired: unknown, cfgVal: unknown, variables?: ReadonlyMap<string, unknown>, depth = 0): unknown {
  if (wired !== undefined) return wired
  if (cfgVal === undefined || cfgVal === null) return undefined
  if (variables && typeof cfgVal === 'object' && (cfgVal as { type?: unknown }).type === 'variable') {
    const name = (cfgVal as { value?: unknown }).value
    return typeof name === 'string' ? variables.get(name) : undefined
  }
  // A `list` is an agnostic array — resolve EACH item (a `variable` item reads
  // its live value, a nested `list` recurses). Variables hold already-resolved
  // values (flat lookups), so a self/ancestor reference can't loop; the depth
  // cap is a hard safety net against pathological literal nesting.
  if (typeof cfgVal === 'object' && (cfgVal as { type?: unknown }).type === 'list') {
    if (depth >= 32) return []
    const items = (cfgVal as { items?: unknown }).items
    return Array.isArray(items) ? items.map((it) => resolveOperand(undefined, it, variables, depth + 1)) : []
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
    const env = typeof id === 'string' && id !== '' ? collectionStore.findEnvironmentById(id) : undefined
    // No environment chosen resolves to NULL — whether the selection is empty
    // OR the stored id no longer resolves to a real environment (the field
    // shows "—"). An unselected environment is treated as null, so `if env =
    // null` takes `then` (and switch/assert/object/log see null, not undefined).
    if (!env) return null
    // Omit `variables` entirely for an env with none — an empty `{}` rendered a
    // misleading expandable-but-empty node in the run log.
    const variables = { ...(contextService.getContext(id) ?? {}) }
    return Object.keys(variables).length > 0 ? { name: env.name, variables } : { name: env.name }
  }
  // A multi-select (`customListMulti` / `enumList`) IS a list — resolve it to its
  // ARRAY so list ops count/iterate it and comparisons use list semantics (a
  // variable set to one stays a list). `concreteValue` joins it to a display
  // string; that form stays for log templates and request params, which resolve
  // through a different path, NOT this one.
  const listArr = listValueArray(cfgVal)
  if (listArr) return listArr
  return concreteValue(cfgVal)
}

/** Evaluate an `if`/`while`/`doWhile` condition: operands `left`/`right`
 * (wired input wins, else inline config) compared by the operator. With no
 * operands at all, falls back to the truthiness of the `in` trigger. Pass
 * `variables` so a `variable` operand reads the run's live value. */
export function evaluateCondition(config: Record<string, unknown>, inputs: Record<string, unknown>, variables?: ReadonlyMap<string, unknown>): boolean {
  const leftWired = inputs['left']
  const rightWired = inputs['right']
  const left = resolveOperand(leftWired, config['left'], variables)
  const right = resolveOperand(rightWired, config['right'], variables)
  const hasOperands = left !== undefined || right !== undefined
  if (!hasOperands) return Boolean(inputs['in'])
  const op = typeof config['operator'] === 'string' ? config['operator'] : (typeof config['op'] === 'string' ? config['op'] : undefined)
  // A wired operand's kind comes from its runtime value; an inline operand's
  // from its declared type (so a date/colour/enum isn't mistaken for a string,
  // and an all-numeric enum orders numerically).
  const lHint = leftWired !== undefined ? undefined : hintFromConfig(config['left'])
  const rHint = rightWired !== undefined ? undefined : hintFromConfig(config['right'])
  return compareValues(op, left, right, lHint, rHint)
}
