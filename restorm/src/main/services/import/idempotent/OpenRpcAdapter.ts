import type {
  AdapterOptions,
  GenericOperationShape,
  ImportAdapter,
  NormalizedEnum,
  NormalizedModel,
  NormalizedOperation,
  NormalizedSpec
} from './types'

/**
 * OpenRPC documents declare `methods` — the JSON-RPC 2.0 analogue of
 * OpenAPI's `paths`. Unlike HTTP routes, methods aren't namespaced by
 * verb + path, and the spec requires method names to be unique within
 * a document, so `naturalKey` is simply the method name — the same
 * identity `OpenRpcImportService` stamps into `importOrigin`.
 *
 * `components.schemas` uses the same JSON Schema vocabulary as
 * OpenAPI / AsyncAPI, so models + enums are extracted the same way.
 */
interface OpenRpcSchemaLike {
  type?: string
  enum?: string[]
  description?: string
  deprecated?: boolean
  properties?: Record<string, OpenRpcSchemaLike>
  required?: string[]
}

interface OpenRpcMethodLike {
  name: string
  summary?: string
  description?: string
  deprecated?: boolean
}

interface OpenRpcDocumentLike {
  info?: { version?: string }
  methods?: OpenRpcMethodLike[]
  components?: { schemas?: Record<string, OpenRpcSchemaLike> }
}

function buildModels(spec: OpenRpcDocumentLike): NormalizedModel[] {
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

function buildEnums(spec: OpenRpcDocumentLike): NormalizedEnum[] {
  const out: NormalizedEnum[] = []
  const seen = new Set<string>()
  // Enums commonly live nested inside a schema's properties (e.g.
  // `User.properties.status.enum`) rather than as their own top-level
  // component — recurse so those aren't missed. Depth fuse guards
  // against self-referential / cyclic nested schemas.
  const visit = (schema: OpenRpcSchemaLike, name: string, depth = 0): void => {
    if (depth > 64) return
    if (schema.enum && schema.enum.length > 0 && !seen.has(name)) {
      out.push({ name, values: schema.enum.slice(), deprecated: schema.deprecated === true })
      seen.add(name)
    }
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        visit(propSchema, `${name} ${propName}`, depth + 1)
      }
    }
  }
  for (const [name, schema] of Object.entries(spec.components?.schemas ?? {})) visit(schema, name)
  return out
}

export const openrpcImportAdapter: ImportAdapter = {
  format: 'openrpc',
  extractNormalizedSpec(rawSpec: unknown, _options: AdapterOptions): NormalizedSpec {
    const spec = rawSpec as OpenRpcDocumentLike
    const operations: NormalizedOperation[] = (spec.methods ?? []).map((method) => {
      const shape: GenericOperationShape = {
        protocol: 'openrpc',
        raw: { method: method.name }
      }
      return {
        naturalKey: method.name,
        name: method.name,
        deprecated: method.deprecated === true,
        shape
      }
    })
    return {
      ...(spec.info?.version !== undefined ? { version: spec.info.version } : {}),
      operations,
      models: buildModels(spec),
      enums: buildEnums(spec),
      environments: []
    }
  }
}
