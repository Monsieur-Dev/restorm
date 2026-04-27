/**
 * Swagger / OpenAPI 2.0 → ApiDocumentation transformer.
 *
 * Reads a parsed SwaggerSpec and produces the common ApiDocumentation
 * structure stored on the root EnvironmentFolder after import. Markdown
 * compilation happens later, on the fly, via the generic Handlebars
 * templates in DocumentationCompiler.
 *
 * Refactored on top of `_shared.ts`: the version-agnostic mapping helpers
 * (parameter/response/group/property mapping, ref-name extraction, schema
 * label rendering, schema-graph traversal, operation row building) live
 * there now, so the 3.0 / 3.1 transformers reuse them. The 2.0-specific
 * shapes (path-item, parameter `in`-discriminated body, top-level `host` /
 * `basePath` / `schemes`) stay here.
 */

import type {
  ApiDocumentation,
  ExternalDocs,
  ModelDocumentation,
  OperationDocumentation
} from '../../../../shared/types/apiDocumentation'
import {
  HTTP_METHODS,
  buildApiInfo,
  buildOperationDocumentation,
  mapSchemaProperties,
  mapTagsToGroups,
  walkSchemaRefs,
  type CommonInfo,
  type CommonParameter,
  type CommonResponse,
  type CommonSchema,
  type CommonTag,
  type HttpMethod,
  type OperationDocumentationInput
} from './_shared'

// ---------- Swagger source-spec types (minimal subset we consume) ----------

interface SwaggerParameter {
  name: string
  in: string
  description?: string
  required?: boolean
  type?: string
  format?: string
  default?: string | number | boolean
  schema?: CommonSchema
}

interface SwaggerResponse {
  description: string
  schema?: CommonSchema
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
  externalDocs?: ExternalDocs
}

type SwaggerPathItem = Partial<Record<HttpMethod, SwaggerOperation>>

export interface SwaggerSpec {
  swagger?: string
  info: CommonInfo
  host?: string
  basePath?: string
  schemes?: string[]
  tags?: CommonTag[]
  paths: Record<string, SwaggerPathItem>
  definitions?: Record<string, CommonSchema>
  externalDocs?: ExternalDocs
}

// ---------- 2.0-specific helpers ----------

/** Lift a Swagger 2.0 parameter (with inline `type`/`format`) onto the
 * common parameter shape. The flat `type` is folded into a synthetic
 * schema so downstream renderers see the same shape across versions. */
function toCommonParameter(p: SwaggerParameter): CommonParameter {
  let schema: CommonSchema | undefined
  if (p.schema) schema = p.schema
  else if (p.type !== undefined) schema = { type: p.type, ...(p.format !== undefined ? { format: p.format } : {}) }

  const out: CommonParameter = { name: p.name, in: p.in }
  if (p.description !== undefined) out.description = p.description
  if (p.required !== undefined) out.required = p.required
  if (schema) out.schema = schema
  if (p.default !== undefined) out.default = p.default
  return out
}

/** Map 2.0 responses onto the common response shape. */
function toCommonResponses(responses: Record<string, SwaggerResponse> | undefined): Record<string, CommonResponse> | undefined {
  if (!responses) return undefined
  const out: Record<string, CommonResponse> = {}
  for (const [code, resp] of Object.entries(responses)) {
    const entry: CommonResponse = {}
    if (resp.description) entry.description = resp.description
    if (resp.schema) entry.schema = resp.schema
    if (resp.headers) entry.headers = resp.headers
    out[code] = entry
  }
  return out
}

/** Walk every schema reachable from a 2.0 operation and return referenced model names. */
function collectReferencedModels(op: SwaggerOperation): string[] {
  const refs = new Set<string>()
  const visit = (name: string): void => { refs.add(name) }
  for (const p of op.parameters ?? []) walkSchemaRefs(p.schema, visit)
  for (const r of Object.values(op.responses ?? {})) walkSchemaRefs(r.schema, visit)
  return Array.from(refs)
}

/** Map `definitions` onto `ModelDocumentation`. */
function mapModels(definitions: Record<string, CommonSchema> | undefined): Record<string, ModelDocumentation> {
  if (!definitions) return {}
  const out: Record<string, ModelDocumentation> = {}
  for (const [name, schema] of Object.entries(definitions)) {
    const entry: ModelDocumentation = { name, properties: mapSchemaProperties(schema) }
    if (schema.description !== undefined) entry.description = schema.description
    out[name] = entry
  }
  return out
}

// ---------- Entry point ----------

export interface SwaggerTransformOptions {
  /** URL the spec was fetched from (if any) — becomes `ApiDocumentation.sourceUrl`. */
  sourceUrl?: string
}

export function swaggerToApiDocumentation(
  spec: SwaggerSpec,
  options: SwaggerTransformOptions = {}
): ApiDocumentation {
  const operations: OperationDocumentation[] = []

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const op = pathItem[method]
      if (!op) continue

      const input: OperationDocumentationInput = {
        path,
        method,
        parameters: op.parameters ? op.parameters.map(toCommonParameter) : undefined,
        responses: toCommonResponses(op.responses),
        referencedModels: collectReferencedModels(op)
      }
      if (op.tags !== undefined) input.tags = op.tags
      if (op.summary !== undefined) input.summary = op.summary
      if (op.description !== undefined) input.description = op.description
      if (op.operationId !== undefined) input.operationId = op.operationId
      if (op.deprecated) input.deprecated = true
      if (op.externalDocs !== undefined) input.externalDocs = op.externalDocs
      if (op.consumes !== undefined) input.consumes = op.consumes
      if (op.produces !== undefined) input.produces = op.produces
      if (op.security !== undefined) input.security = op.security

      operations.push(buildOperationDocumentation(input))
    }
  }

  const result: ApiDocumentation = {
    sourceType: 'swagger',
    api: buildApiInfo(spec.info, spec.externalDocs),
    models: mapModels(spec.definitions),
    groups: mapTagsToGroups(spec.tags),
    operations
  }

  if (options.sourceUrl !== undefined) result.sourceUrl = options.sourceUrl

  if (spec.host !== undefined || spec.basePath !== undefined || spec.schemes !== undefined) {
    result.server = {}
    if (spec.host !== undefined) result.server.host = spec.host
    if (spec.basePath !== undefined) result.server.basePath = spec.basePath
    if (spec.schemes !== undefined) result.server.schemes = spec.schemes
  }

  return result
}
