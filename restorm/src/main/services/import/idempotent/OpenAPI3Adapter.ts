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
 * OpenAPI 3.x normaliser. Shares the bulk of its shape with the
 * Swagger 2.0 adapter (paths + operations + components/schemas) —
 * the differences (parameters expressed via $ref, requestBody
 * separated from parameters) are handled here so the pipeline still
 * sees a uniform `NormalizedSpec`.
 *
 * `naturalKey` is `${METHOD} ${path}` — same anchor as the Swagger
 * adapter so a project that migrated from a 2.0 spec to a 3.x spec
 * matches existing requests across the version bump.
 */
interface OpenAPISchemaLike {
  type?: string
  enum?: string[]
  description?: string
  deprecated?: boolean
  properties?: Record<string, OpenAPISchemaLike>
  required?: string[]
  items?: OpenAPISchemaLike
}

interface OpenAPIParameterLike {
  name: string
  in: string
  required?: boolean
  description?: string
  schema?: OpenAPISchemaLike
  example?: string
}

interface OpenAPIOperationLike {
  operationId?: string
  summary?: string
  description?: string
  deprecated?: boolean
  parameters?: OpenAPIParameterLike[]
  requestBody?: { content?: Record<string, { schema?: OpenAPISchemaLike }> }
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: OpenAPISchemaLike }> }>
}

interface OpenAPIPathItemLike {
  parameters?: OpenAPIParameterLike[]
  get?: OpenAPIOperationLike
  post?: OpenAPIOperationLike
  put?: OpenAPIOperationLike
  delete?: OpenAPIOperationLike
  patch?: OpenAPIOperationLike
  head?: OpenAPIOperationLike
  options?: OpenAPIOperationLike
}

interface OpenAPI3SpecLike {
  openapi?: string
  info?: { title?: string; version?: string }
  paths?: Record<string, OpenAPIPathItemLike>
  webhooks?: Record<string, OpenAPIPathItemLike>
  components?: { schemas?: Record<string, OpenAPISchemaLike> }
}

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const

function paramFromOpenAPI(p: OpenAPIParameterLike): NormalizedParameter {
  return {
    name: p.name,
    location: p.in,
    ...(p.schema?.type !== undefined ? { type: p.schema.type } : {}),
    ...(p.required !== undefined ? { required: p.required } : {}),
    ...(p.description !== undefined ? { description: p.description } : {}),
    ...(p.example !== undefined ? { defaultValue: p.example } : {})
  }
}

function buildOperation(
  method: typeof HTTP_METHODS[number],
  path: string,
  op: OpenAPIOperationLike,
  pathLevelParams: OpenAPIParameterLike[]
): NormalizedOperation {
  const allParams = [...pathLevelParams, ...(op.parameters ?? [])]
  const shape: HttpOperationShape = {
    protocol: 'http',
    method: method.toUpperCase(),
    url: path,
    parameters: allParams.map(paramFromOpenAPI)
  }
  // OpenAPI 3 splits the body off into requestBody. Surface it via
  // bodySchema so the pipeline can show "body changed" diffs even
  // though the body isn't a parameter.
  const firstBodyMediaType = op.requestBody?.content && Object.values(op.requestBody.content)[0]
  if (firstBodyMediaType?.schema) shape.bodySchema = firstBodyMediaType.schema
  return {
    naturalKey: `${method.toUpperCase()} ${path}`,
    name: op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`,
    deprecated: op.deprecated === true,
    shape,
    ...(op.operationId !== undefined ? { operationId: op.operationId } : {})
  }
}

function buildModels(spec: OpenAPI3SpecLike): NormalizedModel[] {
  const schemas = spec.components?.schemas ?? {}
  return Object.entries(schemas).map(([name, schema]) => ({
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

function buildEnums(spec: OpenAPI3SpecLike): NormalizedEnum[] {
  const out: NormalizedEnum[] = []
  const seen = new Set<string>()
  const visit = (schema: OpenAPISchemaLike, name: string): void => {
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
  const schemas = spec.components?.schemas ?? {}
  for (const [name, schema] of Object.entries(schemas)) visit(schema, name)
  return out
}

export const openapi3ImportAdapter: ImportAdapter = {
  format: 'openapi',
  extractNormalizedSpec(rawSpec: unknown, _options: AdapterOptions): NormalizedSpec {
    const spec = rawSpec as OpenAPI3SpecLike
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
