/**
 * Shared condition evaluation for the comparison-based nodes (`if`,
 * `comparator`, `assert`) AND the conditional loops (`while`, `doWhile`,
 * which the scheduler re-evaluates each iteration). Centralised here so
 * the executors and the scheduler agree on operand resolution + the
 * operator vocabulary.
 */
import { concreteValue } from '../../shared/utils/scenarioStaticPreview'

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
export function compareValues(op: string | undefined, l: unknown, r: unknown): boolean {
  switch (op !== undefined ? OPERATOR_ALIASES[op] ?? op : 'eq') {
    case 'lt': return (l as number) < (r as number)
    case 'lte': return (l as number) <= (r as number)
    case 'eq': return l === r
    case 'gte': return (l as number) >= (r as number)
    case 'gt': return (l as number) > (r as number)
    case 'ne': return l !== r
    case 'contains': return stringify(l).includes(stringify(r))
    default: return l === r
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
