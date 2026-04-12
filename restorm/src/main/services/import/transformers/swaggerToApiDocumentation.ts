/**
 * Swagger / OpenAPI 2.0 → ApiDocumentation transformer.
 *
 * Reads a parsed SwaggerSpec and produces the common ApiDocumentation structure stored
 * on the root EnvironmentFolder after import. Markdown compilation happens later, on the
 * fly, via the generic Handlebars templates in DocumentationCompiler.
 */

import type {
  ApiDocumentation,
  GroupDocumentation,
  ModelDocumentation,
  OperationDocumentation,
  ParameterDocumentation,
  PropertyDocumentation,
  ResponseDocumentation
} from '../../../../shared/types/apiDocumentation'

// ---------- Swagger source-spec types (minimal subset we consume) ----------

interface SwaggerContact { name?: string; email?: string; url?: string }
interface SwaggerLicense { name?: string; url?: string }
interface SwaggerExternalDocs { description?: string; url: string }

interface SwaggerSchema {
  $ref?: string
  type?: string
  format?: string
  description?: string
  items?: SwaggerSchema
  additionalProperties?: SwaggerSchema
  properties?: Record<string, SwaggerSchema>
  required?: string[]
  enum?: string[]
}

interface SwaggerParameter {
  name: string
  in: string
  description?: string
  required?: boolean
  type?: string
  format?: string
  default?: string | number | boolean
  schema?: SwaggerSchema
}

interface SwaggerResponse {
  description: string
  schema?: SwaggerSchema
  headers?: Record<string, { type: string; description?: string }>
}

interface SwaggerOperation {
  tags?: string[]
  summary?: string
  description?: string
  operationId?: string
  consumes?: string[]
  produces?: string[]
  parameters?: SwaggerParameter[]
  responses?: Record<string, SwaggerResponse>
  security?: Record<string, string[]>[]
  deprecated?: boolean
  externalDocs?: SwaggerExternalDocs
}

type SwaggerPathItem = Partial<Record<'get' | 'post' | 'put' | 'delete' | 'patch' | 'head' | 'options', SwaggerOperation>>

export interface SwaggerSpec {
  swagger?: string
  info: {
    title: string
    description?: string
    version?: string
    termsOfService?: string
    contact?: SwaggerContact
    license?: SwaggerLicense
  }
  host?: string
  basePath?: string
  schemes?: string[]
  tags?: { name: string; description?: string; externalDocs?: SwaggerExternalDocs }[]
  paths: Record<string, SwaggerPathItem>
  definitions?: Record<string, SwaggerSchema>
  externalDocs?: SwaggerExternalDocs
}

// ---------- Helpers ----------

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const
type HttpMethod = (typeof HTTP_METHODS)[number]

function refName(ref: string): string {
  const parts = ref.split('/')
  return parts[parts.length - 1] ?? ref
}

function schemaTypeLabel(schema: SwaggerSchema, depth = 0): string {
  if (depth > 5) return '...'
  if (schema.$ref) return refName(schema.$ref)
  if (schema.type === 'array' && schema.items) return `array<${schemaTypeLabel(schema.items, depth + 1)}>`
  if (schema.type) return schema.type
  if (schema.properties) return 'object'
  return 'any'
}

function collectReferencedModels(op: SwaggerOperation): string[] {
  const refs = new Set<string>()
  const walk = (schema: SwaggerSchema | undefined): void => {
    if (!schema) return
    if (schema.$ref) refs.add(refName(schema.$ref))
    if (schema.items) walk(schema.items)
    if (schema.additionalProperties) walk(schema.additionalProperties)
    if (schema.properties) {
      for (const child of Object.values(schema.properties)) walk(child)
    }
  }
  for (const p of op.parameters ?? []) walk(p.schema)
  for (const r of Object.values(op.responses ?? {})) walk(r.schema)
  return Array.from(refs)
}

function parameterType(param: SwaggerParameter): string {
  if (param.schema?.$ref) return refName(param.schema.$ref)
  if (param.schema) return schemaTypeLabel(param.schema)
  if (param.type === 'array') return 'array'
  return param.type ?? 'any'
}

function mapParameters(params: SwaggerParameter[] | undefined): ParameterDocumentation[] | undefined {
  if (!params || params.length === 0) return undefined
  return params.map((p) => {
    const entry: ParameterDocumentation = {
      name: p.name,
      location: p.in,
      type: parameterType(p),
      required: p.required ?? false
    }
    if (p.description !== undefined) entry.description = p.description
    if (p.default !== undefined) entry.defaultValue = String(p.default)
    return entry
  })
}

function mapResponses(responses: Record<string, SwaggerResponse> | undefined): Record<string, ResponseDocumentation> | undefined {
  if (!responses) return undefined
  const out: Record<string, ResponseDocumentation> = {}
  for (const [code, resp] of Object.entries(responses)) {
    const entry: ResponseDocumentation = {}
    if (resp.description) entry.description = resp.description
    if (resp.schema?.$ref) entry.schema = refName(resp.schema.$ref)
    else if (resp.schema) entry.schema = schemaTypeLabel(resp.schema)
    if (resp.headers) entry.headers = resp.headers
    out[code] = entry
  }
  return out
}

function mapModels(definitions: Record<string, SwaggerSchema> | undefined): Record<string, ModelDocumentation> {
  if (!definitions) return {}
  const out: Record<string, ModelDocumentation> = {}
  for (const [name, schema] of Object.entries(definitions)) {
    const required = new Set(schema.required ?? [])
    const properties: PropertyDocumentation[] = []
    for (const [propName, propSchema] of Object.entries(schema.properties ?? {})) {
      const prop: PropertyDocumentation = {
        name: propName,
        type: schemaTypeLabel(propSchema),
        required: required.has(propName)
      }
      if (propSchema.description !== undefined) prop.description = propSchema.description
      properties.push(prop)
    }
    const entry: ModelDocumentation = { name, properties }
    if (schema.description !== undefined) entry.description = schema.description
    out[name] = entry
  }
  return out
}

function mapGroups(tags: SwaggerSpec['tags']): Record<string, GroupDocumentation> {
  if (!tags) return {}
  const out: Record<string, GroupDocumentation> = {}
  for (const tag of tags) {
    const entry: GroupDocumentation = { name: tag.name }
    if (tag.description !== undefined) entry.description = tag.description
    if (tag.externalDocs !== undefined) entry.externalDocs = tag.externalDocs
    out[tag.name] = entry
  }
  return out
}

// ---------- Entry point ----------

export interface SwaggerTransformOptions {
  /** URL the spec was fetched from (if any) — becomes ApiDocumentation.sourceUrl. */
  sourceUrl?: string
}

export function swaggerToApiDocumentation(
  spec: SwaggerSpec,
  options: SwaggerTransformOptions = {}
): ApiDocumentation {
  const operations: OperationDocumentation[] = []

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = pathItem[method as HttpMethod]
      if (!op) continue

      const doc: OperationDocumentation = {
        match: {
          urlPattern: path,
          method: method.toUpperCase()
        }
      }
      if (op.tags?.[0] !== undefined) doc.group = op.tags[0]
      if (op.summary !== undefined) doc.summary = op.summary
      if (op.description !== undefined) doc.description = op.description
      if (op.operationId !== undefined) doc.operationId = op.operationId
      if (op.deprecated) doc.deprecated = true
      if (op.externalDocs !== undefined) doc.externalDocs = op.externalDocs
      if (op.consumes !== undefined) doc.consumes = op.consumes
      if (op.produces !== undefined) doc.produces = op.produces
      const params = mapParameters(op.parameters)
      if (params !== undefined) doc.parameters = params
      const responses = mapResponses(op.responses)
      if (responses !== undefined) doc.responses = responses
      if (op.security !== undefined) doc.security = op.security
      const refs = collectReferencedModels(op)
      if (refs.length > 0) doc.referencedModels = refs

      operations.push(doc)
    }
  }

  const result: ApiDocumentation = {
    sourceType: 'swagger',
    api: {
      title: spec.info.title
    },
    models: mapModels(spec.definitions),
    groups: mapGroups(spec.tags),
    operations
  }

  if (options.sourceUrl !== undefined) result.sourceUrl = options.sourceUrl
  if (spec.info.description !== undefined) result.api.description = spec.info.description
  if (spec.info.version !== undefined) result.api.version = spec.info.version
  if (spec.info.contact !== undefined) result.api.contact = spec.info.contact
  if (spec.info.license !== undefined) result.api.license = spec.info.license
  if (spec.info.termsOfService !== undefined) result.api.termsOfService = spec.info.termsOfService
  if (spec.externalDocs !== undefined) result.api.externalDocs = spec.externalDocs

  if (spec.host !== undefined || spec.basePath !== undefined || spec.schemes !== undefined) {
    result.server = {}
    if (spec.host !== undefined) result.server.host = spec.host
    if (spec.basePath !== undefined) result.server.basePath = spec.basePath
    if (spec.schemes !== undefined) result.server.schemes = spec.schemes
  }

  return result
}
