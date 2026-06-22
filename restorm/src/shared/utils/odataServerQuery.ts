/**
 * OData v4 system-query-option EXECUTOR (server side).
 *
 * The client-side helpers (`odataQuery.ts`, `odataExpand.ts`,
 * `odataOrderby` UI) only SERIALISE options into an outgoing URL. This
 * module does the inverse: it APPLIES the parsed options to an
 * in-memory collection so Restorm can answer as a local OData mock.
 *
 * Supported options: `$filter`, `$select`, `$orderby`, `$top`, `$skip`,
 * `$count`, `$expand`.
 *
 * Supported `$filter` grammar (a pragmatic v4 subset — documented so the
 * boundary is explicit; lambda `any`/`all`, arithmetic, and date
 * functions are intentionally out of scope for v1):
 *
 *   filter      = orExpr
 *   orExpr      = andExpr ( 'or' andExpr )*
 *   andExpr     = unary ( 'and' unary )*
 *   unary       = 'not' unary | primary
 *   primary     = '(' filter ')'
 *               | funcCall
 *               | comparison
 *   comparison  = operand ( 'eq'|'ne'|'gt'|'ge'|'lt'|'le' ) operand
 *   funcCall    = ('contains'|'startswith'|'endswith') '(' operand ',' operand ')'
 *   operand     = property | string | number | boolean | 'null'
 *
 * Property references may be dotted (e.g. `Category/Name`) to read into a
 * nested object. String literals use single quotes with `''` escaping.
 */

import { parseExpand, type ExpandNode } from './odataExpand'

/** A single served record. Plain JSON object (entity). */
export type ODataEntity = Record<string, unknown>

/** The options the executor understands, mirroring the persisted
 * {@link import('../types/requests/ODataRequest').ODataQueryOptions} but
 * already split into the shapes the executor needs. */
export interface ParsedODataQueryOptions {
  filter?: string
  select?: string[]
  orderby?: string
  /** Parsed integer page size; `undefined` when absent / invalid. */
  top?: number
  /** Parsed integer skip count; `undefined` when absent / invalid. */
  skip?: number
  count?: boolean
  /** Raw `$expand` clause; parsed lazily via {@link parseExpand}. */
  expand?: string
}

/** Resolves a navigation property's related collection for `$expand`.
 * Returns the child entities for `navProperty` on `entity`, or
 * `undefined` if the relationship is unknown (left untouched). */
export type ExpandResolver = (
  entity: ODataEntity,
  navProperty: string
) => unknown

export interface ApplyODataQueryResult {
  /** The transformed collection (filtered / ordered / paged / projected /
   * expanded). */
  value: ODataEntity[]
  /** Total count BEFORE `$top`/`$skip` paging — emitted as
   * `@odata.count` when `$count=true`. `undefined` when not requested. */
  count?: number
}

/**
 * Apply the OData system query options to `collection` in spec order:
 * `$filter` → `$orderby` → (`$count` snapshot) → `$skip` → `$top` →
 * `$select` → `$expand`.
 *
 * The collection is treated immutably — a new array of (possibly
 * projected) entities is returned; input entities are never mutated.
 */
export function applyODataQuery(
  collection: readonly ODataEntity[],
  options: ParsedODataQueryOptions,
  expandResolver?: ExpandResolver
): ApplyODataQueryResult {
  let rows: ODataEntity[] = collection.slice()

  if (options.filter !== undefined && options.filter.trim() !== '') {
    const ast = parseFilter(options.filter)
    rows = rows.filter((row) => toBool(evaluate(ast, row)))
  }

  if (options.orderby !== undefined && options.orderby.trim() !== '') {
    rows = applyOrderby(rows, options.orderby)
  }

  // $count reflects the size AFTER $filter but BEFORE paging.
  const count = options.count === true ? rows.length : undefined

  if (options.skip !== undefined && options.skip > 0) {
    rows = rows.slice(options.skip)
  }
  if (options.top !== undefined && options.top >= 0) {
    rows = rows.slice(0, options.top)
  }

  // $expand runs before $select so an expanded nav-property survives a
  // projection that doesn't list it (per the v4 rule that $expand items
  // are implicitly selected).
  let expandNodes: ExpandNode[] = []
  if (options.expand !== undefined && options.expand.trim() !== '') {
    expandNodes = parseExpand(options.expand)
  }
  if (expandNodes.length > 0 && expandResolver) {
    rows = rows.map((row) => expandEntity(row, expandNodes, expandResolver))
  }

  if (options.select !== undefined && options.select.length > 0) {
    const keep = options.select.map((s) => s.trim()).filter((s) => s !== '')
    const expandKeys = new Set(expandNodes.map((n) => n.property))
    rows = rows.map((row) => projectEntity(row, keep, expandKeys))
  }

  return count === undefined ? { value: rows } : { value: rows, count }
}

/** Coerce a raw `$top`/`$skip` string into a non-negative integer, or
 * `undefined` when absent / non-numeric (a templated `{{n}}` that was
 * never resolved is treated as absent). */
export function parsePagingValue(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  if (trimmed === '' || !/^\d+$/.test(trimmed)) return undefined
  return Number(trimmed)
}

// ───────────────────────────── $orderby ─────────────────────────────

interface OrderbyKey {
  path: string[]
  desc: boolean
}

function parseOrderby(clause: string): OrderbyKey[] {
  const keys: OrderbyKey[] = []
  for (const part of clause.split(',')) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    const tokens = trimmed.split(/\s+/)
    const prop = tokens[0]
    const dir = (tokens[1] ?? 'asc').toLowerCase()
    keys.push({ path: prop.split('/'), desc: dir === 'desc' })
  }
  return keys
}

function applyOrderby(rows: ODataEntity[], clause: string): ODataEntity[] {
  const keys = parseOrderby(clause)
  if (keys.length === 0) return rows
  // Stable sort: decorate with the original index as the final tiebreak.
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const key of keys) {
        const cmp = compareValues(readPath(a.row, key.path), readPath(b.row, key.path))
        if (cmp !== 0) return key.desc ? -cmp : cmp
      }
      return a.index - b.index
    })
    .map((d) => d.row)
}

/** Three-way compare with OData null-ordering (null sorts before any
 * value, ascending). Numbers compare numerically, strings
 * lexicographically, booleans false<true. */
function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0
  const aNil = a === null || a === undefined
  const bNil = b === null || b === undefined
  if (aNil && bNil) return 0
  if (aNil) return -1
  if (bNil) return 1
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1
  const as = primitiveToString(a)
  const bs = primitiveToString(b)
  return as < bs ? -1 : as > bs ? 1 : 0
}

/** Stringify a scalar for lexicographic compare. Objects/arrays aren't
 * comparable operands in the supported $filter/$orderby subset, so they
 * collapse to an empty string rather than `[object Object]`. */
function primitiveToString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return ''
}

// ───────────────────────────── $select ──────────────────────────────

function projectEntity(
  entity: ODataEntity,
  keep: string[],
  expandKeys: Set<string>
): ODataEntity {
  const out: ODataEntity = {}
  // Preserve OData control annotations (@odata.*) on the projected entity.
  for (const [k, v] of Object.entries(entity)) {
    if (k.includes('@odata.')) out[k] = v
  }
  for (const prop of keep) {
    if (prop in entity) out[prop] = entity[prop]
  }
  // Expanded navigation properties are implicitly selected.
  for (const navProp of expandKeys) {
    if (navProp in entity) out[navProp] = entity[navProp]
  }
  return out
}

// ───────────────────────────── $expand ──────────────────────────────

function expandEntity(
  entity: ODataEntity,
  nodes: readonly ExpandNode[],
  resolver: ExpandResolver
): ODataEntity {
  const out: ODataEntity = { ...entity }
  for (const node of nodes) {
    if (node.property.trim() === '') continue
    const related = resolver(entity, node.property)
    if (related === undefined) continue

    if (Array.isArray(related)) {
      // A to-many relationship: apply the node's own nested options.
      const nested = applyODataQuery(
        related as ODataEntity[],
        {
          select: node.select,
          filter: node.filter,
          orderby: node.orderby,
          top: parsePagingValue(node.top),
          skip: parsePagingValue(node.skip),
          expand: node.expand ? serializeExpandChildren(node.expand) : undefined
        },
        resolver
      )
      out[node.property] = nested.value
    } else if (related !== null && typeof related === 'object') {
      // A to-one relationship: expand recursively if there are children.
      const child = related as ODataEntity
      out[node.property] =
        node.expand && node.expand.length > 0
          ? expandEntity(child, node.expand, resolver)
          : child
    } else {
      out[node.property] = related
    }
  }
  return out
}

/** Re-serialise a nested ExpandNode[] back to a `$expand` clause so the
 * recursive {@link applyODataQuery} call can re-parse it uniformly. */
function serializeExpandChildren(nodes: readonly ExpandNode[]): string {
  return nodes
    .filter((n) => n.property.trim() !== '')
    .map((n) => n.property)
    .join(',')
}

// ───────────────────────── $filter parser ───────────────────────────

type FilterNode =
  | { kind: 'and'; left: FilterNode; right: FilterNode }
  | { kind: 'or'; left: FilterNode; right: FilterNode }
  | { kind: 'not'; operand: FilterNode }
  | { kind: 'compare'; op: ComparisonOp; left: FilterNode; right: FilterNode }
  | { kind: 'func'; name: StringFn; args: FilterNode[] }
  | { kind: 'property'; path: string[] }
  | { kind: 'literal'; value: string | number | boolean | null }

type ComparisonOp = 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le'
type StringFn = 'contains' | 'startswith' | 'endswith'

const COMPARISON_OPS = new Set<string>(['eq', 'ne', 'gt', 'ge', 'lt', 'le'])
const STRING_FNS = new Set<string>(['contains', 'startswith', 'endswith'])

type Token =
  | { type: 'word'; value: string }
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' }

/** Tokenise a `$filter` expression. Whitespace separates words;
 * single-quoted strings (with `''` escape) and parens/commas are their
 * own tokens. */
function tokenizeFilter(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = input.length
  while (i < n) {
    const ch = input[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen' })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' })
      i++
      continue
    }
    if (ch === ',') {
      tokens.push({ type: 'comma' })
      i++
      continue
    }
    if (ch === "'") {
      let str = ''
      i++ // opening quote
      while (i < n) {
        if (input.charAt(i) === "'") {
          if (input.charAt(i + 1) === "'") {
            str += "'"
            i += 2
            continue
          }
          i++ // closing quote
          break
        }
        str += input.charAt(i)
        i++
      }
      tokens.push({ type: 'string', value: str })
      continue
    }
    // A bare word: property path, keyword, function name, number, bool.
    let word = ''
    while (i < n && !' \t\n\r(),'.includes(input.charAt(i)) && input.charAt(i) !== "'") {
      word += input.charAt(i)
      i++
    }
    if (word === '') {
      i++
      continue
    }
    if (/^-?\d+(\.\d+)?$/.test(word)) {
      tokens.push({ type: 'number', value: Number(word) })
    } else {
      tokens.push({ type: 'word', value: word })
    }
  }
  return tokens
}

class FilterParser {
  private pos = 0
  constructor(private readonly tokens: Token[]) {}

  parse(): FilterNode {
    const node = this.parseOr()
    if (this.pos < this.tokens.length) {
      throw new Error(`Unexpected token in $filter at position ${this.pos}`)
    }
    return node
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private isKeyword(kw: string): boolean {
    const t = this.peek()
    return t?.type === 'word' && t.value.toLowerCase() === kw
  }

  private parseOr(): FilterNode {
    let left = this.parseAnd()
    while (this.isKeyword('or')) {
      this.pos++
      const right = this.parseAnd()
      left = { kind: 'or', left, right }
    }
    return left
  }

  private parseAnd(): FilterNode {
    let left = this.parseUnary()
    while (this.isKeyword('and')) {
      this.pos++
      const right = this.parseUnary()
      left = { kind: 'and', left, right }
    }
    return left
  }

  private parseUnary(): FilterNode {
    if (this.isKeyword('not')) {
      this.pos++
      return { kind: 'not', operand: this.parseUnary() }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): FilterNode {
    const t = this.peek()
    if (t === undefined) throw new Error('Unexpected end of $filter expression')

    if (t.type === 'lparen') {
      this.pos++
      const inner = this.parseOr()
      this.expect('rparen')
      return inner
    }

    // Function call: contains(...) / startswith(...) / endswith(...)
    if (t.type === 'word' && STRING_FNS.has(t.value.toLowerCase()) && this.tokens[this.pos + 1]?.type === 'lparen') {
      const name = t.value.toLowerCase() as StringFn
      this.pos += 2 // consume word + lparen
      const args: FilterNode[] = [this.parseOperand()]
      this.expect('comma')
      args.push(this.parseOperand())
      this.expect('rparen')
      return { kind: 'func', name, args }
    }

    // Comparison: operand op operand
    const left = this.parseOperand()
    const opTok = this.peek()
    if (opTok?.type === 'word' && COMPARISON_OPS.has(opTok.value.toLowerCase())) {
      const op = opTok.value.toLowerCase() as ComparisonOp
      this.pos++
      const right = this.parseOperand()
      return { kind: 'compare', op, left, right }
    }
    // A bare operand (e.g. a boolean property) is truthy on its own.
    return left
  }

  private parseOperand(): FilterNode {
    const t = this.peek()
    if (t === undefined) throw new Error('Expected an operand in $filter')
    if (t.type === 'string') {
      this.pos++
      return { kind: 'literal', value: t.value }
    }
    if (t.type === 'number') {
      this.pos++
      return { kind: 'literal', value: t.value }
    }
    if (t.type === 'word') {
      this.pos++
      const lower = t.value.toLowerCase()
      if (lower === 'true') return { kind: 'literal', value: true }
      if (lower === 'false') return { kind: 'literal', value: false }
      if (lower === 'null') return { kind: 'literal', value: null }
      return { kind: 'property', path: t.value.split('/') }
    }
    throw new Error(`Unexpected token type "${t.type}" where an operand was expected`)
  }

  private expect(type: Token['type']): void {
    const t = this.peek()
    if (t?.type !== type) {
      throw new Error(`Expected ${type} in $filter expression`)
    }
    this.pos++
  }
}

/** Parse a `$filter` expression into an AST. Throws on a malformed
 * expression — callers (the server) should answer 400 on a parse error. */
export function parseFilter(expression: string): FilterNode {
  return new FilterParser(tokenizeFilter(expression)).parse()
}

// ──────────────────────── $filter evaluator ─────────────────────────

function evaluate(node: FilterNode, entity: ODataEntity): unknown {
  switch (node.kind) {
    case 'and':
      return toBool(evaluate(node.left, entity)) && toBool(evaluate(node.right, entity))
    case 'or':
      return toBool(evaluate(node.left, entity)) || toBool(evaluate(node.right, entity))
    case 'not':
      return !toBool(evaluate(node.operand, entity))
    case 'literal':
      return node.value
    case 'property':
      return readPath(entity, node.path)
    case 'func':
      return evaluateFunc(node, entity)
    case 'compare':
      return evaluateCompare(node, entity)
    default:
      return false
  }
}

function evaluateFunc(node: Extract<FilterNode, { kind: 'func' }>, entity: ODataEntity): boolean {
  const subject = evaluate(node.args[0], entity)
  const search = evaluate(node.args[1], entity)
  if (typeof subject !== 'string' || typeof search !== 'string') return false
  switch (node.name) {
    case 'contains':
      return subject.includes(search)
    case 'startswith':
      return subject.startsWith(search)
    case 'endswith':
      return subject.endsWith(search)
    default:
      return false
  }
}

function evaluateCompare(node: Extract<FilterNode, { kind: 'compare' }>, entity: ODataEntity): boolean {
  const left = evaluate(node.left, entity)
  const right = evaluate(node.right, entity)
  switch (node.op) {
    case 'eq':
      return looseEqual(left, right)
    case 'ne':
      return !looseEqual(left, right)
    case 'gt':
      return compareValues(left, right) > 0
    case 'ge':
      return compareValues(left, right) >= 0
    case 'lt':
      return compareValues(left, right) < 0
    case 'le':
      return compareValues(left, right) <= 0
    default:
      return false
  }
}

/** OData `eq`/`ne` equality. `null` only equals `null`/`undefined`;
 * everything else compares by value with number/string coercion kept
 * strict (a string `'1'` does NOT equal the number `1`). */
function looseEqual(a: unknown, b: unknown): boolean {
  const aNil = a === null || a === undefined
  const bNil = b === null || b === undefined
  if (aNil || bNil) return aNil && bNil
  return a === b
}

function toBool(value: unknown): boolean {
  return value === true
}

/** Read a dotted/`/`-delimited property path out of an entity, walking
 * into nested objects. Returns `undefined` for a missing segment. */
function readPath(entity: ODataEntity, path: string[]): unknown {
  let current: unknown = entity
  for (const segment of path) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}
