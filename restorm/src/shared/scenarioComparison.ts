/**
 * Pure value-comparison core for scenario nodes — the operator vocabulary and
 * the type-aware `=` / `≠` / `∋` / `<` `≤` `>` `≥` semantics, with NO dependency
 * on the main-process services (collection / context). Shared so the RUNTIME
 * (`conditionEval`, which adds environment/enum resolution on top) and the
 * INSPECTOR PREVIEW (`scenarioStaticPreview`) compare values identically — there
 * is exactly ONE comparison implementation, so the two can never drift.
 *
 * `compareValues` THROWS for combinations with no meaningful answer (ordering a
 * null/object/list, mixing incompatible types). The runtime lets that surface on
 * the `error` port; the preview catches it and shows no result.
 */

/** Semantic kind of an operand — drives which comparisons are meaningful. */
export type OperandKind = 'number' | 'boolean' | 'string' | 'date' | 'color' | 'enum' | 'object' | 'list' | 'null' | 'unknown'

/** A kind hint plus, for an enum, whether its WHOLE option set is numeric (so
 * ordering goes numeric vs lexicographic). A bare `OperandKind` is accepted as
 * shorthand for `{ kind }`. */
export interface OperandHint { kind: OperandKind; enumNumeric?: boolean }

/** The operator toggle persists its symbol vocabulary (`<` `≤` `=` `≥` `>` `≠`,
 * and `∋`/`contains`); the comparison speaks the canonical name vocabulary. Map
 * both. Unknown / absent → equality. */
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

/** Structural equality for `=` / `≠`. Primitives compare by value (identical to
 * `===`); objects/arrays compare by their CONTENTS, recursively — so two values
 * that carry the same data are equal even when they're distinct instances (e.g.
 * the same environment read into two operands resolves to two `{ name, variables }`
 * objects that should still test equal). */
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

function normHint(h: OperandKind | OperandHint | undefined): OperandHint | undefined {
  return h === undefined ? undefined : typeof h === 'string' ? { kind: h } : h
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

export const isNumericString = (s: string): boolean => {
  const t = s.trim()
  return t !== '' && Number.isFinite(Number(t))
}

type OrderMode = { t: 'num'; v: number } | { t: 'str'; v: string } | null

/** Datetime comparison is at SECOND precision: parse to epoch and floor off the
 * sub-second part. Two instants that render identically at the usual second
 * format but differ only in milliseconds compare equal. NaN (unparsable)
 * propagates so callers fall back to string compare. */
function dateSeconds(value: unknown): number {
  return Math.floor(Date.parse(String(value)) / 1000)
}

/** Does this value parse as a real date? Used to promote a `string` operand to
 * `date` when its partner is a declared datetime. */
function parsesAsDate(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

/** Reduce an operand to a single ordered axis (number or string), or `null` when
 * the kind has no meaningful order. Dates order by instant; an enum whose value
 * is numeric orders numerically, otherwise by its label. */
function orderModeOf(value: unknown, kind: OperandKind, enumNumeric?: boolean): OrderMode {
  switch (kind) {
    case 'number': return { t: 'num', v: typeof value === 'number' ? value : Number(value) }
    case 'string': return { t: 'str', v: String(value) }
    case 'date': {
      const s = dateSeconds(value)
      return Number.isNaN(s) ? { t: 'str', v: String(value) } : { t: 'num', v: s }
    }
    case 'enum': {
      const s = String(value)
      const asNum = enumNumeric ?? isNumericString(s)
      return asNum ? { t: 'num', v: Number(s.trim()) } : { t: 'str', v: s }
    }
    default: return null // boolean, color, object, list, unknown
  }
}

const ORDER_SYMBOL: Record<string, string> = { lt: '<', lte: '≤', gt: '>', gte: '≥' }

function orderingCompare(op: string, l: unknown, r: unknown, lk: OperandKind, rk: OperandKind, lEnumNumeric?: boolean, rEnumNumeric?: boolean): boolean {
  // Null ordering: no meaningful strict order — any null in `<`/`>` (and a null
  // vs a non-null in `<=`/`>=`) throws. The ONE meaningful case is the reflexive
  // `null <= null` / `null >= null` → true.
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
    // A NUMERIC string vs a number is still a number; a non-numeric string vs a
    // number is a real type mismatch.
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
  // null IS equal ONLY to null; anything else (object, string, number, even "")
  // is NOT equal to null.
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
  // A list contains a LIST when the right is a (multiset) SUBSET of the left;
  // a list against a non-list tests element membership.
  if (lk === 'list' && rk === 'list') return (r as unknown[]).every((y) => (l as unknown[]).some((x) => deepEqual(x, y)))
  if (lk === 'list') return (l as unknown[]).some((x) => deepEqual(x, r))
  if (STRINGISH.has(lk) && STRINGISH.has(rk)) return stringify(l).includes(stringify(r))
  throw new Error(`Operator "∋" cannot test a ${lk} for containment of a ${rk}`)
}

/** Compare two values with the operator. Optional kind hints carry the DECLARED
 * type of an inline operand so string-backed subtypes (date/colour/enum) get the
 * right treatment; without a hint the kind is inferred from the value. Ordering
 * THROWS for kinds with no meaningful order (object/list/boolean/colour) and for
 * mixed types. */
export function compareValues(op: string | undefined, l: unknown, r: unknown, lHint?: OperandKind | OperandHint, rHint?: OperandKind | OperandHint): boolean {
  const lh = normHint(lHint)
  const rh = normHint(rHint)
  const canon = op !== undefined ? OPERATOR_ALIASES[op] ?? op : 'eq'
  let lk = effectiveKind(l, lh?.kind)
  let rk = effectiveKind(r, rh?.kind)
  // Date promotion: a declared `datetime` compared against a value that RESOLVES
  // to a date string but carries no date hint (lands as `string`) — treat both as
  // dates so equality + ordering compare instants at SECOND precision.
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
