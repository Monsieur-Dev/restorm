import type {
  AdapterOptions,
  GraphqlOperationShape,
  ImportAdapter,
  NormalizedEnum,
  NormalizedModel,
  NormalizedOperation,
  NormalizedParameter,
  NormalizedSpec
} from './types'

/**
 * Minimal subset of the parser output that `GraphQLImportService`
 * already produces. The adapter doesn't re-parse SDL — the
 * orchestrator hands a `ParsedGraphQLSchema` in (whatever form the
 * existing service returns), and the adapter projects it onto the
 * normalised contract.
 */
interface GraphqlFieldLike {
  name: string
  description?: string
  args?: GraphqlArgLike[]
  type?: string
  deprecated?: boolean
  deprecationReason?: string
}

interface GraphqlArgLike {
  name: string
  type?: string
  description?: string
  defaultValue?: string
}

interface GraphqlTypeLike {
  name: string
  description?: string
  deprecated?: boolean
  fields?: GraphqlFieldLike[]
}

interface GraphqlEnumLike {
  name: string
  values: string[]
  deprecated?: boolean
}

interface ParsedGraphqlSchemaLike {
  types?: GraphqlTypeLike[]
  queries?: GraphqlFieldLike[]
  mutations?: GraphqlFieldLike[]
  subscriptions?: GraphqlFieldLike[]
  enums?: GraphqlEnumLike[]
  /** Optional version string surfaced from a `# version: x.y.z` SDL
   * comment or the introspection `__Schema.description`. The adapter
   * doesn't compute it — the orchestrator passes it through. */
  version?: string
}

function paramFromArg(arg: GraphqlArgLike): NormalizedParameter {
  return {
    name: arg.name,
    location: 'argument',
    ...(arg.type !== undefined ? { type: arg.type } : {}),
    ...(arg.description !== undefined ? { description: arg.description } : {}),
    ...(arg.defaultValue !== undefined ? { defaultValue: arg.defaultValue } : {})
  }
}

function buildFieldDocument(operationType: 'query' | 'mutation' | 'subscription', field: GraphqlFieldLike): string {
  const args = field.args ?? []
  const argsStr = args.length > 0
    ? `(${args.map((a) => `${a.name}: $${a.name}`).join(', ')})`
    : ''
  const variableHeader = args.length > 0
    ? `(${args.map((a) => `$${a.name}: ${a.type ?? 'String'}`).join(', ')})`
    : ''
  return `${operationType}${variableHeader} {\n  ${field.name}${argsStr}\n}`
}

function operationFromField(
  field: GraphqlFieldLike,
  operationType: 'query' | 'mutation' | 'subscription'
): NormalizedOperation {
  const variables = (field.args ?? []).map(paramFromArg)
  const shape: GraphqlOperationShape = {
    protocol: 'graphql',
    operationType,
    fieldName: field.name,
    document: buildFieldDocument(operationType, field),
    variables
  }
  return {
    naturalKey: `${operationType} ${field.name}`,
    name: field.name,
    deprecated: field.deprecated === true,
    shape
  }
}

function buildModels(types: GraphqlTypeLike[]): NormalizedModel[] {
  return types.map((t) => ({
    name: t.name,
    ...(t.description !== undefined ? { description: t.description } : {}),
    deprecated: t.deprecated === true,
    properties: (t.fields ?? []).map((f) => ({
      name: f.name,
      type: f.type ?? 'unknown',
      required: false,
      ...(f.description !== undefined ? { description: f.description } : {}),
      deprecated: f.deprecated === true
    }))
  }))
}

function buildEnums(enums: GraphqlEnumLike[]): NormalizedEnum[] {
  return enums.map((e) => ({
    name: e.name,
    values: e.values.slice(),
    deprecated: e.deprecated === true
  }))
}

/**
 * Format adapter for parsed GraphQL schemas. The pipeline matches
 * operations across re-imports by `naturalKey = `${type} ${field}``
 * — GraphQL doesn't carry a separate `operationId` concept, so the
 * field name is the natural identity.
 */
export const graphqlImportAdapter: ImportAdapter = {
  format: 'graphql',
  extractNormalizedSpec(rawSpec: unknown, _options: AdapterOptions): NormalizedSpec {
    const spec = rawSpec as ParsedGraphqlSchemaLike
    const operations: NormalizedOperation[] = [
      ...(spec.queries ?? []).map((f) => operationFromField(f, 'query')),
      ...(spec.mutations ?? []).map((f) => operationFromField(f, 'mutation')),
      ...(spec.subscriptions ?? []).map((f) => operationFromField(f, 'subscription'))
    ]
    return {
      ...(spec.version !== undefined ? { version: spec.version } : {}),
      operations,
      models: buildModels(spec.types ?? []),
      enums: buildEnums(spec.enums ?? []),
      environments: []
    }
  }
}
