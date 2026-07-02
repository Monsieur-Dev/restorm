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
 * Smithy normaliser. The `apiUpdate` refresh flow feeds this adapter the raw
 * JSON AST object (`{ smithy: '1.0', shapes: {...} }`) — the only one of the
 * two Smithy input formats that is itself valid JSON/YAML, which is what the
 * generic refresh pipeline parses the fetched spec text with (the `.smithy`
 * IDL text format has no refresh-by-URL path today, same limitation the
 * GraphQL SDL / gRPC `.proto` / SOAP WSDL text formats already carry).
 *
 * `naturalKey` mirrors `${METHOD} ${uri}` for HTTP-bound operations — the
 * same anchor `SmithyImportService.operationToRequest` uses — so a request
 * materialised by a fresh import matches back to this adapter's normalised
 * operation across refreshes. Operations without an `@http` binding key off
 * `operation ${name}` since they have no request to reconcile against.
 */
interface SmithyAstRefLike { target: string }
interface SmithyAstShapeLike {
  type: string
  input?: SmithyAstRefLike
  output?: SmithyAstRefLike
  members?: Record<string, { target: string; traits?: Record<string, unknown> }>
  traits?: Record<string, unknown>
}
interface SmithyAstSpecLike {
  shapes?: Record<string, SmithyAstShapeLike>
}

function simpleName(shapeId: string): string {
  const hashIdx = shapeId.indexOf('#')
  return hashIdx === -1 ? shapeId : shapeId.slice(hashIdx + 1)
}

function httpTraitOf(traits: Record<string, unknown> | undefined): { method: string; uri: string } | undefined {
  const http = traits?.['smithy.api#http'] as { method?: string; uri?: string } | undefined
  return http?.method && http.uri ? { method: http.method, uri: http.uri } : undefined
}

function paramLocation(traits: Record<string, unknown> | undefined): string | undefined {
  if (!traits) return undefined
  if ('smithy.api#httpLabel' in traits) return 'path'
  if (typeof traits['smithy.api#httpQuery'] === 'string') return 'query'
  if (typeof traits['smithy.api#httpHeader'] === 'string') return 'header'
  return undefined
}

function buildModelsAndEnums(spec: SmithyAstSpecLike): { models: NormalizedModel[]; enums: NormalizedEnum[] } {
  const models: NormalizedModel[] = []
  const enums: NormalizedEnum[] = []
  for (const [shapeId, shape] of Object.entries(spec.shapes ?? {})) {
    const name = simpleName(shapeId)
    const deprecated = shape.traits !== undefined && 'smithy.api#deprecated' in shape.traits
    if (shape.type === 'structure') {
      const properties = Object.entries(shape.members ?? {}).map(([memberName, member]) => ({
        name: memberName,
        type: simpleName(member.target),
        required: member.traits !== undefined && 'smithy.api#required' in member.traits
      }))
      models.push({ name, deprecated, properties })
    } else if (shape.type === 'enum' || shape.type === 'intEnum') {
      const values = Object.entries(shape.members ?? {}).map(([memberName, member]) => {
        const enumValue = member.traits?.['smithy.api#enumValue']
        return typeof enumValue === 'string' || typeof enumValue === 'number' ? String(enumValue) : memberName
      })
      enums.push({ name, values, deprecated })
    }
  }
  return { models, enums }
}

export const smithyImportAdapter: ImportAdapter = {
  format: 'smithy',
  extractNormalizedSpec(rawSpec: unknown, _options: AdapterOptions): NormalizedSpec {
    const spec = rawSpec as SmithyAstSpecLike
    const operations: NormalizedOperation[] = []

    for (const [shapeId, shape] of Object.entries(spec.shapes ?? {})) {
      if (shape.type !== 'operation') continue
      const name = simpleName(shapeId)
      const http = httpTraitOf(shape.traits)
      const deprecated = shape.traits !== undefined && 'smithy.api#deprecated' in shape.traits

      const inputShapeId = shape.input?.target
      const inputShape = inputShapeId ? spec.shapes?.[inputShapeId] : undefined
      const parameters = Object.entries(inputShape?.members ?? {})
        .map(([memberName, member]) => {
          const location = paramLocation(member.traits)
          if (!location) return undefined
          return { name: memberName, location, type: simpleName(member.target) }
        })
        .filter((p): p is { name: string; location: string; type: string } => p !== undefined)

      const shapeData: GenericOperationShape = {
        protocol: 'smithy',
        raw: {
          operationName: name,
          ...(http !== undefined ? { http } : {}),
          ...(shape.input !== undefined ? { input: simpleName(shape.input.target) } : {}),
          ...(shape.output !== undefined ? { output: simpleName(shape.output.target) } : {}),
          parameters
        }
      }

      operations.push({
        naturalKey: http !== undefined ? `${http.method.toUpperCase()} ${http.uri}` : `operation ${name}`,
        name,
        deprecated,
        shape: shapeData,
        operationId: name
      })
    }

    const { models, enums } = buildModelsAndEnums(spec)
    return { operations, models, enums, environments: [] }
  }
}
