/**
 * Smithy model → ApiDocumentation transformer.
 *
 * Mirrors the model here rather than importing it from `SmithyImportService`
 * (same precedent as `grpcToApiDocumentation` / `graphqlToApiDocumentation`)
 * so the transformer stays decoupled from the parser module.
 */

import type {
  ApiDocumentation,
  GroupDocumentation,
  ModelDocumentation,
  OperationDocumentation,
  PropertyDocumentation
} from '../../../../shared/types/apiDocumentation'

interface SmithyTraitsData {
  http?: { method: string; uri: string }
  required?: boolean
  deprecated?: boolean
  error?: 'client' | 'server'
  documentation?: string
}

interface SmithyMemberData {
  name: string
  target: string
  traits: SmithyTraitsData
}

interface SmithyStructureData {
  kind: 'structure'
  name: string
  members: SmithyMemberData[]
  traits: SmithyTraitsData
}

interface SmithyEnumData {
  kind: 'enum' | 'intEnum'
  name: string
  members: { name: string; value?: string | number }[]
  traits: SmithyTraitsData
}

interface SmithyOperationData {
  kind: 'operation'
  name: string
  input?: string
  output?: string
  errors: string[]
  traits: SmithyTraitsData
}

interface SmithyServiceData {
  kind: 'service'
  name: string
  version?: string
  operations: string[]
  resources: string[]
  traits: SmithyTraitsData
}

interface SmithyResourceData {
  kind: 'resource'
  name: string
  operations: string[]
  resources: string[]
}

type SmithyShapeData =
  | SmithyStructureData
  | SmithyEnumData
  | SmithyOperationData
  | SmithyServiceData
  | SmithyResourceData

export interface SmithyModelData {
  namespace?: string
  shapes: Map<string, SmithyShapeData>
}

export interface SmithyTransformOptions {
  /** Fallback API title when the model has no `service` shape. */
  name?: string
  /** Host / baseUrl the generated routes are pinned to. */
  baseUrl?: string
  /** Original URL the model was fetched from. */
  sourceUrl?: string
}

function findService(model: SmithyModelData): SmithyServiceData | undefined {
  for (const shape of model.shapes.values()) {
    if (shape.kind === 'service') return shape
  }
  return undefined
}

/** Resource shape whose `operations` includes the given operation name, if any. */
function ownerResourceName(model: SmithyModelData, opName: string): string | undefined {
  for (const shape of model.shapes.values()) {
    if (shape.kind === 'resource' && shape.operations.includes(opName)) return shape.name
  }
  return undefined
}

function mapStructuresAndEnumsToModels(model: SmithyModelData): Record<string, ModelDocumentation> {
  const out: Record<string, ModelDocumentation> = {}
  for (const shape of model.shapes.values()) {
    if (shape.kind === 'structure') {
      const properties: PropertyDocumentation[] = shape.members.map((m) => ({
        name: m.name,
        type: m.target,
        required: m.traits.required === true
      }))
      out[shape.name] = { name: shape.name, properties, ...(shape.traits.deprecated === true ? { deprecated: true } : {}) }
    } else if (shape.kind === 'enum' || shape.kind === 'intEnum') {
      out[shape.name] = { name: shape.name, properties: [], enumValues: shape.members.map((m) => m.value ?? m.name) }
    }
  }
  return out
}

export function smithyToApiDocumentation(model: SmithyModelData, options: SmithyTransformOptions = {}): ApiDocumentation {
  const service = findService(model)
  const title = service?.name ?? options.name ?? model.namespace ?? 'Smithy API'

  const groups: Record<string, GroupDocumentation> = {}
  const operations: OperationDocumentation[] = []

  for (const shape of model.shapes.values()) {
    if (shape.kind !== 'operation') continue
    const groupName = ownerResourceName(model, shape.name) ?? service?.name ?? 'Operations'
    groups[groupName] ??= { name: groupName }

    const doc: OperationDocumentation = {
      match: {
        urlPattern: shape.traits.http?.uri ?? shape.name,
        ...(shape.traits.http?.method !== undefined ? { method: shape.traits.http.method } : {}),
        operationName: shape.name
      },
      group: groupName,
      summary: shape.name,
      operationId: shape.name,
      extra: { httpBound: shape.traits.http !== undefined }
    }
    if (shape.traits.documentation !== undefined) doc.description = shape.traits.documentation
    if (shape.traits.deprecated === true) doc.deprecated = true
    const refs = [shape.input, shape.output].filter((r): r is string => r !== undefined)
    if (refs.length > 0) doc.referencedModels = refs
    operations.push(doc)
  }

  const result: ApiDocumentation = {
    sourceType: 'smithy',
    api: { title, description: 'Smithy API', ...(service?.version !== undefined ? { version: service.version } : {}) },
    models: mapStructuresAndEnumsToModels(model),
    groups,
    operations
  }
  if (options.sourceUrl !== undefined) result.sourceUrl = options.sourceUrl
  if (options.baseUrl !== undefined) result.server = { host: options.baseUrl }
  return result
}
