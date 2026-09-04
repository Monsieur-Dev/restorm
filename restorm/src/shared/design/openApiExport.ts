/**
 * `ApiDocumentation` → OpenAPI 3.0 JSON — the descriptive spec the
 * design server serves at `/swagger.json` (the dogfood: a served API is
 * self-described and therefore re-importable), and the base the OpenAPI
 * exporter builds on. The emitter targets ROUND-TRIP fidelity with the
 * OAS3 importer (`openapi3ToApiDocumentation`): `import(emit(doc))`
 * must reproduce `doc` — the final-validation ticket pins that loop on
 * the Petstore. Every mapping here mirrors an importer read: multiple
 * `consumes`/`produces` become one content key each, oauth2 flow names
 * map back (`application`→`clientCredentials`, `accessCode`→
 * `authorizationCode`), xml/composition/constraints re-emit verbatim.
 */

import type {
  ApiDocumentation,
  ModelDocumentation,
  OAuth2Flow,
  OperationDocumentation,
  ParameterDocumentation,
  PropertyDocumentation,
  SecurityScheme
} from '../types/apiDocumentation'

type Json = Record<string, unknown>

/** Emission target. 3.0 is the served /swagger.json dialect; 3.1 is
 * the downloadable descriptor (468.7). The differences the design
 * shapes can produce: the version string, `nullable` (3.0 keyword vs
 * a `['T','null']` type array in 3.1) and boolean Swagger-2-style
 * `exclusiveMinimum`/`exclusiveMaximum` (numeric in 3.1). */
type OasTarget = '3.0' | '3.1'

/** `{{param}}` (Restorm request spelling) → `{param}` (spec spelling).
 * Single-brace paths pass through unchanged. */
export function restormPathToSpec(urlPattern: string): string {
  return urlPattern.replace(/\{\{([^{}]+)\}\}/g, '{$1}')
}

// ── Schemas ───────────────────────────────────────────────────────────

const PRIMITIVE_TYPES = new Set(['string', 'integer', 'number', 'boolean', 'object', 'array', 'any'])

const CONSTRAINT_KEYS = [
  'minLength', 'maxLength', 'minimum', 'maximum',
  'exclusiveMinimum', 'exclusiveMaximum', 'pattern', 'multipleOf', 'uniqueItems'
] as const

function applyConstraints(schema: Json, constraints: PropertyDocumentation['constraints'], target: OasTarget): void {
  if (constraints === undefined) return
  for (const key of CONSTRAINT_KEYS) {
    if (constraints[key] !== undefined) schema[key] = constraints[key]
  }
  if (target === '3.1') {
    // JSON Schema 2020-12: exclusive bounds are NUMBERS. A boolean
    // `true` (Swagger 2.0 style, paired with minimum/maximum) converts
    // to the numeric form; `false` just drops.
    if (typeof schema['exclusiveMinimum'] === 'boolean') {
      if (schema['exclusiveMinimum'] && typeof schema['minimum'] === 'number') {
        schema['exclusiveMinimum'] = schema['minimum']
        delete schema['minimum']
      } else {
        delete schema['exclusiveMinimum']
      }
    }
    if (typeof schema['exclusiveMaximum'] === 'boolean') {
      if (schema['exclusiveMaximum'] && typeof schema['maximum'] === 'number') {
        schema['exclusiveMaximum'] = schema['maximum']
        delete schema['maximum']
      } else {
        delete schema['exclusiveMaximum']
      }
    }
  }
}

/** A property/parameter TYPE label as an OpenAPI schema node —
 * `Pet` → $ref, `array<Pet>` → array of $ref, `map` → free-form
 * object, primitives verbatim. */
function typeLabelToSchema(label: string, knownComponents: Set<string>): Json {
  const array = /^array<(.+)>$/.exec(label)
  if (array?.[1] !== undefined) {
    return { type: 'array', items: typeLabelToSchema(array[1], knownComponents) }
  }
  if (label === 'map') return { type: 'object', additionalProperties: true }
  if (label === 'any' || label === '') return {}
  if (!PRIMITIVE_TYPES.has(label) && knownComponents.has(label)) {
    return { $ref: `#/components/schemas/${label}` }
  }
  if (!PRIMITIVE_TYPES.has(label)) return { type: 'object' }
  return { type: label }
}

function xmlNode(xml: NonNullable<ModelDocumentation['xml']>): Json {
  const node: Json = {}
  for (const key of ['name', 'attribute', 'wrapped', 'prefix', 'namespace'] as const) {
    if (xml[key] !== undefined) node[key] = xml[key]
  }
  return node
}

/** Mark a schema nullable in the target's dialect. Known asymmetries
 * (same family as the bare-$ref rule in `propertySchema`): a typeless
 * schema (`any`/`''` → `{}`) has no type to union with `null`, so its
 * nullability is silently dropped in 3.1 — as it is on a pure $ref
 * property in both dialects. */
function markNullable(schema: Json, target: OasTarget): void {
  if (target === '3.0') {
    schema['nullable'] = true
    return
  }
  // 3.1: nullability is a type union.
  if (typeof schema['type'] === 'string') schema['type'] = [schema['type'], 'null']
}

function propertySchema(property: PropertyDocumentation, knownComponents: Set<string>, target: OasTarget): Json {
  // A referenced property is the bare $ref (array-of-ref wraps it) —
  // the importer reads no siblings off a pure reference, so none are
  // emitted; every other shape carries its facets.
  if (property.targetModelRef !== undefined && knownComponents.has(property.targetModelRef)) {
    const ref: Json = { $ref: `#/components/schemas/${property.targetModelRef}` }
    if (property.isArrayOfRef === true) {
      const wrapper: Json = { type: 'array', items: ref }
      if (property.xml !== undefined) wrapper['xml'] = xmlNode(property.xml)
      applyConstraints(wrapper, property.constraints, target)
      return wrapper
    }
    return ref
  }
  const schema = typeLabelToSchema(property.type, knownComponents)
  if (property.format !== undefined) schema['format'] = property.format
  if (property.description !== undefined) schema['description'] = property.description
  if (property.example !== undefined) schema['example'] = property.example
  if (property.nullable === true) markNullable(schema, target)
  if (property.readOnly === true) schema['readOnly'] = true
  if (property.deprecated === true) schema['deprecated'] = true
  if (Array.isArray(property.enumValues) && property.enumValues.length > 0) schema['enum'] = property.enumValues
  applyConstraints(schema, property.constraints, target)
  if (property.xml !== undefined) schema['xml'] = xmlNode(property.xml)
  return schema
}

function modelSchema(model: ModelDocumentation, knownComponents: Set<string>, target: OasTarget): Json {
  // Enum-shaped component → a bare enum schema.
  if (Array.isArray(model.enumValues) && model.enumValues.length > 0 && model.properties.length === 0) {
    const first = model.enumValues[0]
    const schema: Json = {
      type: typeof first === 'number' ? 'number' : 'string',
      enum: model.enumValues
    }
    if (model.description !== undefined) schema['description'] = model.description
    return schema
  }
  const properties: Json = {}
  const required: string[] = []
  for (const property of model.properties) {
    if (property.name === '') continue
    properties[property.name] = propertySchema(property, knownComponents, target)
    if (property.required) required.push(property.name)
  }
  const schema: Json = { type: 'object' }
  if (required.length > 0) schema['required'] = required
  schema['properties'] = properties
  if (model.description !== undefined) schema['description'] = model.description
  const composition = model.composition
  if (composition !== undefined) {
    const toRefs = (names: string[] | undefined): Json[] | undefined =>
      names?.map((n) => ({ $ref: `#/components/schemas/${n}` }))
    const oneOf = toRefs(composition.oneOf)
    const anyOf = toRefs(composition.anyOf)
    if (oneOf !== undefined) schema['oneOf'] = oneOf
    if (anyOf !== undefined) schema['anyOf'] = anyOf
    if (composition.discriminator !== undefined) {
      const discriminator: Json = { propertyName: composition.discriminator.propertyName }
      if (composition.discriminator.mapping !== undefined) discriminator['mapping'] = composition.discriminator.mapping
      schema['discriminator'] = discriminator
    }
  }
  if (model.xml !== undefined) schema['xml'] = xmlNode(model.xml)
  return schema
}

// ── Operations ────────────────────────────────────────────────────────

function parameterNode(parameter: ParameterDocumentation, knownComponents: Set<string>, target: OasTarget): Json {
  const schema = typeLabelToSchema(parameter.type, knownComponents)
  if (parameter.format !== undefined) schema['format'] = parameter.format
  if (Array.isArray(parameter.enumValues) && parameter.enumValues.length > 0) {
    // A multi-value param is `array<scalar>` whose enum constrains the ITEMS —
    // emit it on `items`, not on the array itself (where it would mean the
    // whole array is one of the enum values). A scalar param keeps it inline.
    const items = schema['type'] === 'array' && typeof schema['items'] === 'object' && schema['items'] !== null
      ? schema['items'] as Json
      : schema
    items['enum'] = parameter.enumValues
  }
  applyConstraints(schema, parameter.constraints, target)
  const node: Json = {
    name: parameter.name,
    in: parameter.location,
    required: parameter.required,
    schema
  }
  if (parameter.description !== undefined) node['description'] = parameter.description
  if (parameter.example !== undefined) node['example'] = parameter.example
  return node
}

/** One media-type map with the SAME schema under every content type —
 * the emit-side inverse of the importer's `consumes`/`produces` union. */
function contentNode(contentTypes: string[], schema: Json | undefined): Json {
  const content: Json = {}
  for (const contentType of contentTypes) {
    content[contentType] = schema !== undefined ? { schema } : {}
  }
  return content
}

function operationNode(operation: OperationDocumentation, knownComponents: Set<string>, target: OasTarget): Json {
  const parameters = (operation.parameters ?? []).filter((p) => p.location !== 'body')
  const bodyParam = (operation.parameters ?? []).find((p) => p.location === 'body')

  const node: Json = {}
  const tags = operation.tags ?? (operation.group !== undefined ? [operation.group] : undefined)
  if (tags !== undefined && tags.length > 0) node['tags'] = tags
  if (operation.summary !== undefined) node['summary'] = operation.summary
  if (operation.description !== undefined) node['description'] = operation.description
  if (operation.operationId !== undefined) node['operationId'] = operation.operationId
  if (operation.deprecated === true) node['deprecated'] = true
  if (operation.externalDocs !== undefined) node['externalDocs'] = operation.externalDocs
  if (parameters.length > 0) node['parameters'] = parameters.map((p) => parameterNode(p, knownComponents, target))
  if (bodyParam !== undefined) {
    const contentTypes = operation.consumes !== undefined && operation.consumes.length > 0
      ? operation.consumes
      : ['application/json']
    const requestBody: Json = {
      required: bodyParam.required,
      content: contentNode(contentTypes, typeLabelToSchema(bodyParam.type, knownComponents))
    }
    if (bodyParam.description !== undefined) requestBody['description'] = bodyParam.description
    node['requestBody'] = requestBody
  }

  const produces = operation.produces !== undefined && operation.produces.length > 0
    ? operation.produces
    : ['application/json']
  const responses: Json = {}
  for (const [code, response] of Object.entries(operation.responses ?? {})) {
    const responseNode: Json = { description: response.description ?? '' }
    if (response.schema !== undefined) {
      responseNode['content'] = contentNode(produces, typeLabelToSchema(response.schema, knownComponents))
    }
    if (response.headers !== undefined) {
      const headers: Json = {}
      for (const [name, header] of Object.entries(response.headers)) {
        const headerNode: Json = { schema: { type: header.type } }
        if (header.description !== undefined) headerNode['description'] = header.description
        headers[name] = headerNode
      }
      responseNode['headers'] = headers
    }
    responses[code] = responseNode
  }
  node['responses'] = Object.keys(responses).length > 0 ? responses : { '200': { description: '' } }

  if (operation.security !== undefined) node['security'] = operation.security
  // Vendor extensions travel in `extra` — only the `x-*` keys are
  // spec-level (the importer's extraction is the inverse read).
  for (const [key, value] of Object.entries(operation.extra ?? {})) {
    if (key.startsWith('x-')) node[key] = value
  }
  return node
}

// ── Security ──────────────────────────────────────────────────────────

/** Stored flow vocabulary (Swagger 2.0 names) → OAS3 flow keys. */
const FLOW_KEY: Record<OAuth2Flow['type'], string> = {
  implicit: 'implicit',
  password: 'password',
  application: 'clientCredentials',
  accessCode: 'authorizationCode'
}

function securitySchemeNode(scheme: SecurityScheme): Json {
  const node: Json = { type: scheme.type === 'basic' ? 'http' : scheme.type }
  if (scheme.description !== undefined) node['description'] = scheme.description
  if (scheme.type === 'basic') node['scheme'] = 'basic'
  if (scheme.scheme !== undefined) node['scheme'] = scheme.scheme
  if (scheme.bearerFormat !== undefined) node['bearerFormat'] = scheme.bearerFormat
  if (scheme.name !== undefined) node['name'] = scheme.name
  if (scheme.in !== undefined) node['in'] = scheme.in
  if (scheme.flows !== undefined && scheme.flows.length > 0) {
    const flows: Json = {}
    for (const flow of scheme.flows) {
      const flowNode: Json = { scopes: flow.scopes }
      if (flow.authorizationUrl !== undefined) flowNode['authorizationUrl'] = flow.authorizationUrl
      if (flow.tokenUrl !== undefined) flowNode['tokenUrl'] = flow.tokenUrl
      if (flow.refreshUrl !== undefined) flowNode['refreshUrl'] = flow.refreshUrl
      flows[FLOW_KEY[flow.type]] = flowNode
    }
    node['flows'] = flows
  }
  if (scheme.openIdConnectUrl !== undefined) node['openIdConnectUrl'] = scheme.openIdConnectUrl
  return node
}

// ── Document ──────────────────────────────────────────────────────────

/** The whole documentation as an OpenAPI 3.0 document (plain JSON) —
 * the served /swagger.json dialect. */
export function apiDocumentationToOpenApi(doc: ApiDocumentation): Json {
  return emitOpenApi(doc, '3.0')
}

/** The whole documentation as an OpenAPI 3.1 document (plain JSON) —
 * the downloadable descriptor. */
export function apiDocumentationToOpenApi31(doc: ApiDocumentation): Json {
  return emitOpenApi(doc, '3.1')
}

function emitOpenApi(doc: ApiDocumentation, target: OasTarget): Json {
  const knownComponents = new Set(Object.keys(doc.models))

  const schemas: Json = {}
  for (const [name, model] of Object.entries(doc.models)) {
    schemas[name] = modelSchema(model, knownComponents, target)
  }

  const paths: Json = {}
  for (const operation of doc.operations) {
    const path = restormPathToSpec(operation.match.urlPattern)
    const method = (operation.match.method ?? 'GET').toLowerCase()
    const existing = (paths[path] ?? {}) as Json
    existing[method] = operationNode(operation, knownComponents, target)
    paths[path] = existing
  }

  const info: Json = { title: doc.api.title, version: doc.api.version ?? '1.0.0' }
  if (doc.api.description !== undefined) info['description'] = doc.api.description
  if (doc.api.termsOfService !== undefined) info['termsOfService'] = doc.api.termsOfService
  if (doc.api.contact !== undefined) info['contact'] = doc.api.contact
  if (doc.api.license !== undefined) info['license'] = doc.api.license

  const document: Json = {
    openapi: target === '3.1' ? '3.1.0' : '3.0.3',
    info
  }
  // `server.basePath` is the base path's ONLY carrier (operation paths
  // are relative by design), so `servers` must be emitted whenever host
  // OR basePath exists — a hostless design (the UI only exposes a base
  // path field) emits a RELATIVE server url, which OAS 3.0 allows.
  // Emitted in the conventional field order (before `paths`).
  if (doc.server?.host !== undefined) {
    const scheme = doc.server.schemes?.[0] ?? 'http'
    const hostWithScheme = /^[a-z]+:\/\//.test(doc.server.host) ? doc.server.host : `${scheme}://${doc.server.host}`
    document['servers'] = [{ url: `${hostWithScheme}${doc.server.basePath ?? ''}` }]
  } else if (doc.server?.basePath !== undefined && doc.server.basePath !== '') {
    document['servers'] = [{ url: doc.server.basePath }]
  }
  document['paths'] = paths
  const components: Json = {}
  if (Object.keys(schemas).length > 0) components['schemas'] = schemas
  if (doc.securitySchemes !== undefined && Object.keys(doc.securitySchemes).length > 0) {
    const securitySchemes: Json = {}
    for (const [name, scheme] of Object.entries(doc.securitySchemes)) {
      securitySchemes[name] = securitySchemeNode(scheme)
    }
    components['securitySchemes'] = securitySchemes
  }
  if (Object.keys(components).length > 0) document['components'] = components
  if (doc.defaultSecurity !== undefined) document['security'] = doc.defaultSecurity
  if (Object.keys(doc.groups).length > 0) {
    document['tags'] = Object.values(doc.groups).map((group) => {
      const tag: Json = { name: group.name }
      if (group.description !== undefined) tag['description'] = group.description
      if (group.externalDocs !== undefined) tag['externalDocs'] = group.externalDocs
      return tag
    })
  }
  if (doc.api.externalDocs !== undefined) document['externalDocs'] = doc.api.externalDocs
  return document
}
