/**
 * Per-kind executor registry. Returns a `Map<nodeId, NodeExecutor>`
 * the scheduler can index by node id directly — wrapping is per-kind
 * (no need to do a switch on every dispatch).
 */

import type { NodeExecutor, ExecContext } from '../types'
import type { ScenarioModel } from '../types'
import {
  arithmeticExecutor,
  comparatorExecutor,
  booleanExecutor,
  ifExecutor,
  whileExecutor,
  doWhileExecutor,
  switchExecutor,
  nowExecutor,
  setVariableExecutor,
  getVariableExecutor,
  objectExecutor,
  logExecutor,
  assertExecutor,
  mapExecutor,
  filterExecutor,
  addToListExecutor,
  removeFromListExecutor,
  transformExecutor,
  castExecutor,
  regexExecutor,
  jsonExecutor
} from './pureExecutors'
import {
  waitExecutor,
  waitUntilExecutor,
  forEachExecutor,
  forExecutor,
  aggregateExecutor
} from './timeAndFlowExecutors'
import { httpRequestExecutor } from './httpRequestExecutor'
import { runScenarioExecutor } from './runScenarioExecutor'
import { concreteValue } from '../../../shared/utils/scenarioStaticPreview'
import { readInputParams } from '../../../shared/scenarioInputParams'
import { readOutputDecls } from '../../../shared/scenarioOutputDecls'

/** An `input` node either: (a) seeded at run start with the user's
 * up-front value (the editor's pre-run modal) — pure passthrough; or
 * (b) activated mid-run because an upstream node fed a value into it
 * — in that case we surface a single-field prompt so the user can
 * confirm / edit before the value flows downstream. The `seeded`
 * flag on the activation distinguishes the two paths. */
/** Publish each of the input's resolved params into the run's variable store,
 * so a `{{param1}}` reference resolves at execution exactly as the editor's
 * picker + static preview advertise it (input params ARE scenario variables). */
function publishInputVariables(value: unknown, ctx: ExecContext): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return
  for (const [name, v] of Object.entries(value as Record<string, unknown>)) ctx.variables.set(name, v)
}

export const inputExecutor: NodeExecutor = async (act, ctx) => {
  // The seed activation already carries the `{ [name]: value, … }` object
  // (see `Scheduler.seedRoots`); pass it through verbatim.
  if (act.seeded === true) {
    const value = act.inputs['value']
    publishInputVariables(value, ctx)
    return { outputs: [{ port: 'value', value }] }
  }
  // An input prompts for EACH declared param and emits one object keyed by the
  // param names — the same shape the static preview + seeded path model, so a
  // wired selector resolves identically. The prompts are raised CONCURRENTLY
  // (not awaited one-at-a-time): the up-front modal collects every param at once
  // and resolves them in a single submit, so all requests must be pending
  // together — a sequential await would force one Run click per param. A
  // predecessor-wired (mid-run) input still surfaces them one-at-a-time, since
  // the editor shows the single-field prompt for whichever request it finds
  // first; the others simply stay pending until their turn.
  const params = readInputParams(ctx.node.config)
  const wired = act.inputs['value']
  const wiredObj = wired !== null && typeof wired === 'object' ? wired as Record<string, unknown> : null
  const entries = await Promise.all(params.map(async (param) => {
    const name = param.name.trim() !== '' ? param.name.trim() : 'value'
    const configuredDefault = param.valueType !== undefined && param.valueType !== null
      ? concreteValue(param.valueType)
      : undefined
    // Prefill: a wired object carrying this param name wins; a single bare
    // wired value prefills a single param; otherwise the param's own default.
    const prefill = wiredObj && name in wiredObj
      ? wiredObj[name]
      : (params.length === 1 && wired !== undefined ? wired : configuredDefault)
    // A non-interactive run (MCP / headless e2e / a sub-scenario reached by a
    // headless parent) can't surface a prompt — it would await forever — so it
    // takes the prefill (wired value or configured default) straight through.
    const value = ctx.interactive
      ? await ctx.requestUserInput({
        name,
        defaultValue: prefill,
        hint: inferHint((param.valueType as { type?: string } | undefined)?.type),
        // Carry the param's full typed-value shape so the mid-run prompt can render
        // the matching editor (a datetime picker, a custom-list combobox, …) rather
        // than collapsing every non-number/boolean type to a bare text field.
        ...(param.valueType !== undefined && param.valueType !== null ? { valueType: param.valueType } : {})
      })
      : prefill
    return [name, value] as const
  }))
  const value = Object.fromEntries(entries)
  publishInputVariables(value, ctx)
  return { outputs: [{ port: 'value', value }] }
}

function inferHint(t: string | undefined): 'string' | 'number' | 'boolean' | 'object' {
  switch (t) {
    case 'number': return 'number'
    case 'boolean': return 'boolean'
    case 'object': return 'object'
    case 'string':
    default: return 'string'
  }
}

/** `output` node: exposes one or more named scenario outputs. Each declared
 * output reads its OWN `value` input port (id = the decl id) and emits on an
 * `output:<name>` port; the engine container (see `engine.startWithStack`)
 * harvests those into the run's result map. A blank-named decl is skipped. */
const outputPassthroughExecutor: NodeExecutor = (act, ctx) => {
  const decls = readOutputDecls(ctx.node.config)
  return {
    outputs: decls
      .filter((d) => d.name.trim() !== '')
      // Wired value wins; otherwise fall back to the decl's literal `value`
      // (the same affordance the `object` builder gives each property).
      .map((d) => ({
        port: `output:${d.name.trim()}`,
        value: act.inputs[d.id] !== undefined ? act.inputs[d.id] : (d.value !== undefined ? concreteValue(d.value) : undefined)
      }))
  }
}

export function buildExecutorRegistry(scenario: ScenarioModel): Map<string, NodeExecutor> {
  const out = new Map<string, NodeExecutor>()
  for (const node of scenario.nodes) {
    out.set(node.id, pickExecutor(node.kind))
  }
  return out
}

function pickExecutor(kind: string): NodeExecutor {
  switch (kind) {
    case 'arithmetic': return arithmeticExecutor
    case 'comparator': return comparatorExecutor
    case 'boolean': return booleanExecutor
    case 'if': return ifExecutor
    case 'switch': return switchExecutor
    case 'now': return nowExecutor
    case 'setVariable': return setVariableExecutor
    case 'getVariable': return getVariableExecutor
    case 'object': return objectExecutor
    case 'log': return logExecutor
    case 'assert': return assertExecutor
    case 'map': return mapExecutor
    case 'filter': return filterExecutor
    case 'addToList': return addToListExecutor
    case 'removeFromList': return removeFromListExecutor
    case 'transform': return transformExecutor
    case 'cast': return castExecutor
    case 'regex': return regexExecutor
    case 'json': return jsonExecutor
    case 'wait': return waitExecutor
    case 'waitUntil': return waitUntilExecutor
    case 'forEach': return forEachExecutor
    case 'for': return forExecutor
    // `while` / `doWhile` are engine-managed scope loops: the executor marks
    // the loop, the scheduler runs the body + re-evaluates the condition each
    // iteration (no manual loop-back edge needed).
    case 'while': return whileExecutor
    case 'doWhile': return doWhileExecutor
    case 'aggregate': return aggregateExecutor
    case 'httpRequest':
    case 'request': return httpRequestExecutor
    case 'runScenario': return runScenarioExecutor
    case 'input': return inputExecutor
    case 'output': return outputPassthroughExecutor
    default: throw new Error(`no executor for kind '${kind}'`)
  }
}
