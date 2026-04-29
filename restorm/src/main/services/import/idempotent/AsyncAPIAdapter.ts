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
 * AsyncAPI documents declare `channels` (topic addresses) plus
 * `operations` (publish / subscribe / send / receive on a channel).
 * The pipeline normalises one operation per (channel × action)
 * pair. `naturalKey` is `${action} ${channel}` so a move from
 * `subscribe` to `receive` (the AsyncAPI 2.x → 3.x rename) shows up
 * as a structural change rather than a silent type drift.
 *
 * Models / enums are extracted from `components.schemas` like the
 * OpenAPI adapter; AsyncAPI inherits the same JSON Schema vocabulary.
 */
interface AsyncAPISchemaLike {
  type?: string
  enum?: string[]
  description?: string
  deprecated?: boolean
  properties?: Record<string, AsyncAPISchemaLike>
  required?: string[]
}

interface AsyncAPIChannelLike {
  description?: string
  publish?: AsyncAPIOperationLike
  subscribe?: AsyncAPIOperationLike
  send?: AsyncAPIOperationLike
  receive?: AsyncAPIOperationLike
}

interface AsyncAPIOperationLike {
  operationId?: string
  summary?: string
  description?: string
  deprecated?: boolean
}

interface AsyncAPISpecLike {
  asyncapi?: string
  info?: { title?: string; version?: string }
  channels?: Record<string, AsyncAPIChannelLike>
  components?: { schemas?: Record<string, AsyncAPISchemaLike> }
}

const ASYNCAPI_ACTIONS = ['publish', 'subscribe', 'send', 'receive'] as const

function buildModels(spec: AsyncAPISpecLike): NormalizedModel[] {
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

function buildEnums(spec: AsyncAPISpecLike): NormalizedEnum[] {
  const out: NormalizedEnum[] = []
  const seen = new Set<string>()
  const visit = (schema: AsyncAPISchemaLike, name: string): void => {
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
  for (const [name, schema] of Object.entries(spec.components?.schemas ?? {})) visit(schema, name)
  return out
}

export const asyncapiImportAdapter: ImportAdapter = {
  format: 'asyncapi',
  extractNormalizedSpec(rawSpec: unknown, _options: AdapterOptions): NormalizedSpec {
    const spec = rawSpec as AsyncAPISpecLike
    const operations: NormalizedOperation[] = []
    for (const [channel, channelDef] of Object.entries(spec.channels ?? {})) {
      for (const action of ASYNCAPI_ACTIONS) {
        const op = channelDef[action]
        if (!op) continue
        const shape: GenericOperationShape = {
          protocol: 'asyncapi',
          raw: { action, channel }
        }
        operations.push({
          naturalKey: `${action} ${channel}`,
          name: op.summary ?? op.operationId ?? `${action} ${channel}`,
          deprecated: op.deprecated === true,
          shape,
          ...(op.operationId !== undefined ? { operationId: op.operationId } : {})
        })
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
