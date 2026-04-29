import type {
  AdapterOptions,
  HttpOperationShape,
  ImportAdapter,
  NormalizedEnum,
  NormalizedModel,
  NormalizedOperation,
  NormalizedParameter,
  NormalizedSpec
} from './types'

/**
 * Minimal subset of the Swagger 2.0 / OpenAPI structural surface the
 * idempotent pipeline cares about. Mirrors what `SwaggerImportService`
 * already parses but kept narrow on purpose — adding format-specific
 * fields belongs to the materialiser, not the normaliser.
 */
interface SwaggerOperationLike {
  operationId?: string
  summary?: string
  description?: string
  deprecated?: boolean
  parameters?: SwaggerParamLike[]
  responses?: Record<string, { description?: string; schema?: unknown }>
}

interface SwaggerParamLike {
  name: string
  in: string
  type?: string
  required?: boolean
  description?: string
  default?: string
  enum?: string[]
  items?: { type?: string; enum?: string[] }
}

interface SwaggerPathItemLike {
  parameters?: SwaggerParamLike[]
  get?: SwaggerOperationLike
  post?: SwaggerOperationLike
  put?: SwaggerOperationLike
  delete?: SwaggerOperationLike
  patch?: SwaggerOperationLike
  head?: SwaggerOperationLike
  options?: SwaggerOperationLike
}

interface SwaggerSpecLike {
  swagger?: string
  openapi?: string
  info?: { title?: string; version?: string }
  paths?: Record<string, SwaggerPathItemLike>
  definitions?: Record<string, SwaggerSchemaLike>
  components?: { schemas?: Record<string, SwaggerSchemaLike> }
}

interface SwaggerSchemaLike {
  type?: string
  enum?: string[]
  description?: string
  deprecated?: boolean
  properties?: Record<string, SwaggerSchemaLike>
  required?: string[]
}

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const

function paramFromSwagger(p: SwaggerParamLike): NormalizedParameter {
  return {
    name: p.name,
    location: p.in,
    ...(p.type !== undefined ? { type: p.type } : {}),
    ...(p.required !== undefined ? { required: p.required } : {}),
    ...(p.description !== undefined ? { description: p.description } : {}),
    ...(p.default !== undefined ? { defaultValue: p.default } : {})
  }
}

/**
 * Build a normalised operation from a Swagger path-item entry. The
 * `naturalKey` is `${METHOD} ${path}` to match what the existing
 * import services already emit on `request.url` so a re-import lines
 * up via either `operationId` or the URL.
 */
function buildOperation(
  method: typeof HTTP_METHODS[number],
  path: string,
  op: SwaggerOperationLike,
  pathLevelParams: SwaggerParamLike[]
): NormalizedOperation {
  const allParams = [...pathLevelParams, ...(op.parameters ?? [])]
  const shape: HttpOperationShape = {
    protocol: 'http',
    method: method.toUpperCase(),
    url: path,
    parameters: allParams.map(paramFromSwagger)
  }
  return {
    naturalKey: `${method.toUpperCase()} ${path}`,
    name: op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`,
    deprecated: op.deprecated === true,
    shape,
    ...(op.operationId !== undefined ? { operationId: op.operationId } : {})
  }
}

function buildModels(spec: SwaggerSpecLike): NormalizedModel[] {
  const definitions = spec.definitions ?? spec.components?.schemas ?? {}
  return Object.entries(definitions).map(([name, schema]) => ({
    name,
    ...(schema.description !== undefined ? { description: schema.description } : {}),
    deprecated: schema.deprecated === true,
    properties: Object.entries(schema.properties ?? {}).map(([propName, propSchema]) => ({
      name: propName,
      type: propSchema.type ?? 'unknown',
      required: schema.required?.includes(propName) ?? false,
      ...(propSchema.description !== undefined ? { description: propSchema.description } : {}),
      deprecated: propSchema.deprecated === true
    }))
  }))
}

function buildEnums(spec: SwaggerSpecLike): NormalizedEnum[] {
  const out: NormalizedEnum[] = []
  const seen = new Set<string>()
  const visit = (schema: SwaggerSchemaLike, name: string): void => {
    if (schema.enum && schema.enum.length > 0 && !seen.has(name)) {
      out.push({ name, values: schema.enum.slice(), deprecated: schema.deprecated === true })
      seen.add(name)
    }
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        visit(propSchema, `${name} ${propName}`)
      }
    }
  }
  const definitions = spec.definitions ?? spec.components?.schemas ?? {}
  for (const [name, schema] of Object.entries(definitions)) visit(schema, name)
  return out
}

/**
 * Format adapter for Swagger 2.0 / OpenAPI 3.x specs. The pipeline
 * dispatches to this when the import source resolves to either of
 * those formats; the pre-existing `SwaggerImportService` /
 * `OpenAPIImportService` continue to handle the materialisation of
 * fresh imports — this adapter is consumed by the **refresh-in-place**
 * path so the same parsed spec drives an idempotent reconcile rather
 * than a fresh import.
 */
export const swaggerImportAdapter: ImportAdapter = {
  format: 'swagger',
  extractNormalizedSpec(rawSpec: unknown, _options: AdapterOptions): NormalizedSpec {
    const spec = rawSpec as SwaggerSpecLike
    const operations: NormalizedOperation[] = []
    for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
      const pathLevelParams = pathItem.parameters ?? []
      for (const method of HTTP_METHODS) {
        const op = pathItem[method]
        if (!op) continue
        operations.push(buildOperation(method, path, op, pathLevelParams))
      }
    }
    return {
      ...(spec.info?.version !== undefined ? { version: spec.info.version } : {}),
      operations,
      models: buildModels(spec),
      enums: buildEnums(spec),
      environments: []
    }
  }
}
