/**
 * Side-effect-free executors — they read from `activation.inputs` +
 * `node.config` and return outputs synchronously. Bundled together
 * because they share no infrastructure beyond the engine's types.
 */

import Handlebars from 'handlebars'
import type { NodeExecutor } from '../types'
import { literalConfigItems, concreteValue, applyListOp } from '../../../shared/utils/scenarioStaticPreview'
import { compareValues, resolveOperand } from '../conditionEval'

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

/** Comparator: compares operands `a` and `b` via the operator, emits
 * boolean on `result`. Operands come from the wired ports when present,
 * else the node's inline typed-value config — so `comparator 1 < 2`
 * works without links. (Canonical port ids are `a` / `b` / `result`.) */
export const comparatorExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: string; operator?: string; a?: unknown; b?: unknown }
  const l = resolveOperand(act.inputs['a'], cfg.a, ctx.variables)
  const r = resolveOperand(act.inputs['b'], cfg.b, ctx.variables)
  return { outputs: [{ port: 'result', value: compareValues(cfg.operator ?? cfg.op, l, r) }] }
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
  const cfg = ctx.node.config as { op?: string; operator?: string; left?: unknown; right?: unknown }
  // Operands: a wired port wins; otherwise the box's inline typed value
  // (resolved to a primitive). This is what makes `if 1 = 2`, and a
  // while/doWhile whose condition is set inline, actually evaluate —
  // rather than silently falling back to the trigger's truthiness.
  const left = resolveOperand(act.inputs['left'], cfg.left, ctx.variables)
  const right = resolveOperand(act.inputs['right'], cfg.right, ctx.variables)
  const hasOperands = left !== undefined || right !== undefined
  const cond = hasOperands
    ? compareValues(cfg.operator ?? cfg.op, left, right)
    : Boolean(act.inputs['in'])
  const value = act.inputs['in'] ?? left
  return { outputs: [{ port: cond ? 'then' : 'else', value }] }
}

/** While / Do-While: a SCOPE-based conditional loop the scheduler drives.
 * The executor only marks the loop; the scheduler runs the body (`then`)
 * in a scope, waits for it to finish, re-evaluates the condition, and
 * repeats while true — emitting `else` (done) when it turns false. `while`
 * tests before the first body; `doWhile` runs the body once first. The
 * condition is the same operand/operator as `if` (re-read each iteration
 * from the inline config / wired latched values). */
export const whileExecutor: NodeExecutor = () => ({ outputs: [], scopeAction: { type: 'conditionalLoop', mode: 'while' } })
export const doWhileExecutor: NodeExecutor = () => ({ outputs: [], scopeAction: { type: 'conditionalLoop', mode: 'doWhile' } })

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
  // `message` (like `data`) prefers a WIRED input over config: when an
  // upstream node feeds `message`, log that; otherwise resolve the node's
  // configured ValueType (`{ type, value }`) to its concrete string. Reading
  // config only would silently drop a wired message and log an empty line.
  const resolvedMessage = act.inputs['message'] !== undefined ? act.inputs['message'] : concreteValue(cfg.message)
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
  const cfg = ctx.node.config as { op?: string; operator?: string; a?: unknown; b?: unknown }
  const a = resolveOperand(act.inputs['a'], cfg.a, ctx.variables)
  const b = resolveOperand(act.inputs['b'], cfg.b, ctx.variables)
  const ok = compareValues(cfg.operator ?? cfg.op ?? 'eq', a, b)
  const value = act.inputs['in'] ?? a
  return { outputs: [{ port: ok ? 'then' : 'else', value }] }
}

/** Map node: applies the node's per-item Handlebars `expression` to each item,
 * producing `mapped`. Delegates to the SAME `applyListOp` the inspector preview
 * uses, so runtime and preview can never drift (the node persists `expression`,
 * not a bare property key). */
export const mapExecutor: NodeExecutor = (act, ctx) => {
  const items = Array.isArray(act.inputs['items']) ? act.inputs['items'] : (literalConfigItems(ctx.node.config) ?? [])
  const out = applyListOp(ctx.node, items) ?? {}
  const mapped = Array.isArray(out['mapped']) ? out['mapped'] : items
  return { outputs: [{ port: 'mapped', value: mapped }] }
}

/** Filter node: partitions items by the predicate `field <operator> value` —
 * matches on `kept`, non-matches on `rejected` (so dropped items can be routed,
 * not lost). Delegates to the SAME `applyListOp` the inspector preview uses, so
 * runtime and preview can never drift (the node persists `field`, not the
 * legacy `property`). */
export const filterExecutor: NodeExecutor = (act, ctx) => {
  const items = Array.isArray(act.inputs['items']) ? act.inputs['items'] : (literalConfigItems(ctx.node.config) ?? [])
  const out = applyListOp(ctx.node, items) ?? {}
  const kept = Array.isArray(out['kept']) ? out['kept'] : []
  const rejected = Array.isArray(out['rejected']) ? out['rejected'] : []
  return { outputs: [{ port: 'kept', value: kept }, { port: 'rejected', value: rejected }] }
}

/** Template / transform node: applies a Handlebars template to the
 * inputs. Reuses the runtime's existing Handlebars helpers. */
export const transformExecutor: NodeExecutor = (act, ctx) => {
  // The expression field persists a typed value (`{ type: 'expression',
  // value }`), not a bare string — unwrap it to the template text. Feeding
  // the object straight to Handlebars throws "You must pass a string …".
  const tpl = expressionTemplate(ctx.node.config)
  // Output is wrapped as `{ result }` on the `out` port — the SAME shape the
  // static preview models (`scenarioStaticPreview` → `{ result }`), so the
  // auto-deduced edge selector (`result`) resolves identically at runtime.
  // Emitting a bare value here would leave that selector pointing at a
  // missing `.result` and downstream nodes would receive `undefined`.
  if (tpl === '') return { outputs: [{ port: 'out', value: { result: act.inputs['value'] } }] }
  // Render with the `value` input ITSELF as the Handlebars context — exactly
  // like the inspector preview (`staticScenarioPreview`'s transform case). An
  // object's keys are accessible directly (`{{name}}`); a primitive (e.g. after
  // an edge selector picked `.name` → "Glaude") is `{{.}}` / `{{this}}`. Using
  // the value as the context — not a `{ value, …inputs }` WRAPPER — is what
  // makes `{{.}}` resolve to the value instead of rendering the wrapper object
  // as "[object Object]". Keeps runtime and preview identical.
  const result = renderHandlebars(tpl, act.inputs['value'] ?? {})
  return { outputs: [{ port: 'out', value: { result } }] }
}

/** The transform's Handlebars template text, unwrapped from the persisted
 * expression config (`{ type: 'expression', value }` or a bare string). */
function expressionTemplate(config: unknown): string {
  const raw = (config as { expression?: unknown } | null)?.expression
  if (typeof raw === 'string') return raw
  if (raw !== null && typeof raw === 'object' && 'value' in raw) {
    const v = (raw as { value: unknown }).value
    if (typeof v === 'string') return v
  }
  return ''
}

function renderHandlebars(template: string, ctx: unknown): string {
  // `noEscape` to match the inspector preview + the map executor (both compile
  // with it). Without it, `{{name}}` over "Tom & Jerry" renders "Tom &amp;
  // Jerry" at runtime but "Tom & Jerry" in the preview — a silent drift.
  return Handlebars.compile(template, { noEscape: true })(ctx)
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
