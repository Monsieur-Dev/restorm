/**
 * Side-effect-free executors — they read from `activation.inputs` +
 * `node.config` and return outputs synchronously. Bundled together
 * because they share no infrastructure beyond the engine's types.
 */

import Handlebars from 'handlebars'
import type { NodeExecutor } from '../types'

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

/** Comparator: compares `left` and `right` via `op`, emits boolean. */
export const comparatorExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: string }
  const l = act.inputs['left']
  const r = act.inputs['right']
  let value: boolean
  switch (cfg.op) {
    case 'lt': value = (l as number) < (r as number); break
    case 'lte': value = (l as number) <= (r as number); break
    case 'eq': value = l === r; break
    case 'gte': value = (l as number) >= (r as number); break
    case 'gt': value = (l as number) > (r as number); break
    case 'ne': value = l !== r; break
    case 'contains': value = String(l).includes(String(r)); break
    default: value = l === r; break
  }
  return { outputs: [{ port: 'result', value }] }
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

/** If node: route to `then` or `else` based on the condition. The
 * passthrough port `value` carries the input value forward. */
export const ifExecutor: NodeExecutor = (act) => {
  const cond = Boolean(act.inputs['condition'])
  const value = act.inputs['value']
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

/** Set / Get variable: writes / reads the run's variable store. */
export const setVariableExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { name?: string }
  const name = cfg.name ?? ''
  const value = act.inputs['value']
  if (name) ctx.variables.set(name, value)
  return { outputs: [{ port: 'value', value }] }
}

export const getVariableExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { name?: string }
  const name = cfg.name ?? ''
  const value = ctx.variables.get(name)
  return { outputs: [{ port: 'value', value }] }
}

/** Object builder: assembles inputs (port id == property name) into
 * an object on the `value` port. */
export const objectExecutor: NodeExecutor = (act) => {
  const value: Record<string, unknown> = { ...act.inputs }
  return { outputs: [{ port: 'value', value }] }
}

/** Log node: pushes one user-facing log entry; passes the value
 * through so the chain can continue. */
export const logExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { level?: 'debug' | 'info' | 'warn' | 'error'; message?: string }
  const data = act.inputs['data']
  ctx.log({
    level: cfg.level ?? 'info',
    source: 'user',
    nodeId: ctx.node.id,
    scope: act.scope,
    message: cfg.message ?? '',
    data
  })
  return { outputs: [{ port: 'value', value: data }] }
}

/** Assert node: throws when the predicate is false, otherwise
 * forwards the value. The error port routes the failure when wired. */
export const assertExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { message?: string }
  const ok = Boolean(act.inputs['condition'])
  const value = act.inputs['value']
  if (!ok) throw new Error(cfg.message ?? 'assertion failed')
  return { outputs: [{ port: 'value', value }] }
}

/** Map node: applies a (statically-validated) transform to each item.
 * For now the transform is `(item) => item[property]` selected by
 * config; future iterations will allow a template / sub-expression. */
export const mapExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { property?: string }
  const items = Array.isArray(act.inputs['items']) ? act.inputs['items'] : []
  const prop = cfg.property
  const value = prop
    ? items.map((it) => (it as Record<string, unknown> | null)?.[prop])
    : items
  return { outputs: [{ port: 'mapped', value }] }
}

/** Filter node: keeps items satisfying a comparator predicate. */
export const filterExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { property?: string; op?: string; value?: unknown }
  const items = Array.isArray(act.inputs['items']) ? act.inputs['items'] : []
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
  if (tpl === '') return { outputs: [{ port: 'value', value: act.inputs['value'] }] }
  const value = renderHandlebars(tpl, { ...act.inputs, ...Object.fromEntries(ctx.variables) })
  return { outputs: [{ port: 'value', value }] }
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
