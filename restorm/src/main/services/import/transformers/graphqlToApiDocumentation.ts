/**
 * GraphQL Schema (SDL) → ApiDocumentation transformer.
 */

import type {
  ApiDocumentation,
  GroupDocumentation,
  ModelDocumentation,
  OperationDocumentation,
  ParameterDocumentation,
  PropertyDocumentation
} from '../../../../shared/types/apiDocumentation'

// ---------- GraphQL source-spec types (mirror GraphQLImportService) ----------

export interface GraphQLArgumentData {
  name: string
  type: string
  description?: string | undefined
  defaultValue?: string | undefined
}

export interface GraphQLFieldData {
  name: string
  description?: string | undefined
  args: GraphQLArgumentData[]
  type: string
}

export interface GraphQLTypeData {
  name: string
  description?: string | undefined
  fields: GraphQLFieldData[]
}

export interface ParsedGraphQLSchemaData {
  types: GraphQLTypeData[]
  queries: GraphQLFieldData[]
  mutations: GraphQLFieldData[]
  subscriptions: GraphQLFieldData[]
}

export interface GraphQLTransformOptions {
  /** Fallback API title. */
  name?: string
  /** Host / baseUrl the GraphQL endpoint lives at. */
  baseUrl?: string
  /** Original URL the schema was fetched from. */
  sourceUrl?: string
}

// ---------- Helpers ----------

const SCALAR_TYPES = new Set(['String', 'Int', 'Float', 'Boolean', 'ID'])

/** Extract the "root" type name from a SDL type string (e.g., `[Pet!]!` → `Pet`). */
function extractRootType(type: string): string {
  return type.replace(/[![\]]/g, '').trim()
}

function isCustomType(type: string, modelNames: Set<string>): boolean {
  const root = extractRootType(type)
  return modelNames.has(root) && !SCALAR_TYPES.has(root)
}

function mapTypesToModels(types: GraphQLTypeData[]): Record<string, ModelDocumentation> {
  const out: Record<string, ModelDocumentation> = {}
  for (const t of types) {
    const properties: PropertyDocumentation[] = t.fields.map((f) => {
      const prop: PropertyDocumentation = {
        name: f.name,
        type: f.type,
        required: f.type.trim().endsWith('!')
      }
      if (f.description !== undefined) prop.description = f.description
      return prop
    })
    const model: ModelDocumentation = { name: t.name, properties }
    if (t.description !== undefined) model.description = t.description
    out[t.name] = model
  }
  return out
}

function mapArgs(args: GraphQLArgumentData[]): ParameterDocumentation[] | undefined {
  if (args.length === 0) return undefined
  return args.map((a) => {
    const p: ParameterDocumentation = {
      name: a.name,
      location: 'argument',
      type: a.type,
      required: a.type.trim().endsWith('!')
    }
    if (a.description !== undefined) p.description = a.description
    if (a.defaultValue !== undefined) p.defaultValue = a.defaultValue
    return p
  })
}

function buildOperations(
  fields: GraphQLFieldData[],
  operationType: 'query' | 'mutation' | 'subscription',
  groupName: string,
  urlPattern: string,
  modelNames: Set<string>
): OperationDocumentation[] {
  return fields.map((f) => {
    const doc: OperationDocumentation = {
      match: {
        urlPattern,
        operationName: f.name,
        operationType
      },
      group: groupName,
      summary: f.name,
      operationId: f.name
    }
    if (f.description !== undefined) doc.description = f.description
    const params = mapArgs(f.args)
    if (params !== undefined) doc.parameters = params
    if (isCustomType(f.type, modelNames)) {
      doc.referencedModels = [extractRootType(f.type)]
    }
    return doc
  })
}

// ---------- Entry point ----------

export function graphqlToApiDocumentation(
  parsed: ParsedGraphQLSchemaData,
  options: GraphQLTransformOptions = {}
): ApiDocumentation {
  const title = options.name ?? 'GraphQL API'
  const urlPattern = options.baseUrl ?? ''
  const modelNames = new Set(parsed.types.map((t) => t.name))

  const groups: Record<string, GroupDocumentation> = {}
  if (parsed.queries.length > 0) groups.Queries = { name: 'Queries' }
  if (parsed.mutations.length > 0) groups.Mutations = { name: 'Mutations' }
  if (parsed.subscriptions.length > 0) groups.Subscriptions = { name: 'Subscriptions' }

  const operations: OperationDocumentation[] = [
    ...buildOperations(parsed.queries, 'query', 'Queries', urlPattern, modelNames),
    ...buildOperations(parsed.mutations, 'mutation', 'Mutations', urlPattern, modelNames),
    ...buildOperations(parsed.subscriptions, 'subscription', 'Subscriptions', urlPattern, modelNames)
  ]

  const result: ApiDocumentation = {
    sourceType: 'graphql',
    api: { title },
    models: mapTypesToModels(parsed.types),
    groups,
    operations
  }

  if (options.sourceUrl !== undefined) result.sourceUrl = options.sourceUrl
  if (options.baseUrl !== undefined) result.server = { host: options.baseUrl }

  return result
}
