/**
 * On-box override ports for a request-binding scenario action.
 *
 * A request / send / connect / listen node bound to a saved request exposes its
 * configurable fields as INPUT PORTS on the box (not a popover): each field is a
 * row with a coloured target anchor + an inline editor. The whole point of a
 * scenario is dataflow, so a field is overridden by EITHER wiring an upstream
 * node's output into its port (live, wins) OR typing an inline literal. The
 * inline literal persists in `config.overrides[<portId>]`; the wired edge wins
 * over it at run time (see the executor's slot merge).
 *
 * `ScenarioInputCell` (applied by `ScenarioNodeSection` to every left cell)
 * auto-swaps the inline editor for the JSON-path selector when a data link is
 * wired — so "inline vs wired" needs no special handling here. Empty inline =
 * inherit from the base request / picked quick-config; a value = override.
 *
 * Port ids mirror the engine's slot ids (`url`, `method`, `body`,
 * `headers:<key>`, `params:<key>`, `pathParams:<key>`) so the executor reads the
 * same ids it derives.
 */

import { useTranslation } from 'react-i18next'
import { SelectBox, type ISelectData } from 'electron-core-ui/renderer'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import type { KeyValue } from '../../../../../shared/types/baseTypes'
import type { Request } from '../../../../../shared/types/collections'
import { TypedValueField } from '../../TypedValueField'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import type { EnvValueTypeGroup } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { readActionOverrides, OVERRIDES_KEY } from '../../../../../shared/scenarioActionOverride'
import type { ScenarioNodeCell, ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { OverrideFieldAdder } from './OverrideFieldAdder'
import { QuickConfigSelectorRow } from './QuickConfigSelectorRow'

/** Persist an inline override for one port id into `config.overrides`, or clear
 * it (drop the key) when the value is empty/undefined → "inherit". */
export function setOverride(
  config: Record<string, unknown>,
  portId: string,
  value: unknown,
  onSetConfig: (patch: Record<string, unknown>) => void
): void {
  const current = readActionOverrides(config)
  const next: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(current)) if (k !== portId) next[k] = v
  if (value !== undefined && value !== null && value !== '') next[portId] = value
  onSetConfig({ [OVERRIDES_KEY]: next })
}

interface FieldContext {
  config: Record<string, unknown>
  valueTypeGroups: EnvValueTypeGroup[]
  onSetConfig: (patch: Record<string, unknown>) => void
}

/** A scalar override row: a per-field caption (so the user sees WHAT this field
 * overrides — url / body / topic / …) above an inline TypedValueField bound to
 * `config.overrides[portId]`, with a target anchor so an upstream link can drive
 * it instead. An empty inline value means "inherit" (the base request / picked
 * quick-config value applies). `baseValue` is shown as the row's right-column
 * hint so the inherited value stays visible. */
/** Per-field value-type policy. Defaults preserve the original behaviour (every
 * kind except `expression`, env values allowed). A URL field overrides this to
 * the only kinds that make sense in an endpoint — a string, a variable, or an
 * expression — so the picker never offers a colour / number / list for a URL. */
interface ScalarFieldPolicy {
  excludeTypes?: ValueTypeKind[]
  allowEnvironment?: boolean
}

/** Every value kind EXCEPT the three that are coherent for a URL
 * (string / variable / expression). Keep in sync with `ValueTypeKind`. */
const URL_EXCLUDE_TYPES: ValueTypeKind[] = [
  'secret', 'number', 'dateTime', 'color', 'boolean',
  'enum', 'enumList', 'customList', 'customListMulti', 'environment', 'null', 'list'
]

function scalarRow(portId: string, label: string, baseValue: string | undefined, ctx: FieldContext, policy?: ScalarFieldPolicy): ScenarioNodeCell {
  const overrides = readActionOverrides(ctx.config)
  const stored = overrides[portId]
  const allowEnvironment = policy?.allowEnvironment ?? true
  return {
    id: portId,
    label,
    ...(baseValue !== undefined ? { value: baseValue } : {}),
    port: { id: portId, type: 'target' },
    content: (
      <div className="nodrag scn-operand-field" onMouseDown={(e) => { e.stopPropagation() }}>
        <div className="scn-field-caption">{label}</div>
        <TypedValueField
          value={normalizeValueType(stored)}
          onChange={(next) => { setOverride(ctx.config, portId, serializeValueForPersistence(next), ctx.onSetConfig) }}
          valueTypeGroups={ctx.valueTypeGroups}
          excludeTypes={policy?.excludeTypes ?? ['expression']}
          allowEnvironment={allowEnvironment}
          dataTestId={`scn-override-${portId}`}
        />
      </div>
    )
  }
}

/** The value-type policy for a URL override field: only string / variable /
 * expression are coherent endpoints, env values are folded into the `variable`
 * picker, so environment is not offered separately. */
const URL_FIELD_POLICY: ScalarFieldPolicy = { excludeTypes: URL_EXCLUDE_TYPES, allowEnvironment: false }

/** Verb options for the method select; index 0 = "inherit" (no override). */
const METHOD_VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

/** The HTTP method row: an inline ECUI SelectBox (verb list) bound to
 * `config.overrides.method`, with a target anchor so it can be wired too. Index
 * 0 is the "inherit" option (clears the override). */
function methodRow(baseMethod: string | undefined, ctx: FieldContext, inheritLabel: string, methodLabel: string): ScenarioNodeCell {
  const overrides = readActionOverrides(ctx.config)
  const storedMethod = overrides['method']
  const stored = typeof storedMethod === 'string' ? storedMethod : ''
  const items = [baseMethod ? `${inheritLabel} (${baseMethod})` : inheritLabel, ...METHOD_VERBS]
  const options = items.map((text) => ({ text }))
  const selectedIdx = stored === '' ? 0 : Math.max(0, METHOD_VERBS.indexOf(stored) + 1)
  return {
    id: 'method',
    label: methodLabel,
    port: { id: 'method', type: 'target' },
    content: (
      <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
        <div className="scn-field-caption">{methodLabel}</div>
        <SelectBox
          id="scn-override-method"
          className=""
          options={options}
          selected={selectedIdx}
          onDidSelect={(d: ISelectData) => {
            const verb = d.index === 0 ? undefined : METHOD_VERBS[d.index - 1]
            setOverride(ctx.config, 'method', verb, ctx.onSetConfig)
          }}
          data-testid="scn-override-method"
        />
      </div>
    )
  }
}

/** A collapsible KV section (headers / params / path params) where each key the
 * request defines is an override row, PLUS an "+ override field" adder row to
 * override a key the request does not pre-define. */
function kvOverrideSection(group: 'headers' | 'params' | 'pathParams', name: string, kvs: KeyValue[] | undefined, ctx: FieldContext, addTooltip: string): ScenarioNodeSection | null {
  const overrides = readActionOverrides(ctx.config)
  // Keys the request defines + any extra override key the action added itself.
  const baseKeys = (kvs ?? []).filter((kv) => kv.enabled !== false && kv.key).map((kv) => kv.key)
  const extraKeys = Object.keys(overrides)
    .filter((k) => k.startsWith(`${group}:`))
    .map((k) => k.slice(group.length + 1))
    .filter((k) => k && !baseKeys.includes(k))
  const keys = [...baseKeys, ...extraKeys]

  // Whole-table object port (id = the bare group): wiring an upstream object
  // output — or an inline JSON object — into it merges every entry into the
  // table at run time (the executor's slot merge reads the same bare-group id).
  // Sits first so the table-wide override reads above the per-key rows.
  const rows: ScenarioNodeCell[] = [
    scalarRow(group, name, undefined, ctx),
    ...keys.map((key) => {
      const base = (kvs ?? []).find((kv) => kv.key === key)
      return scalarRow(`${group}:${key}`, key, base ? displayValue(base.value) : undefined, ctx)
    })
  ]
  rows.push({
    id: `${group}:__add`,
    content: (
      <OverrideFieldAdder
        tooltip={addTooltip}
        existingKeys={keys}
        onAdd={(key) => { setOverride(ctx.config, `${group}:${key}`, '', ctx.onSetConfig) }}
        dataTestId={`scn-override-add-${group}`}
      />
    )
  })
  return { id: `override-${group}`, name, rows }
}

/** Best-effort one-line display of a KeyValue's (typed) value, for the inline
 * placeholder (the inherited base value). */
function displayValue(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (o['type'] === 'secret') return '••••••'
    const inner = o['value']
    if (typeof inner === 'string' || typeof inner === 'number' || typeof inner === 'boolean') return String(inner)
  }
  return undefined
}

/** Localised labels the override sections need (passed in so the shared builder
 * stays i18n-agnostic — callers resolve via `useTranslation`). */
export interface OverrideLabels {
  url: string
  method: string
  body: string
  headers: string
  params: string
  pathParams: string
  /** GraphQL document. */
  query: string
  /** GraphQL variables (JSON). */
  variables: string
  /** gRPC fully-qualified service. */
  service: string
  /** gRPC method name (distinct from the HTTP verb `method`). */
  grpcMethod: string
  /** gRPC request message (JSON). */
  requestMessage: string
  /** MQTT topic (the connection's publish/subscribe topic). */
  topic: string
  /** Caption heading the override-port group (separates it from the chooser rows). */
  overridesLabel: string
  /** "(inherit)" / base-value option for the method select. */
  inherit: string
  /** Tooltip for the "+ override field" adder button. */
  addField: string
}

/** Shape a bound HTTP-family request exposes for override ports. */
interface HttpLikeRequest {
  url?: string
  method?: string
  headers?: KeyValue[]
  params?: KeyValue[]
  pathParams?: KeyValue[]
  body?: unknown
}

/**
 * Build the override-port sections for an HTTP/unary (httpRequest, gRPC unary,
 * SOAP, OData) bound request: url + method top rows, then collapsible
 * headers / params / path params, then a body row when the request has a body.
 */
export function buildHttpOverrideSections(
  request: HttpLikeRequest,
  ctx: FieldContext,
  labels: OverrideLabels
): ScenarioNodeSection[] {
  const out: ScenarioNodeSection[] = []
  out.push({
    id: 'override-core',
    name: labels.overridesLabel,
    rows: [
      scalarRow('url', labels.url, request.url, ctx, URL_FIELD_POLICY),
      methodRow(request.method, ctx, labels.inherit, labels.method)
    ]
  })
  const headers = kvOverrideSection('headers', labels.headers, request.headers, ctx, labels.addField)
  const params = kvOverrideSection('params', labels.params, request.params, ctx, labels.addField)
  const pathParams = kvOverrideSection('pathParams', labels.pathParams, request.pathParams, ctx, labels.addField)
  if (pathParams) out.push(pathParams)
  if (headers) out.push(headers)
  if (params) out.push(params)
  if (request.body !== undefined && request.body !== null) {
    out.push({ id: 'override-body', rows: [scalarRow('body', labels.body, undefined, ctx)] })
  }
  return out
}

/** Shape a bound GraphQL request exposes for override ports. */
interface GraphqlLikeRequest {
  url?: string
  query?: string
  variables?: string
  headers?: KeyValue[]
}

/**
 * Build the override-port sections for a bound GraphQL (unary query/mutation)
 * request: url + query + variables top rows, then a collapsible headers section.
 * GraphQL-over-HTTP is always a POST, so there is no method row; the document +
 * variables stand in for the HTTP body.
 */
export function buildGraphqlOverrideSections(
  request: GraphqlLikeRequest,
  ctx: FieldContext,
  labels: OverrideLabels
): ScenarioNodeSection[] {
  const out: ScenarioNodeSection[] = [
    {
      id: 'override-core',
      name: labels.overridesLabel,
      rows: [
        scalarRow('url', labels.url, request.url, ctx, URL_FIELD_POLICY),
        scalarRow('query', labels.query, undefined, ctx),
        scalarRow('variables', labels.variables, undefined, ctx)
      ]
    }
  ]
  const headers = kvOverrideSection('headers', labels.headers, request.headers, ctx, labels.addField)
  if (headers) out.push(headers)
  return out
}

/** Shape a bound gRPC request exposes for override ports. */
interface GrpcLikeRequest {
  url?: string
  service?: string
  method?: string
  requestMessage?: string
}

/**
 * Build the override-port sections for a bound gRPC (unary) request: the address
 * `url`, the `service` + `method` names, and the `requestMessage` (JSON). gRPC
 * has no HTTP verb / params / path-params, so only these fields are exposed.
 */
export function buildGrpcOverrideSections(
  request: GrpcLikeRequest,
  ctx: FieldContext,
  labels: OverrideLabels
): ScenarioNodeSection[] {
  return [
    {
      id: 'override-core',
      name: labels.overridesLabel,
      rows: [
        scalarRow('url', labels.url, request.url, ctx, URL_FIELD_POLICY),
        scalarRow('service', labels.service, request.service, ctx),
        scalarRow('method', labels.grpcMethod, request.method, ctx),
        scalarRow('requestMessage', labels.requestMessage, undefined, ctx)
      ]
    }
  ]
}

/**
 * Build the override-port sections for a STREAMING connect / mock-server listen
 * bound request (ws / socketio / mqtt / grpc / http-server / grpc-server). A
 * connect/listen node's overridable fields are the endpoint `url` + (when the
 * request carries them) `headers`. The send-side payload stays on the SEND node,
 * not here. Body/method aren't connection-level fields, so they're omitted.
 */
export function buildStreamingOverrideSections(
  request: HttpLikeRequest,
  ctx: FieldContext,
  labels: OverrideLabels,
  extraScalars?: { portId: string; label: string; baseValue?: string }[]
): ScenarioNodeSection[] {
  const out: ScenarioNodeSection[] = [
    {
      id: 'override-core',
      name: labels.overridesLabel,
      rows: [
        scalarRow('url', labels.url, request.url, ctx, URL_FIELD_POLICY),
        // Protocol-specific connection fields (e.g. the MQTT topic) sit under
        // the endpoint url, each a wireable override port like the rest.
        ...(extraScalars ?? []).map((f) => scalarRow(f.portId, f.label, f.baseValue, ctx))
      ]
    }
  ]
  const headers = kvOverrideSection('headers', labels.headers, request.headers, ctx, labels.addField)
  if (headers) out.push(headers)
  return out
}

/** Resolve every override label via i18n in one place, so each box doesn't
 * repeat the t() calls. */
export function useOverrideLabels(): OverrideLabels {
  const { t } = useTranslation()
  return {
    url: t('scenario.actionOverride.fields.url', 'URL'),
    method: t('scenario.actionOverride.fields.method', 'Method'),
    body: t('scenario.actionOverride.fields.body', 'Body'),
    headers: t('scenario.actionOverride.sections.headers', 'Headers'),
    params: t('scenario.actionOverride.sections.params', 'Params'),
    pathParams: t('scenario.actionOverride.sections.pathParams', 'Path Params'),
    query: t('scenario.actionOverride.fields.query', 'Query'),
    variables: t('scenario.actionOverride.fields.variables', 'Variables'),
    service: t('scenario.actionOverride.fields.service', 'Service'),
    grpcMethod: t('scenario.actionOverride.fields.grpcMethod', 'Method'),
    requestMessage: t('scenario.actionOverride.fields.requestMessage', 'Request message'),
    topic: t('scenario.actionOverride.fields.topic', 'Topic'),
    overridesLabel: t('scenario.actionOverride.overridesLabel', 'Field overrides'),
    inherit: t('scenario.actionOverride.inherit', 'Inherit'),
    addField: t('scenario.actionOverride.addField', 'Add override field')
  }
}

/** The quick-config selector section (a chooser, not a port). Null when the box
 * isn't bound to a resolvable request. */
export function buildSelectorSection(
  request: Request | null,
  config: Record<string, unknown>,
  onSetConfig: (patch: Record<string, unknown>) => void
): ScenarioNodeSection | null {
  if (!request) return null
  return {
    id: 'quick-config',
    rows: [{
      id: 'quick-config',
      content: <QuickConfigSelectorRow request={request} config={config} onSetConfig={onSetConfig} />
    }]
  }
}

/**
 * Hook: the override sections for a STREAMING connect / listen box — the
 * quick-config selector + the connection-level override ports (url + headers).
 * Returns [] when the box isn't bound to a resolvable request. Encapsulates the
 * i18n + value-type-group hooks so each box adds overrides in one line.
 */
export function useStreamingOverrideSections(
  request: Request | null,
  config: Record<string, unknown>,
  onSetConfig: (patch: Record<string, unknown>) => void,
  extraScalars?: { portId: string; label: string; baseValue?: string }[]
): ScenarioNodeSection[] {
  const labels = useOverrideLabels()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  if (!request) return []
  const selector = buildSelectorSection(request, config, onSetConfig)
  const sections = buildStreamingOverrideSections(
    request as unknown as HttpLikeRequest,
    { config, valueTypeGroups, onSetConfig },
    labels,
    extraScalars
  )
  return selector ? [selector, ...sections] : sections
}
