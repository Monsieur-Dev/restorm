import type { TFunction } from 'i18next'
import type { ScenarioNodeKind, Scenario } from './types/collections'
import { readInputParams, INPUT_DEFAULT_PARAM_ID } from './scenarioInputParams'
import { OBJECT_DEFAULT_PROPERTY_ID } from './scenarioObjectProps'
import { readOutputDecls, OUTPUT_DEFAULT_DECL_ID } from './scenarioOutputDecls'
import { outputPortFlow, inputPortFlow } from './scenarioNodePorts'

/**
 * Per-box validation: a box is "in error" when it's in a state that prevents
 * it from being executed (a missing required input, an unwired data link with
 * no path, a missing name, incompatible operand types, …). Each error carries
 * a stable `code` and a precise, already-translated `message`. The editor
 * paints a red border + disables the play button on any box with errors, and
 * aggregates every box's errors into the workflow error panel.
 *
 * Rules are added kind by kind; a kind with no rule yet validates clean.
 */
export interface ScenarioNodeError {
  code: string
  message: string
  /** Logical id of the box field/control this error points at (e.g. `'name'`),
   * so the box can outline that control in red. Omit for box-wide errors. */
  field?: string
}

/** The minimal node shape the validators read. */
export interface ValidationNode {
  id: string
  kind: ScenarioNodeKind
  config: Record<string, unknown>
}

export interface ScenarioValidationContext {
  /** Every node in the scenario — for cross-node checks (name collisions, …). */
  nodes: ValidationNode[]
  /** Wired input ports, keyed `${nodeId} ${portId}` — for "input must be
   * connected" checks. */
  connectedTargets: Set<string>
  t: TFunction
}

/** Key for {@link ScenarioValidationContext.connectedTargets}. */
export function targetKey(nodeId: string, portId: string): string {
  return `${nodeId} ${portId}`
}

function trimmedName(node: ValidationNode): string {
  return typeof node.config['name'] === 'string' ? node.config['name'].trim() : ''
}

/** `input` — declares one or more named params, each with a typed default.
 * Every param needs a name. A predecessor-LESS input runs up-front, so its
 * param names must be unique across the whole scenario's up-front declared names
 * (this input's other params, other predecessor-less inputs' params, and
 * `setVariable` boxes). A predecessor-WIRED input runs mid-flow in its own
 * branch, so it's exempt from the inter-action rule — only its OWN params must
 * not collide with each other. The error `field` is the PARAM id, so the box
 * outlines that param's name input. */
function validateInput(node: ValidationNode, ctx: ScenarioValidationContext): ScenarioNodeError[] {
  const errors: ScenarioNodeError[] = []
  const params = readInputParams(node.config)
  // An input with NO params still shows one empty default row in the editor —
  // flag THAT row (its stable id) so a freshly-added input reports the missing
  // name immediately, exactly like a row whose name was typed then cleared.
  if (params.length === 0) {
    return [{ code: 'missing-name', field: INPUT_DEFAULT_PARAM_ID, message: ctx.t('scenario.validation.input.missingName', 'This input parameter must have a name.') }]
  }
  const hasPredecessor = ctx.connectedTargets.has(targetKey(node.id, 'in'))
  const counts = hasPredecessor ? localNameCounts(node) : collisionNameCounts(ctx)
  for (const p of params) {
    const name = p.name.trim()
    if (!name) {
      errors.push({ code: 'missing-name', field: p.id, message: ctx.t('scenario.validation.input.missingName', 'This input parameter must have a name.') })
    } else if ((counts.get(name) ?? 0) > 1) {
      errors.push({ code: 'duplicate-name', field: p.id, message: ctx.t('scenario.validation.duplicateName', 'The name "{{name}}" is already used by another action.', { name }) })
    }
  }
  return errors
}

/** A single input node's own param-name counts — for the within-node duplicate
 * check that applies even to a predecessor-wired (otherwise exempt) input. */
function localNameCounts(node: ValidationNode): Map<string, number> {
  const counts = new Map<string, number>()
  for (const p of readInputParams(node.config)) {
    const n = p.name.trim()
    if (n) counts.set(n, (counts.get(n) ?? 0) + 1)
  }
  return counts
}

/** Count of every declared output NAME across all output nodes — `> 1` ⇒ a
 * collision (two scenario outputs would shadow each other). */
function outputNameCounts(ctx: ScenarioValidationContext): Map<string, number> {
  const counts = new Map<string, number>()
  for (const n of ctx.nodes) {
    if (n.kind !== 'output') continue
    for (const d of readOutputDecls(n.config)) {
      const name = d.name.trim()
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return counts
}

/** `output` — declares one or more named scenario outputs, each fed by its own
 * `value` input port (id = the decl id). Every decl needs a name, unique across
 * all outputs, with its value wired. An empty output shows one default row —
 * flag THAT row, like input / object. The error `field` is the decl id. */
function validateOutput(node: ValidationNode, ctx: ScenarioValidationContext): ScenarioNodeError[] {
  const decls = readOutputDecls(node.config)
  if (decls.length === 0) {
    return [{ code: 'missing-name', field: OUTPUT_DEFAULT_DECL_ID, message: ctx.t('scenario.validation.output.missingName', 'This output must have a name.') }]
  }
  const errors: ScenarioNodeError[] = []
  const counts = outputNameCounts(ctx)
  for (const d of decls) {
    const name = d.name.trim()
    if (!name) {
      errors.push({ code: 'missing-name', field: d.id, message: ctx.t('scenario.validation.output.missingName', 'This output must have a name.') })
      continue
    }
    if ((counts.get(name) ?? 0) > 1) {
      errors.push({ code: 'duplicate-name', field: d.id, message: ctx.t('scenario.validation.output.duplicateName', 'The name "{{name}}" is already used by another output.', { name }) })
    }
    if (!ctx.connectedTargets.has(targetKey(node.id, d.id))) {
      errors.push({ code: 'value-required', field: d.id, message: ctx.t('scenario.validation.output.valueRequired', 'The "value" input must be wired to a source.') })
    }
  }
  return errors
}

/** How many times each name is declared in the scenario's UP-FRONT scope — the
 * PARAM names of predecessor-less `input` boxes + each `setVariable` name.
 * `> 1` ⇒ a collision. Predecessor-wired inputs run mid-flow in their own
 * branch and are excluded, so reusing an up-front name from a wired input is
 * not flagged. */
function collisionNameCounts(ctx: ScenarioValidationContext): Map<string, number> {
  const counts = new Map<string, number>()
  const add = (raw: string): void => { const n = raw.trim(); if (n) counts.set(n, (counts.get(n) ?? 0) + 1) }
  for (const n of ctx.nodes) {
    if (n.kind === 'input') {
      if (ctx.connectedTargets.has(targetKey(n.id, 'in'))) continue
      for (const p of readInputParams(n.config)) add(p.name)
    } else if (n.kind === 'setVariable') { add(trimmedName(n)) }
  }
  return counts
}

/** Names that EXIST in scenario scope — every `input` param (wired or not) +
 * each `setVariable` name. Drives `getVariable` existence (a variable declared
 * by a mid-flow input is still a real, readable variable). */
function declaredVariableNames(ctx: ScenarioValidationContext): Set<string> {
  const names = new Set<string>()
  for (const n of ctx.nodes) {
    if (n.kind === 'input') { for (const p of readInputParams(n.config)) { const t = p.name.trim(); if (t) names.add(t) } }
    else if (n.kind === 'setVariable') { const t = trimmedName(n); if (t) names.add(t) }
  }
  return names
}

/** `getVariable` — reads a variable chosen via its value selector. */
function validateGetVariable(node: ValidationNode, ctx: ScenarioValidationContext): ScenarioNodeError[] {
  const ref = node.config['value'] as { type?: unknown; value?: unknown } | undefined
  // An environment reference is resolved elsewhere; only the `variable` case
  // (the default) is validated against the scenario's declared variables.
  if (ref && ref.type !== 'variable') return []
  const name = typeof ref?.value === 'string' ? ref.value.trim() : ''
  if (!name) {
    return [{ code: 'no-variable', field: 'value', message: ctx.t('scenario.validation.getVariable.noSelection', 'A variable must be selected.') }]
  }
  if (!declaredVariableNames(ctx).has(name)) {
    return [{ code: 'unknown-variable', field: 'value', message: ctx.t('scenario.validation.getVariable.unknown', 'The variable "{{name}}" does not exist in the scenario.', { name }) }]
  }
  return []
}

/** `setVariable` — stores a value into a named variable. A name is required;
 * an empty value is allowed, and writing the same variable from several boxes
 * is legitimate (so no duplicate-name rule). */
function validateSetVariable(node: ValidationNode, ctx: ScenarioValidationContext): ScenarioNodeError[] {
  if (!trimmedName(node)) {
    return [{ code: 'missing-name', field: 'name', message: ctx.t('scenario.validation.setVariable.missingName', 'The variable to set must have a name.') }]
  }
  return []
}

/** `object` — assembles a structured object from named properties. Each
 * property needs a name (a JSON key) and names must be unique; an object with
 * no properties is allowed (empty `{}`). The error `field` is the property id,
 * so the box outlines that property's name input. */
function validateObject(node: ValidationNode, ctx: ScenarioValidationContext): ScenarioNodeError[] {
  const raw = node.config['properties']
  const props = Array.isArray(raw)
    ? raw.filter((p): p is { id: string; name?: unknown } => typeof p === 'object' && p !== null && typeof (p as { id?: unknown }).id === 'string')
    : []
  // An object with NO properties still shows one empty default row — flag THAT
  // row (its stable id) so a freshly-added object reports the missing name.
  if (props.length === 0) {
    return [{ code: 'object-prop-missing-name', field: OBJECT_DEFAULT_PROPERTY_ID, message: ctx.t('scenario.validation.object.propMissingName', 'Each property must have a name.') }]
  }
  const errors: ScenarioNodeError[] = []
  const counts = new Map<string, number>()
  for (const p of props) {
    const name = typeof p.name === 'string' ? p.name.trim() : ''
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  for (const p of props) {
    const name = typeof p.name === 'string' ? p.name.trim() : ''
    if (!name) {
      errors.push({ code: 'object-prop-missing-name', field: p.id, message: ctx.t('scenario.validation.object.propMissingName', 'Each property must have a name.') })
    } else if ((counts.get(name) ?? 0) > 1) {
      errors.push({ code: 'object-prop-duplicate', field: p.id, message: ctx.t('scenario.validation.object.propDuplicate', 'The property name "{{name}}" is duplicated.', { name }) })
    }
  }
  return errors
}

/** `arithmetic` — `÷` / `%` by a literal zero operand `b` is unresolvable. Only
 * a literal operand is checked: a wired `b` or a variable/environment reference
 * resolves at run time, so its value isn't known here. The default (absent) `b`
 * is a numeric `0`, so it counts as a literal zero too. The error points at the
 * `b` operand field. */
function validateArithmetic(node: ValidationNode, ctx: ScenarioValidationContext): ScenarioNodeError[] {
  const operator = node.config['operator']
  if (operator !== '÷' && operator !== '%') return []
  if (ctx.connectedTargets.has(targetKey(node.id, 'b'))) return []
  const b = node.config['b']
  // Absent `b` falls back to the box's numeric-0 default.
  const isLiteralZero = b === undefined || (typeof b === 'object' && b !== null && (b as { type?: unknown }).type === 'numeric' && (b as { value?: unknown }).value === 0)
  if (!isLiteralZero) return []
  return [{ code: 'division-by-zero', field: 'b', message: ctx.t('scenario.validation.arithmetic.divisionByZero', 'Division by zero is impossible.') }]
}

/** Canonical key for a switch case's persisted value, so two cases that route
 * the same value collide. Covers the literal kinds the case selector offers
 * (string / numeric / boolean / variable / environment …) by keying on type +
 * payload. */
function caseValueKey(value: unknown): string {
  if (typeof value !== 'object' || value === null) return 'string:""'
  const v = value as Record<string, unknown>
  const type = typeof v['type'] === 'string' ? v['type'] : 'string'
  return `${type}:${JSON.stringify(v['value'] ?? v['labels'] ?? v['label'] ?? '')}`
}

/** Human-readable rendering of a case value for the duplicate message. */
function caseValueDisplay(value: unknown): string {
  if (typeof value !== 'object' || value === null) return ''
  const raw = (value as { value?: unknown }).value
  return typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : ''
}

/** `switch` — routes the `on` value to the first matching case. Two cases with
 * the same value make the second unreachable (first match wins), so duplicate
 * case values are flagged on every colliding case (its value field is
 * outlined). The error `field` is the case id. */
function validateSwitch(node: ValidationNode, ctx: ScenarioValidationContext): ScenarioNodeError[] {
  const raw = node.config['cases']
  const cases = Array.isArray(raw)
    ? raw.filter((c): c is { id: string; value?: unknown } => typeof c === 'object' && c !== null && typeof (c as { id?: unknown }).id === 'string')
    : []
  const counts = new Map<string, number>()
  for (const c of cases) {
    const key = caseValueKey(c.value)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const errors: ScenarioNodeError[] = []
  for (const c of cases) {
    if ((counts.get(caseValueKey(c.value)) ?? 0) > 1) {
      errors.push({ code: 'switch-case-duplicate', field: c.id, message: ctx.t('scenario.validation.switch.caseDuplicate', 'The case value "{{value}}" is duplicated.', { value: caseValueDisplay(c.value) }) })
    }
  }
  return errors
}

/** `transform` — applies a Handlebars/expression template to its optional
 * `value` input. The template body is the box's only meaningful config, so an
 * empty body produces nothing: it's required. Malformed-template detection is
 * left to run time (a static parse risks false positives). The error points at
 * the `expression` field. */
function validateTransform(node: ValidationNode, ctx: ScenarioValidationContext): ScenarioNodeError[] {
  const expr = node.config['expression'] as { value?: unknown } | undefined
  const body = typeof expr?.value === 'string' ? expr.value.trim() : ''
  if (!body) {
    return [{ code: 'empty-template', field: 'expression', message: ctx.t('scenario.validation.transform.emptyTemplate', 'The template must not be empty.') }]
  }
  // A template that interpolates anything (`{{…}}`) needs the `value` input
  // to feed the Handlebars context — the input has no inline fallback.
  if (body.includes('{{') && !ctx.connectedTargets.has(targetKey(node.id, 'value'))) {
    return [{ code: 'value-input-required', field: 'value', message: ctx.t('scenario.validation.transform.valueRequired', 'The "value" input must be connected when the template references {{…}}.') }]
  }
  return []
}

/** Validate a single box. Kinds without a rule yet return no errors. */
export function validateScenarioNode(node: ValidationNode, ctx: ScenarioValidationContext): ScenarioNodeError[] {
  switch (node.kind) {
    case 'input':
      return validateInput(node, ctx)
    case 'output':
      return validateOutput(node, ctx)
    case 'getVariable':
      return validateGetVariable(node, ctx)
    case 'setVariable':
      return validateSetVariable(node, ctx)
    case 'object':
      return validateObject(node, ctx)
    case 'arithmetic':
      return validateArithmetic(node, ctx)
    case 'switch':
      return validateSwitch(node, ctx)
    case 'transform':
      return validateTransform(node, ctx)
    default:
      return []
  }
}

/** An incoming data link (a value/both output wired into a data input),
 * carrying the JSON-path selector applied to the value in transit. */
export interface ScenarioDataLink {
  targetNodeId: string
  targetPort: string
  selector: string | undefined
}

/** A JSON-path selector: a root segment then dot-fields / [index] / ['key']
 * segments (e.g. `response.body.items[0].name`). Used to reject a malformed
 * selector on a data link. A lone `.` is the identity selector — the source's
 * whole value flows through (used by object-context inputs like
 * `transform.value`).
 *
 * The ROOT may itself be a bracket-quoted key (`['Anwser to the universe']`),
 * because an upstream object key can contain spaces / punctuation that a bare
 * identifier can't express. Subsequent segments also allow `.<digit>` for the
 * array indices the path picker historically emitted (`response.body.0.id`),
 * alongside the canonical `[<digit>]`. */
const SELECTOR_SEGMENT = String.raw`\.[A-Za-z_$][\w$]*|\.\d+|\[\d+\]|\['[^']*'\]|\["[^"]*"\]`
const SELECTOR_ROOT = String.raw`[A-Za-z_$][\w$]*|\[\d+\]|\['[^']*'\]|\["[^"]*"\]`
const SELECTOR_RE = new RegExp(`^(?:${SELECTOR_ROOT})(?:${SELECTOR_SEGMENT})*$`)

export function isValidSelectorPath(selector: string): boolean {
  const trimmed = selector.trim()
  return trimmed === '.' || SELECTOR_RE.test(trimmed)
}

/** A data link with an empty or malformed selector is an error on the box that
 * consumes it (the selector decides which part of the upstream value flows in,
 * so it must be present and well-formed). */
function validateDataLinks(dataLinks: ScenarioDataLink[], t: TFunction): Map<string, ScenarioNodeError[]> {
  const byNode = new Map<string, ScenarioNodeError[]>()
  const add = (nodeId: string, error: ScenarioNodeError): void => {
    const list = byNode.get(nodeId)
    if (list) list.push(error)
    else byNode.set(nodeId, [error])
  }
  for (const link of dataLinks) {
    const selector = link.selector?.trim() ?? ''
    if (!selector) {
      add(link.targetNodeId, { code: 'data-link-empty-path', field: link.targetPort, message: t('scenario.validation.dataLink.emptyPath', 'The incoming data link needs a JSON path.') })
    } else if (!isValidSelectorPath(selector)) {
      add(link.targetNodeId, { code: 'data-link-bad-path', field: link.targetPort, message: t('scenario.validation.dataLink.badPath', 'The data link JSON path "{{path}}" is malformed.', { path: selector }) })
    }
  }
  return byNode
}

/** Validate every box; returns a map of node id → errors (only boxes in error
 * are present). `dataLinks` carries the incoming data links + their selectors
 * for the generic empty/malformed-path rule. */
export function validateScenarioGraph(nodes: ValidationNode[], dataLinks: ScenarioDataLink[], connectedTargets: Set<string>, t: TFunction): Map<string, ScenarioNodeError[]> {
  const ctx: ScenarioValidationContext = { nodes, connectedTargets, t }
  const byNode = new Map<string, ScenarioNodeError[]>()
  for (const node of nodes) {
    const errors = validateScenarioNode(node, ctx)
    if (errors.length > 0) byNode.set(node.id, errors)
  }
  for (const [nodeId, errors] of validateDataLinks(dataLinks, t)) {
    const existing = byNode.get(nodeId)
    if (existing) existing.push(...errors)
    else byNode.set(nodeId, errors)
  }
  return byNode
}

/**
 * Validate a persisted scenario MODEL (the engine's view), deriving the
 * `connectedTargets` + `dataLinks` the graph validator needs straight from
 * `scenario.edges` — so the main-process engine can refuse to run a scenario
 * that carries the very errors the editor paints red, WITHOUT importing any
 * renderer code. The single source of truth for "is this scenario runnable".
 *
 * Covers the config-level rules (missing/duplicate names, division-by-zero,
 * switch/object duplicates, unwired required output, empty template, data-link
 * selectors). It does NOT run the editor's resolver-dependent pass (a deleted
 * bound request, a runScenario's required sub-inputs) — those need the live
 * collection tree and stay an editor-only gate.
 */
export function validateScenarioModel(scenario: Pick<Scenario, 'nodes' | 'edges'>, t: TFunction): Map<string, ScenarioNodeError[]> {
  const nodes: ValidationNode[] = scenario.nodes.map((n) => ({ id: n.id, kind: n.kind, config: n.config }))
  const connectedTargets = new Set<string>()
  for (const e of scenario.edges) {
    if (e.to.nodeId && e.to.portId) connectedTargets.add(targetKey(e.to.nodeId, e.to.portId))
  }
  const byId = new Map(scenario.nodes.map((n) => [n.id, n]))
  const dataLinks: ScenarioDataLink[] = []
  for (const e of scenario.edges) {
    const src = byId.get(e.from.nodeId)
    const tgt = byId.get(e.to.nodeId)
    if (!src || !tgt || !e.from.portId || !e.to.portId) continue
    // Object property inputs keep their own value field (no JSON-path selector).
    if (tgt.kind === 'object') continue
    const outFlow = outputPortFlow(src.outputs, e.from.portId, src.kind)
    const inFlow = inputPortFlow(tgt.inputs, e.to.portId, tgt.kind)
    // A data link: a value/both output feeding a data (`value`) input.
    if (!(inFlow === 'value' && outFlow !== 'signal')) continue
    dataLinks.push({ targetNodeId: e.to.nodeId, targetPort: e.to.portId, selector: e.selector })
  }
  return validateScenarioGraph(nodes, dataLinks, connectedTargets, t)
}
