/**
 * Side-effect-free executors — they read from `activation.inputs` +
 * `node.config` and return outputs synchronously. Bundled together
 * because they share no infrastructure beyond the engine's types.
 */

import Handlebars from 'handlebars'
import type { Activation, ExecContext, NodeExecutor } from '../types'
import { LIST_MUTATION_DEFAULT_VALUE_ID } from '../../../shared/scenarioListMutationValues'
import { resolveConfigItems, applyListOp } from '../../../shared/utils/scenarioStaticPreview'
import { castValue, isScenarioCastType } from '../../../shared/scenarioCast'
import { applyRegex, isRegexOp } from '../../../shared/scenarioRegex'
import { applyJson, isJsonOp } from '../../../shared/scenarioJson'
import { applyXml, isXmlOp } from '../../../shared/scenarioXml'
import { applyYaml, isYamlOp } from '../../../shared/scenarioYaml'
import { applyCrypto, isCryptoOp } from '../../../shared/scenarioCrypto'
import { applyJwt } from '../../../shared/scenarioJwt'
import { applyDateTime, isDateTimeOp, isDateTimeUnit } from '../../../shared/scenarioDateTime'
import { applyObjectOp, isObjectOp } from '../../../shared/scenarioObject'
import { applyUrl, isUrlOp } from '../../../shared/scenarioUrl'
import { applyRandom, isRandomOp } from '../../../shared/scenarioRandom'
import { applyListOp as applyListReshape, isListOp } from '../../../shared/scenarioList'
import { evalAssert } from '../../../shared/scenarioAssert'
import { applyCsv, isCsvOp } from '../../../shared/scenarioCsv'
import { applyMath, isMathOp } from '../../../shared/scenarioMath'
import { compareValues, deepEqual, hintFromConfig, resolveOperand, type OperandHint } from '../conditionEval'

/** A wired operand's kind is inferred from its value (pass no hint); an inline
 * operand's comes from its declared type (incl. all-numeric-enum detection). */
const hint = (wired: unknown, cfg: unknown): OperandHint | undefined => (wired !== undefined ? undefined : hintFromConfig(cfg))

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
  const ra = resolveOperand(act.inputs['a'], cfg.a, ctx.variables)
  const rb = resolveOperand(act.inputs['b'], cfg.b, ctx.variables)
  // Arithmetic with null is undefined — adding / dividing / … a null operand
  // (inline NullValue or a variable that resolved to null) throws rather than
  // silently coercing null to 0.
  if (ra === null || rb === null) throw new Error('cannot do arithmetic with a null operand')
  const a = toNumber(ra)
  const b = toNumber(rb)
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
  return { outputs: [{ port: 'result', value: compareValues(cfg.operator ?? cfg.op, l, r, hint(act.inputs['a'], cfg.a), hint(act.inputs['b'], cfg.b)) }] }
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
    ? compareValues(cfg.operator ?? cfg.op, left, right, hint(act.inputs['left'], cfg.left), hint(act.inputs['right'], cfg.right))
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

/** Switch node: matches `on` against each `case` value (equality), emitting
 * the trigger on the FIRST matching case's port; if none match, emits on the
 * `default` port. Each emission carries `on` so a chain can keep routing the
 * value.
 *
 * `on` and the case values resolve exactly like `if` operands — a wired `on`
 * wins, otherwise the inline typed value (literal / `variable` / `environment`)
 * — and the match uses the shared `compareValues` equality so it honours the
 * type semantics (null IS only equal to null, dates at second precision, lists
 * by contents, …). The emitted port is the case's own id (`switch-default-case`
 * for the seeded case, `case-…` for added ones); `default` is the separate
 * always-present fallback. */
export const switchExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { on?: unknown; cases?: { id: string; value: unknown }[] }
  const on = resolveOperand(act.inputs['on'], cfg.on, ctx.variables)
  const onHint = hint(act.inputs['on'], cfg.on)
  const cases = cfg.cases ?? []
  for (const c of cases) {
    const caseValue = resolveOperand(undefined, c.value, ctx.variables)
    if (compareValues('eq', on, caseValue, onHint, hintFromConfig(c.value))) {
      return { outputs: [{ port: c.id, value: on }] }
    }
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
  // The richer assert-only operators (type checks, regex, length, …) live in
  // `evalAssert`, which delegates the shared comparators back to compareValues.
  const ok = evalAssert(cfg.operator ?? cfg.op ?? 'eq', a, b, compareValues, { a: hint(act.inputs['a'], cfg.a), b: hint(act.inputs['b'], cfg.b) })
  const value = act.inputs['in'] ?? a
  return { outputs: [{ port: ok ? 'then' : 'else', value }] }
}

/** Map node: applies the node's per-item Handlebars `expression` to each item,
 * producing `mapped`. Delegates to the SAME `applyListOp` the inspector preview
 * uses, so runtime and preview can never drift (the node persists `expression`,
 * not a bare property key). */
export const mapExecutor: NodeExecutor = (act, ctx) => {
  const items = Array.isArray(act.inputs['items']) ? act.inputs['items'] : (resolveConfigItems(ctx.node.config, ctx.variables) ?? [])
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
  const items = Array.isArray(act.inputs['items']) ? act.inputs['items'] : (resolveConfigItems(ctx.node.config, ctx.variables) ?? [])
  const out = applyListOp(ctx.node, items) ?? {}
  const kept = Array.isArray(out['kept']) ? out['kept'] : []
  const rejected = Array.isArray(out['rejected']) ? out['rejected'] : []
  return { outputs: [{ port: 'kept', value: kept }, { port: 'rejected', value: rejected }] }
}

/** Resolve the `list` target (wired or inline `list` config) to an array.
 * A non-list resolves to `[]` (the ops only make sense over a collection). */
function resolveListOperand(wired: unknown, cfg: unknown, variables: ReadonlyMap<string, unknown>): unknown[] {
  const v = resolveOperand(wired, cfg, variables)
  return Array.isArray(v) ? (v as unknown[]) : []
}

/** Resolve the `values` rows (`config.values` = `{ id, value }[]`, the same
 * shape as the object node's properties) into the FLAT ordered list of elements
 * to add/remove. A row that resolves to a LIST is CONCATENATED (spread) — adding
 * a list to a list appends its elements, symmetric with the target list — while
 * a scalar row contributes one element. A wired row arrives in `act.inputs` keyed
 * by its port id; an inline one resolves from `row.value`.
 *
 * Special-case the DEFAULT row: an unconfigured box still shows one row under
 * {@link LIST_MUTATION_DEFAULT_VALUE_ID} that is NOT persisted to
 * `config.values` until edited. If a source is wired into it, its value arrives
 * under that id with no matching config row — so honour a single wired default
 * row even when `config.values` is empty (else a lone wired value is silently
 * dropped, e.g. removeFromList finds nothing to remove). */
function resolveValueRows(act: Activation, ctx: ExecContext): unknown[] {
  const cfg = ctx.node.config as { values?: unknown }
  const rows = Array.isArray(cfg.values) && cfg.values.length > 0
    ? cfg.values
    : (act.inputs[LIST_MUTATION_DEFAULT_VALUE_ID] !== undefined ? [{ id: LIST_MUTATION_DEFAULT_VALUE_ID }] : [])
  const out: unknown[] = []
  for (const r of rows) {
    const row = r as { id?: unknown; value?: unknown }
    if (typeof row.id !== 'string') continue
    const v = resolveOperand(act.inputs[row.id], row.value, ctx.variables)
    if (Array.isArray(v)) out.push(...(v as unknown[]))
    else out.push(v)
  }
  return out
}

/** When the `list` target is an (un-wired) variable AND the box opts into
 * `updateSourceVariable`, the name of that variable — so the executor can write
 * the new list back into it (a push-style mutation), on top of emitting
 * `result`. Returns undefined when the toggle is off, the list is wired (no
 * source variable), or the target isn't a variable reference. */
function listWritebackVar(act: Activation, ctx: ExecContext): string | undefined {
  const cfg = ctx.node.config as { updateSourceVariable?: unknown; list?: unknown }
  if (cfg.updateSourceVariable !== true) return undefined
  if (act.inputs['list'] !== undefined) return undefined
  const ref = cfg.list as { type?: unknown; value?: unknown } | undefined
  return ref?.type === 'variable' && typeof ref.value === 'string' && ref.value.trim() !== '' ? ref.value : undefined
}

/** AddToList: `result` is the target list with every `values` row APPENDED (in
 * order). The list resolves like any list — a wired port, a `list` editor, or a
 * list-typed variable; each value row is one element. Pure by default (emits
 * `result`); with `updateSourceVariable` on AND a variable target, it also
 * writes the new list back into that variable (push ergonomics, explicit). */
export const addToListExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { list?: unknown }
  const list = resolveListOperand(act.inputs['list'], cfg.list, ctx.variables)
  const values = resolveValueRows(act, ctx)
  const result = [...list, ...values]
  const writeback = listWritebackVar(act, ctx)
  if (writeback) ctx.variables.set(writeback, result)
  return { outputs: [{ port: 'result', value: result }] }
}

/** RemoveFromList: `result` is the target list with every element deep-equal to
 * any `values` row removed (all occurrences). Same optional `updateSourceVariable`
 * writeback as AddToList. */
export const removeFromListExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { list?: unknown }
  const list = resolveListOperand(act.inputs['list'], cfg.list, ctx.variables)
  const values = resolveValueRows(act, ctx)
  const result = list.filter((x) => !values.some((v) => deepEqual(x, v)))
  const writeback = listWritebackVar(act, ctx)
  if (writeback) ctx.variables.set(writeback, result)
  return { outputs: [{ port: 'result', value: result }] }
}

/** Template / transform node: applies a Handlebars template to the
 * inputs. Reuses the runtime's existing Handlebars helpers. */
export const transformExecutor: NodeExecutor = (act, ctx) => {
  // The template text comes from the wired `expression` input when connected
  // (an upstream value drives the template), else from the inline editor's
  // config. The config field persists a typed value (`{ type: 'expression',
  // value }`), not a bare string — unwrap it. Feeding the object straight to
  // Handlebars throws "You must pass a string …".
  const wired = act.inputs['expression']
  const tpl = typeof wired === 'string' ? wired : expressionTemplate(ctx.node.config)
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

/** `cast`: convert the `value` operand (wired port, else inline config) to the
 * configured `targetType` via the SHARED `castValue` — the SAME implementation
 * the inspector preview calls, so they can't drift. An impossible cast (or a
 * null/empty value) THROWS, which the scheduler routes to the `error` port. */
export const castExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { targetType?: unknown; value?: unknown }
  const value = resolveOperand(act.inputs['value'], cfg.value, ctx.variables)
  const target = isScenarioCastType(cfg.targetType) ? cfg.targetType : 'string'
  return { outputs: [{ port: 'result', value: castValue(value, target) }] }
}

/** `regex`: run the configured operation (extract / extractAll / test / replace /
 * split) over the `value` string via the SHARED `applyRegex` — the SAME
 * implementation the inspector preview calls. An invalid pattern/flags THROWS,
 * routed to the `error` port; a non-match is never an error. */
export const regexExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: unknown; pattern?: unknown; flags?: unknown; replacement?: unknown; value?: unknown }
  const value = resolveOperand(act.inputs['value'], cfg.value, ctx.variables)
  const op = isRegexOp(cfg.op) ? cfg.op : 'extract'
  // `pattern` may be wired (a string input) or set inline in config.
  const wiredPattern = act.inputs['pattern']
  const pattern = typeof wiredPattern === 'string' ? wiredPattern : typeof cfg.pattern === 'string' ? cfg.pattern : ''
  const flags = typeof cfg.flags === 'string' ? cfg.flags : ''
  const replacement = typeof cfg.replacement === 'string' ? cfg.replacement : ''
  return { outputs: [{ port: 'result', value: applyRegex(value, op, pattern, flags, replacement) }] }
}

/** `json`: parse the `value` string into a value, or stringify the `value`, via
 * the SHARED `applyJson` — the SAME implementation the inspector preview calls.
 * Malformed JSON (parse) or a non-serialisable value (stringify) THROWS, routed
 * to the `error` port. */
export const jsonExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: unknown; indent?: unknown; value?: unknown }
  const value = resolveOperand(act.inputs['value'], cfg.value, ctx.variables)
  const op = isJsonOp(cfg.op) ? cfg.op : 'parse'
  const indent = typeof cfg.indent === 'number' ? cfg.indent : 0
  return { outputs: [{ port: 'result', value: applyJson(value, op, indent) }] }
}

/** `xml`: parse the `value` string into an object, or stringify the `value`, via
 * the SHARED `applyXml` — the SAME implementation the inspector preview calls.
 * Malformed XML (parse) or a non-serialisable value (stringify) THROWS, routed
 * to the `error` port. */
export const xmlExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: unknown; indent?: unknown; value?: unknown }
  const value = resolveOperand(act.inputs['value'], cfg.value, ctx.variables)
  const op = isXmlOp(cfg.op) ? cfg.op : 'parse'
  const indent = typeof cfg.indent === 'number' ? cfg.indent : 0
  return { outputs: [{ port: 'result', value: applyXml(value, op, indent) }] }
}

/** `yaml`: parse the `value` string into a value, or stringify the `value`, via
 * the SHARED `applyYaml` — the SAME implementation the inspector preview calls.
 * Malformed YAML (parse) or a non-serialisable value (stringify) THROWS, routed
 * to the `error` port. */
export const yamlExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: unknown; indent?: unknown; value?: unknown }
  const value = resolveOperand(act.inputs['value'], cfg.value, ctx.variables)
  const op = isYamlOp(cfg.op) ? cfg.op : 'parse'
  const indent = typeof cfg.indent === 'number' ? cfg.indent : 2
  return { outputs: [{ port: 'result', value: applyYaml(value, op, indent) }] }
}

/** `crypto`: encode / hash / sign the `value` string (or generate a UUID) via
 * the SHARED `applyCrypto` — the SAME implementation the inspector preview calls.
 * A `hmacSha256` with no `key`, or a `base64Decode` of a non-UTF-8 string,
 * THROWS, routed to the `error` port. */
export const cryptoExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: unknown; key?: unknown; value?: unknown }
  const value = resolveOperand(act.inputs['value'], cfg.value, ctx.variables)
  const op = isCryptoOp(cfg.op) ? cfg.op : 'sha256'
  const key = typeof cfg.key === 'string' ? cfg.key : ''
  return { outputs: [{ port: 'result', value: applyCrypto(value, op, key) }] }
}

/** `jwt`: decode the `value` token string into `{ header, payload, signature }`
 * via the SHARED `applyJwt` — the SAME implementation the inspector preview
 * calls. A malformed token THROWS, routed to the `error` port. */
export const jwtExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { value?: unknown }
  const value = resolveOperand(act.inputs['value'], cfg.value, ctx.variables)
  return { outputs: [{ port: 'result', value: applyJwt(value) }] }
}

/** `datetime`: shift / format / diff the `value` date via the SHARED
 * `applyDateTime` — the SAME implementation the inspector preview calls. An
 * unreadable date (or `other` operand for diff) THROWS, routed to the `error`
 * port. */
export const dateTimeExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: unknown; amount?: unknown; unit?: unknown; format?: unknown; other?: unknown; value?: unknown }
  const value = resolveOperand(act.inputs['value'], cfg.value, ctx.variables)
  const op = isDateTimeOp(cfg.op) ? cfg.op : 'add'
  // `amount` may be wired, a typed numeric value, or a legacy plain number.
  const amountRaw = resolveOperand(act.inputs['amount'], cfg.amount, ctx.variables)
  const amountNum = typeof amountRaw === 'number' ? amountRaw : Number.parseFloat(String(amountRaw))
  const amount = Number.isFinite(amountNum) ? amountNum : 0
  const unit = isDateTimeUnit(cfg.unit) ? cfg.unit : 'days'
  const format = typeof cfg.format === 'string' ? cfg.format : ''
  const other = resolveOperand(act.inputs['other'], cfg.other, ctx.variables)
  return { outputs: [{ port: 'result', value: applyDateTime(value, op, { amount, unit, format, other }) }] }
}

/** `objectOp`: reshape the `value` object (get/set/merge/pick/omit/keys/values)
 * via the SHARED `applyObjectOp`. A non-object operand (where the op needs one)
 * THROWS, routed to the `error` port. */
export const objectOpExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: unknown; path?: unknown; keys?: unknown; other?: unknown; value?: unknown }
  const value = resolveOperand(act.inputs['value'], cfg.value, ctx.variables)
  const op = isObjectOp(cfg.op) ? cfg.op : 'get'
  // `path` may be wired (a string input) or set inline in config.
  const wiredPath = act.inputs['path']
  const path = typeof wiredPath === 'string' ? wiredPath : typeof cfg.path === 'string' ? cfg.path : ''
  const keys = typeof cfg.keys === 'string' ? cfg.keys.split(',').map((k) => k.trim()).filter(Boolean) : []
  const other = resolveOperand(act.inputs['other'], cfg.other, ctx.variables)
  return { outputs: [{ port: 'result', value: applyObjectOp(value, op, { path, keys, other }) }] }
}

/** `url`: encode / decode / parse / build over the `value` via the SHARED
 * `applyUrl`. A malformed escape, a non-object buildQuery operand, or an
 * unparseable URL THROWS, routed to the `error` port. */
export const urlExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: unknown; value?: unknown }
  const value = resolveOperand(act.inputs['value'], cfg.value, ctx.variables)
  const op = isUrlOp(cfg.op) ? cfg.op : 'encode'
  return { outputs: [{ port: 'result', value: applyUrl(value, op) }] }
}

/** `random`: generate a value via the SHARED `applyRandom`. A `seed` makes it
 * deterministic. `pick` over an empty list THROWS, routed to the `error` port. */
export const randomExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: unknown; min?: unknown; max?: unknown; length?: unknown; seed?: unknown }
  const op = isRandomOp(cfg.op) ? cfg.op : 'int'
  // min / max / seed may be wired, an inline variable, or a literal.
  const numOpt = (wired: unknown, inline: unknown): number | undefined => {
    const r = resolveOperand(wired, inline, ctx.variables)
    const n = typeof r === 'number' ? r : Number.parseFloat(String(r))
    return Number.isFinite(n) ? n : undefined
  }
  const min = numOpt(act.inputs['min'], cfg.min)
  const max = numOpt(act.inputs['max'], cfg.max)
  const length = typeof cfg.length === 'number' ? cfg.length : undefined
  const seedRaw = resolveOperand(act.inputs['seed'], cfg.seed, ctx.variables)
  const seed = typeof seedRaw === 'number' || typeof seedRaw === 'string' ? seedRaw : undefined
  const items = resolveConfigItems(ctx.node.config, ctx.variables) ?? undefined
  // Per-run, per-node call index (kept in the run's variable store under a
  // reserved key) so a SEEDED random ADVANCES its sequence across repeated
  // calls (e.g. each loop iteration) instead of restarting at the same value.
  const seqKey = `__rng:${act.nodeId}`
  const seqPrev = ctx.variables.get(seqKey)
  const sequence = typeof seqPrev === 'number' ? seqPrev : 0
  ctx.variables.set(seqKey, sequence + 1)
  return { outputs: [{ port: 'result', value: applyRandom(op, { min, max, length, seed, items, sequence }) }] }
}

/** `listOp`: reshape a list via the SHARED `applyListOp` (scenarioList). A
 * non-list operand THROWS, routed to the `error` port. */
export const listOpExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: unknown; value?: unknown; key?: unknown; order?: unknown; depth?: unknown; size?: unknown; start?: unknown; end?: unknown }
  const value = resolveOperand(act.inputs['value'], cfg.value, ctx.variables)
  const op = isListOp(cfg.op) ? cfg.op : 'sort'
  // `key` may be wired (a string input) or set inline in config.
  const wiredKey = act.inputs['key']
  const keyRaw = typeof wiredKey === 'string' ? wiredKey : typeof cfg.key === 'string' ? cfg.key : ''
  const key = keyRaw !== '' ? keyRaw : undefined
  const order = cfg.order === 'desc' ? 'desc' : 'asc'
  const depth = typeof cfg.depth === 'number' ? cfg.depth : undefined
  const size = typeof cfg.size === 'number' ? cfg.size : undefined
  const start = typeof cfg.start === 'number' ? cfg.start : undefined
  const end = typeof cfg.end === 'number' ? cfg.end : undefined
  return { outputs: [{ port: 'result', value: applyListReshape(value, op, { key, order, depth, size, start, end }) }] }
}

/** `csv`: parse a CSV string / stringify a list via the SHARED `applyCsv`. The
 * wrong operand shape THROWS, routed to the `error` port. */
export const csvExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: unknown; value?: unknown; delimiter?: unknown; header?: unknown }
  const value = resolveOperand(act.inputs['value'], cfg.value, ctx.variables)
  const op = isCsvOp(cfg.op) ? cfg.op : 'parse'
  // `delimiter` may be wired (a string input) or set inline in config.
  const wiredDelim = act.inputs['delimiter']
  const delimRaw = typeof wiredDelim === 'string' ? wiredDelim : typeof cfg.delimiter === 'string' ? cfg.delimiter : ''
  const delimiter = delimRaw !== '' ? delimRaw : undefined
  const header = cfg.header !== false
  return { outputs: [{ port: 'result', value: applyCsv(value, op, { delimiter, header }) }] }
}

/** `math`: run a scalar op on `a` via the SHARED `applyMath`. The second
 * operand (min/max), clamp bounds + round precision come from config. A
 * non-finite operand (or a negative sqrt) THROWS, routed to the `error` port. */
export const mathExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: unknown; a?: unknown; b?: unknown; min?: unknown; max?: unknown; precision?: unknown }
  const a = resolveOperand(act.inputs['a'], cfg.a, ctx.variables)
  const op = isMathOp(cfg.op) ? cfg.op : 'round'
  const b = resolveOperand(undefined, cfg.b, ctx.variables)
  const min = resolveOperand(undefined, cfg.min, ctx.variables)
  const max = resolveOperand(undefined, cfg.max, ctx.variables)
  // `precision` may be wired (a number input) or set inline in config.
  const precRaw = resolveOperand(act.inputs['precision'], cfg.precision, ctx.variables)
  const precN = typeof precRaw === 'number' ? precRaw : Number.parseFloat(String(precRaw))
  const precision = Number.isFinite(precN) ? precN : undefined
  return { outputs: [{ port: 'result', value: applyMath(a, op, { b, min, max, precision }) }] }
}

/** `throw`: deliberately fail with the resolved `message` (wired or inline). The
 * scheduler routes the throw to the node's `error` port, or fails the run if
 * nothing handles it — the basis of error branches + retry testing. */
export const throwExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { message?: unknown }
  const msg = resolveOperand(act.inputs['message'], cfg.message, ctx.variables)
  throw new Error(typeof msg === 'string' && msg !== '' ? msg : 'Scenario threw deliberately')
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
