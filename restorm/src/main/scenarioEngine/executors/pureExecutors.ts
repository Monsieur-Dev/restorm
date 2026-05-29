/**
 * Side-effect-free executors — they read from `activation.inputs` +
 * `node.config` and return outputs synchronously. Bundled together
 * because they share no infrastructure beyond the engine's types.
 */

import Handlebars from 'handlebars'
import type { NodeExecutor } from '../types'
import { literalConfigItems, concreteValue } from '../../../shared/utils/scenarioStaticPreview'

/** Arithmetic node: `op(a, b)` with op from config. */
export const arithmeticExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: string }
  const a = toNumber(act.inputs['a'])
  const b = toNumber(act.inputs['b'])
  let value: number
  switch (cfg.op) {
    case 'add': value = a + b; break
    case 'sub': value = a - b; break
    case 'mul': value = a * b; break
    case 'div':
      if (b === 0) throw new Error('division by zero')
      value = a / b
      break
    case 'mod': value = a % b; break
    case 'pow': value = a ** b; break
    default: value = a + b; break
  }
  return { outputs: [{ port: 'result', value }] }
}

/** Comparator: compares operands `a` and `b` via `op`, emits boolean
 * on `result`. (Canonical port ids are `a` / `b` / `result`.) */
export const comparatorExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: string }
  const l = act.inputs['a']
  const r = act.inputs['b']
  return { outputs: [{ port: 'result', value: compare(cfg.op, l, r) }] }
}

/** Shared comparison used by comparator / if / assert. */
function compare(op: string | undefined, l: unknown, r: unknown): boolean {
  switch (op) {
    case 'lt': return (l as number) < (r as number)
    case 'lte': return (l as number) <= (r as number)
    case 'eq': return l === r
    case 'gte': return (l as number) >= (r as number)
    case 'gt': return (l as number) > (r as number)
    case 'ne': return l !== r
    case 'contains': return stringifySafely(l).includes(stringifySafely(r))
    default: return l === r
  }
}

/** Boolean node: `op(a, b)` → boolean. */
export const booleanExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: string }
  const a = Boolean(act.inputs['a'])
  const b = Boolean(act.inputs['b'])
  let value: boolean
  switch (cfg.op) {
    case 'and': value = a && b; break
    case 'or': value = a || b; break
    case 'xor': value = a !== b; break
    case 'not': value = !a; break
    default: value = a && b; break
  }
  return { outputs: [{ port: 'result', value }] }
}

/** If node: compares operands `left` / `right` with the config
 * operator, routing the trigger value to `then` / `else`. (Canonical
 * inputs are `in` / `left` / `right`; outputs `then` / `else`.) When
 * no operator/operands are wired, falls back to the truthiness of the
 * `in` signal so a bare `if` still routes. */
export const ifExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: string }
  const hasOperands = act.inputs['left'] !== undefined || act.inputs['right'] !== undefined
  const cond = hasOperands
    ? compare(cfg.op, act.inputs['left'], act.inputs['right'])
    : Boolean(act.inputs['in'])
  const value = act.inputs['in'] ?? act.inputs['left']
  return { outputs: [{ port: cond ? 'then' : 'else', value }] }
}

/** Switch node: matches `on` against the `case` values in config; if
 * none match, emits on the `default` port. Each emission carries
 * `on` so a chain can keep routing the value. */
export const switchExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { cases?: { id: string; value: unknown }[] }
  const on = act.inputs['on']
  const cases = cfg.cases ?? []
  for (const c of cases) {
    if (c.value === on) return { outputs: [{ port: `case-${c.id}`, value: on }] }
  }
  return { outputs: [{ port: 'default', value: on }] }
}

/** Now node: current time according to the host clock. The format is
 * controlled by config; defaults to ISO string. */
export const nowExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { format?: string }
  const d = new Date()
  let value: string | number
  switch (cfg.format) {
    case 'epoch': value = d.getTime(); break
    case 'string': value = d.toString(); break
    case 'datetime':
    default: value = d.toISOString(); break
  }
  return { outputs: [{ port: 'value', value }] }
}

/** Set / Get variable: writes / reads the run's variable store.
 * `setVariable` emits a signal on `event` (canonical port id). */
export const setVariableExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { name?: string }
  const name = cfg.name ?? ''
  const value = act.inputs['value']
  if (name) ctx.variables.set(name, value)
  return { outputs: [{ port: 'event', value }] }
}

export const getVariableExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { name?: string }
  const name = cfg.name ?? ''
  const value = ctx.variables.get(name)
  return { outputs: [{ port: 'value', value }] }
}

/** Object builder: assembles inputs (port id == property name) into
 * an object on the `object` port (canonical id). */
export const objectExecutor: NodeExecutor = (act) => {
  const value: Record<string, unknown> = { ...act.inputs }
  return { outputs: [{ port: 'object', value }] }
}

/** Log node: pushes one user-facing log entry; passes the value
 * through so the chain can continue. */
export const logExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { level?: 'debug' | 'info' | 'warn' | 'error'; message?: unknown; data?: unknown }
  // `message` is persisted as a typed ValueType (`{ type, value }`), not a
  // bare string — resolve it to its concrete string. Wired `data` wins;
  // otherwise resolve the node's configured data value.
  const resolvedMessage = concreteValue(cfg.message)
  const message = typeof resolvedMessage === 'string' ? resolvedMessage : (resolvedMessage == null ? '' : stringifySafely(resolvedMessage))
  const data = act.inputs['data'] !== undefined ? act.inputs['data'] : (cfg.data !== undefined ? concreteValue(cfg.data) : undefined)
  ctx.log({
    level: cfg.level ?? 'info',
    source: 'user',
    nodeId: ctx.node.id,
    scope: act.scope,
    message,
    data
  })
  return { outputs: [{ port: 'value', value: data }] }
}

/** Assert node: compares operands `a` (actual) / `b` (expected) with
 * the config operator, routing the trigger to `then` (pass) or `else`
 * (fail). Canonical inputs `in` / `a` / `b`; outputs `then` / `else`. */
export const assertExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: string }
  const ok = compare(cfg.op ?? 'eq', act.inputs['a'], act.inputs['b'])
  const value = act.inputs['in'] ?? act.inputs['a']
  return { outputs: [{ port: ok ? 'then' : 'else', value }] }
}

/** Map node: applies a (statically-validated) transform to each item.
 * For now the transform is `(item) => item[property]` selected by
 * config; future iterations will allow a template / sub-expression. */
export const mapExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { property?: string }
  const items = Array.isArray(act.inputs['items']) ? act.inputs['items'] : (literalConfigItems(ctx.node.config) ?? [])
  const prop = cfg.property
  const value = prop
    ? items.map((it) => (it as Record<string, unknown> | null)?.[prop])
    : items
  return { outputs: [{ port: 'mapped', value }] }
}

/** Filter node: keeps items satisfying a comparator predicate. */
export const filterExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { property?: string; op?: string; value?: unknown }
  const items = Array.isArray(act.inputs['items']) ? act.inputs['items'] : (literalConfigItems(ctx.node.config) ?? [])
  const op = cfg.op ?? 'eq'
  const cmp = cfg.value
  const prop = cfg.property
  const value = items.filter((it) => {
    const v: unknown = prop !== undefined ? (it as Record<string, unknown> | null)?.[prop] : it
    switch (op) {
      case 'lt': return (v as number) < (cmp as number)
      case 'lte': return (v as number) <= (cmp as number)
      case 'gte': return (v as number) >= (cmp as number)
      case 'gt': return (v as number) > (cmp as number)
      case 'ne': return v !== cmp
      case 'contains': return stringifySafely(v).includes(String(cmp))
      case 'eq':
      default: return v === cmp
    }
  })
  return { outputs: [{ port: 'kept', value }] }
}

/** Template / transform node: applies a Handlebars template to the
 * inputs. Reuses the runtime's existing Handlebars helpers. */
export const transformExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { expression?: string }
  const tpl = cfg.expression ?? ''
  // Canonical output port id is `out` (name "value").
  if (tpl === '') return { outputs: [{ port: 'out', value: act.inputs['value'] }] }
  const value = renderHandlebars(tpl, { ...act.inputs, ...Object.fromEntries(ctx.variables) })
  return { outputs: [{ port: 'out', value }] }
}

function renderHandlebars(template: string, ctx: Record<string, unknown>): string {
  return Handlebars.compile(template)(ctx)
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function stringifySafely(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  return ''
}
