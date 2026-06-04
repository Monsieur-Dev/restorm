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

/** Semantic kind of an operand — drives which comparisons are meaningful. */
export type OperandKind = 'number' | 'boolean' | 'string' | 'date' | 'color' | 'enum' | 'object' | 'list' | 'null' | 'unknown'

/** A kind hint plus, for an enum, whether its WHOLE option set is numeric (so
 * ordering goes numeric vs lexicographic). A bare `OperandKind` is accepted as
 * shorthand for `{ kind }`. */
export interface OperandHint { kind: OperandKind; enumNumeric?: boolean }

function normHint(h: OperandKind | OperandHint | undefined): OperandHint | undefined {
  return h === undefined ? undefined : typeof h === 'string' ? { kind: h } : h
}

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

function inferKind(v: unknown): OperandKind {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'list'
  if (typeof v === 'object') return 'object'
  if (typeof v === 'number') return 'number'
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'string') return 'string'
  return 'unknown'
}

/** The value's structure is authoritative for list/object/number/boolean (a
 * wired array is a list whatever the config claimed); a hint only refines the
 * string-backed subtypes (date / colour / enum). */
function effectiveKind(v: unknown, hint?: OperandKind): OperandKind {
  const inferred = inferKind(v)
  return inferred === 'string' ? hint ?? 'string' : inferred
}

const isNumericString = (s: string): boolean => {
  const t = s.trim()
  return t !== '' && Number.isFinite(Number(t))
}

type OrderMode = { t: 'num'; v: number } | { t: 'str'; v: string } | null

/** Datetime comparison is at SECOND precision: parse to epoch and floor off the
 * sub-second part. Two instants that render identically at the usual second
 * format (`yyyy-MM-dd HH:mm:ss`) but differ only in milliseconds — e.g. a value
 * captured as `…:55.794Z` vs an expected `…:55.000Z` — compare equal. Both
 * equality and ordering go through this so they stay consistent. NaN (unparsable)
 * propagates so callers fall back to string compare. */
function dateSeconds(value: unknown): number {
  return Math.floor(Date.parse(String(value)) / 1000)
}

/** Does this value parse as a real date? Used to promote a `string` operand to
 * `date` when its partner is a declared datetime (e.g. a `{{datetime}}` variable
 * resolves to an ISO string with no date hint). A non-date string (`"abc"`) and
 * a bare number stay put. */
function parsesAsDate(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

/** Reduce an operand to a single ordered axis (number or string), or `null`
 * when the kind has no meaningful order. Dates order by instant; an enum whose
 * value is numeric orders numerically, otherwise by its label. */
function orderModeOf(value: unknown, kind: OperandKind, enumNumeric?: boolean): OrderMode {
  switch (kind) {
    case 'number': return { t: 'num', v: typeof value === 'number' ? value : Number(value) }
    case 'string': return { t: 'str', v: String(value) }
    case 'date': {
      const s = dateSeconds(value)
      return Number.isNaN(s) ? { t: 'str', v: String(value) } : { t: 'num', v: s }
    }
    case 'enum': {
      // Numeric ordering when the enum's WHOLE option set is numeric (caller-
      // supplied); without that knowledge, fall back to this value's own shape.
      const s = String(value)
      const asNum = enumNumeric ?? isNumericString(s)
      return asNum ? { t: 'num', v: Number(s.trim()) } : { t: 'str', v: s }
    }
    default: return null // boolean, color, object, list, unknown
  }
}

const ORDER_SYMBOL: Record<string, string> = { lt: '<', lte: '≤', gt: '>', gte: '≥' }

function orderingCompare(op: string, l: unknown, r: unknown, lk: OperandKind, rk: OperandKind, lEnumNumeric?: boolean, rEnumNumeric?: boolean): boolean {
  // Null ordering: there is no meaningful strict order for null, so any null in
  // a `<` / `>` (and a null compared against a non-null in `<=` / `>=`) throws.
  // The ONE meaningful case is the reflexive equality `null <= null` /
  // `null >= null` → true (null IS equal to null).
  if (lk === 'null' || rk === 'null') {
    if (lk === 'null' && rk === 'null' && (op === 'lte' || op === 'gte')) return true
    throw new Error(`Operator "${ORDER_SYMBOL[op] ?? op}" cannot order null values`)
  }
  const lm = orderModeOf(l, lk, lEnumNumeric)
  const rm = orderModeOf(r, rk, rEnumNumeric)
  const sym = ORDER_SYMBOL[op] ?? op
  if (lm === null) throw new Error(`Operator "${sym}" cannot order ${lk} values`)
  if (rm === null) throw new Error(`Operator "${sym}" cannot order ${rk} values`)
  let lMode = lm
  let rMode = rm
  if (lMode.t !== rMode.t) {
    // A NUMERIC string compared against a number is still a number (a numeric
    // literal is routinely stored as a string operand) — coerce and compare
    // numerically. A non-numeric string vs a number is a real type mismatch.
    if (lMode.t === 'num' && rMode.t === 'str' && isNumericString(rMode.v)) rMode = { t: 'num', v: Number(rMode.v.trim()) }
    else if (rMode.t === 'num' && lMode.t === 'str' && isNumericString(lMode.v)) lMode = { t: 'num', v: Number(lMode.v.trim()) }
    else throw new Error(`Operator "${sym}" cannot compare a ${lk} with a ${rk}`)
  }
  if (lMode.t === 'str' && rMode.t === 'str') {
    const a = lMode.v, b = rMode.v
    return op === 'lt' ? a < b : op === 'lte' ? a <= b : op === 'gt' ? a > b : a >= b
  }
  const a = lMode.v as number, b = rMode.v as number
  return op === 'lt' ? a < b : op === 'lte' ? a <= b : op === 'gt' ? a > b : a >= b
}

/** Unordered multiset equality: same length, and every element of `a` has a
 * distinct deep-equal partner in `b`. */
function listEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false
  const used = new Array<boolean>(b.length).fill(false)
  for (const x of a) {
    const i = b.findIndex((y, j) => !used[j] && deepEqual(x, y))
    if (i === -1) return false
    used[i] = true
  }
  return true
}

function equalityCompare(l: unknown, r: unknown, lk: OperandKind, rk: OperandKind): boolean {
  // Null equality: null IS equal ONLY to null; anything else (object, string,
  // number, even the empty string "") is NOT equal to null.
  if (lk === 'null' || rk === 'null') return lk === 'null' && rk === 'null'
  if (lk === 'list' || rk === 'list') return lk === 'list' && rk === 'list' && listEqual(l as unknown[], r as unknown[])
  if (lk === 'date' && rk === 'date') {
    const a = dateSeconds(l), b = dateSeconds(r)
    if (!Number.isNaN(a) && !Number.isNaN(b)) return a === b
    return String(l) === String(r)
  }
  return deepEqual(l, r) // objects deep; primitives by value; cross-type → false
}

const STRINGISH = new Set<OperandKind>(['string', 'enum', 'date', 'color'])

/** `right ⊆ left`: every key of `right` exists in `left` with a deep-equal value. */
function objectSubset(left: unknown, right: unknown): boolean {
  if (left === null || typeof left !== 'object' || right === null || typeof right !== 'object') return false
  const l = left as Record<string, unknown>, r = right as Record<string, unknown>
  for (const k of Object.keys(r)) {
    if (!Object.prototype.hasOwnProperty.call(l, k) || !deepEqual(l[k], r[k])) return false
  }
  return true
}

function containsCompare(l: unknown, r: unknown, lk: OperandKind, rk: OperandKind): boolean {
  if (lk === 'object' && rk === 'object') return objectSubset(l, r)
  if (lk === 'list') return (l as unknown[]).some((x) => deepEqual(x, r))
  if (STRINGISH.has(lk) && STRINGISH.has(rk)) return stringify(l).includes(stringify(r))
  throw new Error(`Operator "∋" cannot test a ${lk} for containment of a ${rk}`)
}

/** Compare two values with the operator. Optional kind hints carry the DECLARED
 * type of an inline operand so string-backed subtypes (date/colour/enum) get
 * the right treatment; without a hint the kind is inferred from the value.
 * Ordering THROWS for kinds with no meaningful order (object/list/boolean/
 * colour) and for mixed types. */
export function compareValues(op: string | undefined, l: unknown, r: unknown, lHint?: OperandKind | OperandHint, rHint?: OperandKind | OperandHint): boolean {
  const lh = normHint(lHint)
  const rh = normHint(rHint)
  const canon = op !== undefined ? OPERATOR_ALIASES[op] ?? op : 'eq'
  let lk = effectiveKind(l, lh?.kind)
  let rk = effectiveKind(r, rh?.kind)
  // Date promotion: a declared `datetime` is routinely compared against a
  // `variable` (or any wired value) that RESOLVES to a date string but carries
  // no date hint — so it lands as `string`. When one side is a date and the
  // other is a string that actually parses as a date, treat both as dates, so
  // equality + ordering compare instants at SECOND precision instead of the raw
  // ISO strings (where stray sub-second ms would break an otherwise-equal time).
  if (lk === 'date' && rk === 'string' && parsesAsDate(r)) rk = 'date'
  else if (rk === 'date' && lk === 'string' && parsesAsDate(l)) lk = 'date'
  switch (canon) {
    case 'eq': return equalityCompare(l, r, lk, rk)
    case 'ne': return !equalityCompare(l, r, lk, rk)
    case 'contains': return containsCompare(l, r, lk, rk)
    case 'lt': case 'lte': case 'gt': case 'gte': return orderingCompare(canon, l, r, lk, rk, lh?.enumNumeric, rh?.enumNumeric)
    default: return equalityCompare(l, r, lk, rk)
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
