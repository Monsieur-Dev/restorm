import type { TFunction } from 'i18next'
import type { ScenarioNodeKind } from '../../../../shared/types/collections'

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

/** Kinds that declare a named value in scenario scope; two of them sharing a
 * name is an ambiguous reference. */
const NAME_DECLARERS: ScenarioNodeKind[] = ['input', 'setVariable']

/** `input` — a named parameter with a typed default. */
function validateInput(node: ValidationNode, ctx: ScenarioValidationContext): ScenarioNodeError[] {
  const errors: ScenarioNodeError[] = []
  const name = trimmedName(node)
  if (!name) {
    // Without a name the parameter can't be referenced or derived into a
    // runScenario port — a nameless box can't collide either, so stop here.
    errors.push({ code: 'missing-name', field: 'name', message: ctx.t('scenario.validation.input.missingName', 'This input parameter must have a name.') })
    return errors
  }
  const collides = ctx.nodes.some(
    (other) => other.id !== node.id && NAME_DECLARERS.includes(other.kind) && trimmedName(other) === name
  )
  if (collides) {
    errors.push({
      code: 'duplicate-name',
      field: 'name',
      message: ctx.t('scenario.validation.duplicateName', 'The name "{{name}}" is already used by another box.', { name })
    })
  }
  return errors
}

/** `output` — declares a named scenario output, fed by its `value` input. */
function validateOutput(node: ValidationNode, ctx: ScenarioValidationContext): ScenarioNodeError[] {
  const errors: ScenarioNodeError[] = []
  const name = trimmedName(node)
  if (!name) {
    errors.push({ code: 'missing-name', field: 'name', message: ctx.t('scenario.validation.output.missingName', 'This output must have a name.') })
  } else if (ctx.nodes.some((other) => other.id !== node.id && other.kind === 'output' && trimmedName(other) === name)) {
    errors.push({ code: 'duplicate-name', field: 'name', message: ctx.t('scenario.validation.output.duplicateName', 'The name "{{name}}" is already used by another output.', { name }) })
  }
  if (!ctx.connectedTargets.has(targetKey(node.id, 'value'))) {
    errors.push({ code: 'value-required', field: 'value', message: ctx.t('scenario.validation.output.valueRequired', 'The "value" input must be wired to a source.') })
  }
  return errors
}

/** Names declared in scenario scope (by `input` + `setVariable` boxes). */
function declaredVariableNames(ctx: ScenarioValidationContext): Set<string> {
  const names = new Set<string>()
  for (const n of ctx.nodes) {
    if (n.kind === 'input' || n.kind === 'setVariable') {
      const name = trimmedName(n)
      if (name) names.add(name)
    }
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

/** A JSON-path selector: a root identifier then dot-fields / [index] /
 * ['key'] segments (e.g. `response.body.items[0].name`). Used to reject a
 * malformed selector on a data link. */
const SELECTOR_RE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\]|\['[^']*'\]|\["[^"]*"\])*$/

export function isValidSelectorPath(selector: string): boolean {
  return SELECTOR_RE.test(selector.trim())
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
