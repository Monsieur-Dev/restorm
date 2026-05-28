/**
 * Synthesise a "what would this request return" preview from imported
 * API documentation, used by the scenario inspector when a request box
 * has never been executed (no response history) yet carries
 * documentation. The output shape mirrors `resolveRequestPreview` in
 * `main/mcp/tools/scenarioRun.ts` so the inspector's JSON tree can
 * render it identically to a real run — only the values are sample
 * data sourced from the spec.
 *
 * Two-tier strategy:
 *   1. If the matched operation lists explicit `examples` (parameters,
 *      responses), use them verbatim — they're hand-written by the
 *      spec author and almost always more realistic than anything we
 *      could generate.
 *   2. Otherwise walk the response schema (and request body schema)
 *      via `ApiDocumentation.models` and synthesise placeholder values
 *      keyed by type / format / enum / pattern. Deterministic + bounded
 *      recursion so a self-referential model doesn't blow the stack.
 *
 * Pure (no IO, no clock): same inputs → same output. Recursion stops
 * at `MAX_DEPTH` to keep deeply self-referential graphs (e.g., a
 * comment tree with `replies: Comment[]`) finite.
 */

import type {
  ApiDocumentation,
  ModelDocumentation,
  OperationDocumentation,
  ParameterDocumentation,
  PropertyDocumentation
} from '../types/apiDocumentation'

/** Hard cap on schema-walk depth — protects against recursive models
 * that would otherwise sample forever (`Comment` → `replies: Comment[]`
 * → `replies` → … ). At depth limit we emit `null` for the property. */
const MAX_DEPTH = 4

/** Hint about the request that owns the operation, used to fill the
 * synthetic `request` envelope when the caller knows more than the
 * operation alone (the request stores the user-edited URL / verb /
 * headers; the operation only knows the spec-time pattern). */
export interface RequestMeta {
  /** Env-resolved URL for the request, e.g. `https://api.example.com/pet/{id}`.
   * Path params left as `{name}` are accepted; the helper substitutes
   * them with the parameters' example values when synthesising the
   * request line. */
  url?: string
  /** HTTP verb. Defaults to the operation's `match.method`. */
  method?: string
}

/** Output envelope — same field names as `resolveRequestPreview` so
 * the inspector's JSON tree renders the synthetic preview with the
 * same shape (and the same JSON-path selector against it) as a real
 * run result. `synthetic: true` lets the inspector badge the tree as
 * "spec-derived, not a real call". */
export interface SyntheticRequestPreview {
  synthetic: true
  /** Stable identifier of the spec entry that produced the sample —
   * `${method} ${urlPattern}`. Lets a reader (or test) see at a glance
   * which operation the values came from. */
  source: string
  request: {
    url: string
    method: string
    headers: Record<string, string>
    params: Record<string, string>
    pathParams: Record<string, string>
    body?: unknown
  }
  response: {
    status: number
    statusText: string
    headers: Record<string, string>
    body: unknown
    contentType?: string
  }
}

/** Lowest 2xx response in the operation, with a fallback to the
 * declared `default` response, used as the synthetic response shape. */
function pickPrimaryResponseCode(operation: OperationDocumentation): string | undefined {
  const responses = operation.responses
  if (!responses) return undefined
  const codes = Object.keys(responses)
  const twoXx = codes
    .filter((c) => /^2\d\d$/.test(c))
    .sort()
  if (twoXx[0]) return twoXx[0]
  if (responses['default']) return 'default'
  return codes[0]
}

/** Lift an "example" value out of either a single `example` or a
 * `examples` map (using the first JSON-y key when keyed by content-
 * type, else the first entry). Returns `undefined` when neither is
 * usable — caller falls back to schema-derived synthesis. */
function pickExample(example: unknown, examples?: Record<string, unknown> | unknown[]): unknown {
  if (example !== undefined) return example
  if (!examples) return undefined
  if (Array.isArray(examples)) return examples[0]
  // Prefer JSON content-types when the map is keyed by them.
  const keys = Object.keys(examples)
  const jsonKey = keys.find((k) => /json/i.test(k))
  const key = jsonKey ?? keys[0]
  return key !== undefined ? examples[key] : undefined
}

/** Per-type sample value when no example / enum hits. Deterministic +
 * format-aware: a `date-time` string returns a fixed ISO timestamp, a
 * `uuid` returns a fixed UUID, an `integer` returns 42, etc. The
 * values are intentionally lorem-ish so a reader spots them as
 * placeholders. */
function defaultSampleForType(type: string | undefined, format?: string): unknown {
  switch (type) {
    case 'integer':
    case 'long':
    case 'int32':
    case 'int64':
      return 42
    case 'number':
    case 'float':
    case 'double':
      return 3.14
    case 'boolean':
      return true
    case 'string':
      switch (format) {
        case 'date-time': return '2026-01-15T09:30:00Z'
        case 'date': return '2026-01-15'
        case 'time': return '09:30:00'
        case 'email': return 'sample@example.com'
        case 'uri':
        case 'url': return 'https://example.com/resource'
        case 'uuid': return '00000000-0000-4000-8000-000000000000'
        case 'byte': return 'TG9yZW0gaXBzdW0='
        case 'binary': return '<binary>'
        case 'password': return 'sample-password'
        default: return 'lorem ipsum'
      }
    case 'array':
      return []
    case 'object':
    case undefined:
    case '':
      return {}
    default:
      return null
  }
}

/** Sample a property by leaning on the source spec first (`example`,
 * `enumValues`, `defaultValue`) and falling back to type/format. If the
 * property points at another model, recurse — bounded by `depth`. */
function sampleFromProperty(
  prop: PropertyDocumentation,
  models: Record<string, ModelDocumentation>,
  depth: number
): unknown {
  if (prop.example !== undefined) return prop.example
  if (prop.enumValues && prop.enumValues.length > 0) return prop.enumValues[0]
  if (prop.targetModelRef) {
    const target = sampleFromModel(prop.targetModelRef, models, depth + 1)
    return prop.isArrayOfRef ? [target] : target
  }
  // Heuristic for plain-property arrays: a property whose `type` is
  // `array<X>` carries the element type inside the angle brackets. We
  // synthesise a single-element array with one sample of `X`.
  const arrayMatch = /^array<(.+)>$/.exec(prop.type)
  if (arrayMatch?.[1]) {
    const inner = arrayMatch[1]
    const innerModel = inner ? findModelByName(inner, models) : undefined
    if (innerModel) return [sampleFromModel(innerModel, models, depth + 1)]
    return [defaultSampleForType(inner, prop.format)]
  }
  // A `type: any` (or unknown type) with a description like "Cooldown
  // details." is the common Artifacts / Swagger spec pattern when the
  // author skipped a concrete schema. Try to recover a useful sample
  // by matching the property name against the model registry — a `cooldown`
  // property opportunistically resolves to `Cooldown` / `CooldownSchema`,
  // making the synthetic tree readable even when the spec is vague.
  if (prop.type === 'any' || prop.type === '') {
    const guess = findModelByName(prop.name, models)
    if (guess) return sampleFromModel(guess, models, depth + 1)
  }
  // Last-ditch fallback for an unknown (non-`any`) type that happens
  // to match a model name. Costs an extra lookup per property but is
  // strictly additive over the previous behaviour.
  const directHit = findModelByName(prop.type, models)
  if (directHit) return sampleFromModel(directHit, models, depth + 1)
  return defaultSampleForType(prop.type, prop.format)
}

/** Resolve a name (property name or type label) to a documented model.
 * Spec authors are inconsistent with model naming — same shape is
 * variously stored as `Cooldown`, `CooldownSchema`, `cooldown`,
 * `CooldownDataSchema`, …  We try the literal name first, then the
 * common variants. Returns the canonical model name when matched. */
function findModelByName(
  name: string,
  models: Record<string, ModelDocumentation>
): string | undefined {
  if (!name) return undefined
  if (models[name]) return name
  const capitalised = name.charAt(0).toUpperCase() + name.slice(1)
  if (models[capitalised]) return capitalised
  for (const suffix of ['Schema', 'DataSchema', 'Response', 'ResponseSchema', 'Data']) {
    if (models[`${capitalised}${suffix}`]) return `${capitalised}${suffix}`
    if (models[`${name}${suffix}`]) return `${name}${suffix}`
  }
  return undefined
}

/** Sample an entire model: walk its `properties`, recurse into nested
 * model refs, bounded by `MAX_DEPTH`. An enum-only model returns its
 * first enum value (per `enumValues` on the model itself). */
function sampleFromModel(
  modelName: string,
  models: Record<string, ModelDocumentation>,
  depth: number
): unknown {
  if (depth > MAX_DEPTH) return null
  const model = models[modelName]
  if (!model) return null
  if (model.enumValues && model.enumValues.length > 0) return model.enumValues[0]
  const out: Record<string, unknown> = {}
  for (const prop of model.properties) {
    if (prop.removed === true) continue
    out[prop.name] = sampleFromProperty(prop, models, depth)
  }
  return out
}

/** Synthesise a parameter value, leaning on its own `example` first,
 * then `examples`, then `enumValues`, then `defaultValue`, then a
 * type/format-keyed placeholder. All values are stringified — query /
 * header / path slots are strings on the wire. */
function sampleParameterAsString(param: ParameterDocumentation): string {
  const ex = pickExample(param.example, param.examples)
  if (ex !== undefined) return stringifyForWire(ex)
  if (param.enumValues && param.enumValues.length > 0) return stringifyForWire(param.enumValues[0])
  if (param.defaultValue !== undefined) return param.defaultValue
  return stringifyForWire(defaultSampleForType(param.type, param.format))
}

/** Render a value as it would appear on the wire — strings stay as-is,
 * primitives go through `String`, objects round-trip through JSON. */
function stringifyForWire(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  return ''
}

/** Substitute `{name}` placeholders in `url` with the corresponding
 * path parameter sample. Leaves a placeholder intact when the operation
 * doesn't declare its parameter (the user-typed URL may carry
 * Handlebars-style `{{var}}` for env vars which we deliberately leave
 * for the real runtime to expand). */
function substitutePathParams(url: string, pathParams: Record<string, string>): string {
  return url.replace(/\{([^{}/]+)\}/g, (_, name: string) => pathParams[name] ?? `{${name}}`)
}

/** Best guess at a content-type from the operation's `produces` list
 * — JSON beats anything else, then the first listed type, finally a
 * default of `application/json` so the inspector tree always sees a
 * `contentType` field. */
function pickPrimaryContentType(produces: string[] | undefined): string {
  if (!produces || produces.length === 0) return 'application/json'
  const jsonProduce = produces.find((p) => /json/i.test(p))
  return jsonProduce ?? produces[0] ?? 'application/json'
}

/** Statuses that ship with a human-readable text in the synthetic
 * preview — kept short so the snapshot stays focused on shape, not on
 * a complete RFC enumeration. */
const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content'
}

/**
 * Build a synthetic preview envelope for `operation` against the
 * documented `models`. Returns `null` when the operation carries
 * neither examples nor schema references the helper can chase (an
 * operation with no parameters and no response shape gives the
 * inspector nothing useful to render).
 */
export function synthesizeOperationPreview(
  operation: OperationDocumentation,
  models: Record<string, ModelDocumentation>,
  meta: RequestMeta = {}
): SyntheticRequestPreview | null {
  const method = (meta.method ?? operation.match.method ?? 'GET').toUpperCase()
  const baseUrl = meta.url ?? operation.match.urlPattern
  const params = operation.parameters ?? []

  const headers: Record<string, string> = {}
  const queryParams: Record<string, string> = {}
  const pathParams: Record<string, string> = {}
  let body: unknown

  for (const p of params) {
    const value = sampleParameterAsString(p)
    switch (p.location) {
      case 'header':
        headers[p.name] = value
        break
      case 'query':
        queryParams[p.name] = value
        break
      case 'path':
        pathParams[p.name] = value
        break
      case 'body':
      case 'formData':
        // A `body` parameter on Swagger 2.0 carries the JSON body —
        // its `example` is the verbatim payload; otherwise the
        // (raw) parameter doesn't carry a schema reference we can
        // chase, so fall back to the type-keyed sample.
        body = pickExample(p.example, p.examples) ?? defaultSampleForType(p.type, p.format)
        break
      default:
        // Unknown locations are skipped — the synthetic preview's job
        // is to feel realistic, not to round-trip every spec quirk.
        break
    }
  }

  const responseCode = pickPrimaryResponseCode(operation)
  const responseInfo = responseCode !== undefined ? operation.responses?.[responseCode] : undefined
  const contentType = pickPrimaryContentType(operation.produces)

  // Response body: example wins; else walk the schema ref via models.
  let responseBody: unknown = pickExample(undefined, responseInfo?.examples)
  if (responseBody === undefined && responseInfo?.schema) {
    responseBody = sampleFromModel(responseInfo.schema, models, 0)
  }
  if (responseBody === undefined) {
    // No example AND no chaseable schema. If the operation also has
    // no parameters, there's literally nothing to render — skip the
    // synthetic preview so the inspector falls back to the play-from-
    // here button.
    if (params.length === 0) return null
    responseBody = null
  }

  const statusNum = Number.parseInt(responseCode ?? '200', 10)
  const status = Number.isFinite(statusNum) ? statusNum : 200
  const statusText = STATUS_TEXT[status] ?? ''

  return {
    synthetic: true,
    source: `${method} ${operation.match.urlPattern}`,
    request: {
      url: substitutePathParams(baseUrl, pathParams),
      method,
      headers,
      params: queryParams,
      pathParams,
      ...(body !== undefined ? { body } : {})
    },
    response: {
      status,
      statusText,
      headers: { 'content-type': contentType },
      body: responseBody,
      contentType
    }
  }
}

/** Convenience wrapper for the common renderer-side path: hand it the
 * `apiDocumentation`, the matched `operation`, and the request meta;
 * get the envelope back. Kept thin so callers that already resolved
 * the operation (the deprecation-aware tab path) can re-use it without
 * a second lookup. */
export function synthesizeRequestPreview(
  apiDoc: ApiDocumentation,
  operation: OperationDocumentation,
  meta: RequestMeta = {}
): SyntheticRequestPreview | null {
  return synthesizeOperationPreview(operation, apiDoc.models, meta)
}
