/**
 * Side-effect-free executors — they read from `activation.inputs` +
 * `node.config` and return outputs synchronously. Bundled together
 * because they share no infrastructure beyond the engine's types.
 */

import Handlebars from 'handlebars'
import type { NodeExecutor } from '../types'
import { literalConfigItems, applyListOp } from '../../../shared/utils/scenarioStaticPreview'
import { compareValues, resolveOperand } from '../conditionEval'

/** The arithmetic operator toggle persists its SYMBOL vocabulary (`+ − × ÷ %`,
 * with `−` the Unicode minus U+2212, `×` U+00D7, `÷` U+00F7); the executor
 * speaks canonical names. Map both (plus ASCII fallbacks) so the persisted
 * symbol drives the right operation instead of silently defaulting to add. */
const ARITH_OP_ALIASES: Record<string, 'add' | 'sub' | 'mul' | 'div' | 'mod' | 'pow'> = {
  '+': 'add', add: 'add',
  '−': 'sub', '-': 'sub', sub: 'sub',
  '×': 'mul', '*': 'mul', mul: 'mul',
  '÷': 'div', '/': 'div', div: 'div',
  '%': 'mod', mod: 'mod',
  '^': 'pow', pow: 'pow'
}

/** Arithmetic node: `op(a, b)`. The operator comes from `config.operator` (the
 * toggle's persisted SYMBOL) with `config.op` as a legacy fallback. Operands
 * come from the wired ports when present, else the box's inline typed-value
 * config — so `cpt − 1` (a `variable` operand read live from the run store)
 * works without links, exactly like `comparator` / `if`. */
export const arithmeticExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: string; operator?: string; a?: unknown; b?: unknown }
  const a = toNumber(resolveOperand(act.inputs['a'], cfg.a, ctx.variables))
  const b = toNumber(resolveOperand(act.inputs['b'], cfg.b, ctx.variables))
  const rawOp = cfg.operator ?? cfg.op
  const op = (rawOp !== undefined ? ARITH_OP_ALIASES[rawOp] : undefined) ?? 'add'
  let value: number
  switch (op) {
    case 'add': value = a + b; break
    case 'sub': value = a - b; break
    case 'mul': value = a * b; break
    case 'div':
      if (b === 0) throw new Error('division by zero')
      value = a / b
      break
    case 'mod': value = a % b; break
    case 'pow': value = a ** b; break
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
  const cfg = ctx.node.config as { op?: string; operator?: string }
  const a = Boolean(act.inputs['a'])
  const b = Boolean(act.inputs['b'])
  let value: boolean
  // The toggle persists `operator` with the uppercase label (`AND`/`OR`/`XOR`);
  // accept that, the legacy `op`, and any case.
  switch ((cfg.operator ?? cfg.op ?? '').toLowerCase()) {
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
  // The taken branch carries data forward. A wired `in` passes straight
  // through; otherwise emit BOTH operands as `{ left, right }` — surfacing one
  // operand and not the other (the old behaviour) made no sense.
  const value = act.inputs['in'] !== undefined ? act.inputs['in'] : { left, right }
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
  const cfg = ctx.node.config as { name?: string; value?: unknown }
  const name = cfg.name ?? ''
  // A wired `value` wins; otherwise resolve the box's INLINE typed-value field
  // (`config.value`) — including a `variable` reference read live. Reading only
  // the wired input stored `undefined` for an inline `N = 5`, collapsing every
  // downstream read to 0.
  const value = resolveOperand(act.inputs['value'], cfg.value, ctx.variables)
  if (name) ctx.variables.set(name, value)
  // No `event` output any more — completion is signalled by the universal
  // `Done` port (driven by the scheduler when the box's sub-graph drains).
  return { outputs: [] }
}

export const getVariableExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { value?: unknown; name?: string }
  // The node box stores the picked variable under `config.value` as a typed
  // `variable` reference (`{ type:'variable', value:'<name>' }`) — the same key
  // the static preview reads. A legacy `config.name` is the fallback.
  const ref = cfg.value as { type?: unknown; value?: unknown } | undefined
  const name = ref?.type === 'variable' && typeof ref.value === 'string' ? ref.value : (cfg.name ?? '')
  const value = ctx.variables.get(name)
  return { outputs: [{ port: 'value', value }] }
}

/** Object builder: assembles inputs (port id == property name) into
 * an object on the `object` port (canonical id). */
export const objectExecutor: NodeExecutor = (act, ctx) => {
  // Properties live in `config.properties` (`{ id, name, value }[]`), the same
  // shape the inspector preview reads. A wired property arrives in `act.inputs`
  // keyed by its port id (`prop.id`); an inline one resolves from `prop.value`.
  // The assembled object keys by `prop.name`. Reading only `act.inputs` (keyed
  // by id, not name) silently dropped every inline property → an empty object.
  const cfg = ctx.node.config as { properties?: unknown }
  const props = Array.isArray(cfg.properties) ? cfg.properties : []
  const value: Record<string, unknown> = {}
  for (const p of props) {
    const prop = p as { id?: unknown; name?: unknown; value?: unknown }
    if (typeof prop.name !== 'string' || prop.name === '' || typeof prop.id !== 'string') continue
    value[prop.name] = resolveOperand(act.inputs[prop.id], prop.value, ctx.variables)
  }
  return { outputs: [{ port: 'object', value }] }
}

/** Log node: pushes one user-facing log entry; passes the value
 * through so the chain can continue. */
export const logExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { level?: 'debug' | 'info' | 'warn' | 'error'; message?: unknown; data?: unknown }
  const data = resolveOperand(act.inputs['data'], cfg.data, ctx.variables)
  // `message` accepts any type. A wired input wins; otherwise an EXPRESSION
  // config renders Handlebars with the resolved `data` as its context (so
  // `{{name}}` reads `data.name`), and every other type resolves through
  // `resolveOperand` (a `variable` reads its LIVE value, not the `{{cpt}}`
  // template `concreteValue` renders for the static preview).
  const msgCfg = cfg.message as { type?: unknown; value?: unknown } | undefined
  const resolvedMessage = act.inputs['message'] === undefined && msgCfg?.type === 'expression' && typeof msgCfg.value === 'string'
    ? renderHandlebars(msgCfg.value, data ?? {})
    : resolveOperand(act.inputs['message'], cfg.message, ctx.variables)
  const message = typeof resolvedMessage === 'string' ? resolvedMessage : (resolvedMessage == null ? '' : stringifySafely(resolvedMessage))
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

/** Coerce an arithmetic operand to a finite number, or THROW so the run routes
 * to the node's `error` port. An unset / empty operand is the field's `0`
 * placeholder (not an error); a real non-numeric value (a string like "aaa", an
 * object, NaN/∞) is a genuine mistake the user must see — silently treating it
 * as 0 hides the bug. */
function toNumber(v: unknown): number {
  if (v === undefined || v === null) return 0
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`arithmetic operand is not a number: ${v}`)
    return v
  }
  if (typeof v === 'string') {
    if (v.trim() === '') return 0
    const n = Number(v)
    if (Number.isFinite(n)) return n
    throw new Error(`arithmetic operand is not a number: "${v}"`)
  }
  throw new Error(`arithmetic operand is not a number: ${typeof v}`)
}

function stringifySafely(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  return ''
}
