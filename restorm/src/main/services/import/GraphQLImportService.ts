/**
 * Service for importing GraphQL schemas into Restorm collections
 */

import {
  Folder,
  EnvironmentFolder,
  Environment,
  GraphQLRequest,
  type GraphQLOperationType
} from '../../../shared/models'
import type { EnumDefinition } from '../../../shared/types/collections'
import { createTypedKeyValue } from '../../../shared/utils/createTypedKeyValue'
import { graphqlToApiDocumentation } from './transformers/graphqlToApiDocumentation'

// ============================================================================
// GraphQL Schema Types
// ============================================================================

interface GraphQLField {
  name: string
  description?: string | undefined
  args: GraphQLArgument[]
  type: string
}

interface GraphQLArgument {
  name: string
  type: string
  description?: string | undefined
  defaultValue?: string | undefined
}

interface GraphQLType {
  name: string
  description?: string | undefined
  fields: GraphQLField[]
}

interface GraphQLEnumType {
  name: string
  values: string[]
}

interface ParsedGraphQLSchema {
  types: GraphQLType[]
  queries: GraphQLField[]
  mutations: GraphQLField[]
  subscriptions: GraphQLField[]
  enums: GraphQLEnumType[]
}

// ============================================================================
// Parser Functions
// ============================================================================

/** Parse a GraphQL type string from schema */
function parseTypeString(typeStr: string): string {
  return typeStr.trim()
}

/** Parse arguments from a field definition */
function parseArguments(argsStr: string): GraphQLArgument[] {
  if (!argsStr || argsStr.trim() === '') return []
  
  const args: GraphQLArgument[] = []
  // Simple parsing: split by comma, handle basic cases
  const argParts = argsStr.split(',')
  
  for (const part of argParts) {
    const match = /^(\w+)\s*:\s*(.+?)(?:\s*=\s*(.+))?$/.exec(part.trim())
    if (match?.[1] && match[2]) {
      args.push({
        name: match[1],
        type: parseTypeString(match[2]),
        defaultValue: match[3]?.trim()
      })
    }
  }
  
  return args
}

/** Parse a GraphQL SDL schema string */
function parseGraphQLSchema(schemaString: string): ParsedGraphQLSchema {
  const result: ParsedGraphQLSchema = {
    types: [],
    queries: [],
    mutations: [],
    subscriptions: [],
    enums: []
  }
  
  // Remove comments
  const cleanedSchema = schemaString
    .replace(/#[^\n]*/g, '') // Remove single-line comments
    .replace(/"""[\s\S]*?"""/g, (match) => {
      // Keep triple-quoted descriptions but mark them
      return `__DESC__${match}__DESC__`
    })
  
  // Parse type definitions
  const typeRegex = /type\s+(\w+)\s*\{([^}]+)\}/g
  let typeMatch
  
  while ((typeMatch = typeRegex.exec(cleanedSchema)) !== null) {
    const typeName = typeMatch[1]
    const fieldsBlock = typeMatch[2]
    
    if (!typeName || !fieldsBlock) continue
    
    const fields = parseFieldsBlock(fieldsBlock)
    
    if (typeName === 'Query') {
      result.queries = fields
    } else if (typeName === 'Mutation') {
      result.mutations = fields
    } else if (typeName === 'Subscription') {
      result.subscriptions = fields
    } else {
      result.types.push({
        name: typeName,
        fields
      })
    }
  }
  
  // Parse enum definitions: enum Name { VALUE1 VALUE2 ... }
  const enumRegex = /enum\s+(\w+)\s*\{([^}]+)\}/g
  let enumMatch
  while ((enumMatch = enumRegex.exec(cleanedSchema)) !== null) {
    const enumName = enumMatch[1]
    const valuesBlock = enumMatch[2]
    if (!enumName || !valuesBlock) continue
    const values = valuesBlock
      .split('\n')
      .map((l) => l.replace(/__DESC__[\s\S]*?__DESC__/g, '').trim())
      .filter((l) => l.length > 0 && !l.startsWith('@'))
    if (values.length > 0) {
      result.enums.push({ name: enumName, values })
    }
  }

  return result
}

/** Parse fields from a type block */
function parseFieldsBlock(block: string): GraphQLField[] {
  const fields: GraphQLField[] = []
  const lines = block.split('\n')
  
  let currentDescription = ''
  
  for (const line of lines) {
    const trimmed = line.trim()
    
    // Check for description (triple quotes)
    if (trimmed.startsWith('"""')) {
      const descMatch = /"""(.+?)"""/.exec(trimmed)
      if (descMatch?.[1]) {
        currentDescription = descMatch[1].trim()
      }
      continue
    }
    
    // Skip empty lines
    if (!trimmed) continue
    
    // Parse field: name(args): Type
    const fieldMatch = /^(\w+)(?:\(([^)]*)\))?\s*:\s*(.+)$/.exec(trimmed)
    if (fieldMatch?.[1] && fieldMatch[3]) {
      fields.push({
        name: fieldMatch[1],
        description: currentDescription || undefined,
        args: parseArguments(fieldMatch[2] ?? ''),
        type: parseTypeString(fieldMatch[3])
      })
      currentDescription = ''
    }
  }
  
  return fields
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Generate a deterministic ID from a seed string */
function generateId(seed?: string): string {
  if (!seed) {
    return crypto.randomUUID()
  }
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0')
  return `${hex}-${seed.length.toString(16).padStart(4, '0')}-4000-8000-${hex}${hex.slice(0, 4)}`
}

/** Build a sample GraphQL query for a field */
function buildSampleQuery(field: GraphQLField, operationType: GraphQLOperationType): string {
  const argsStr = field.args.length > 0
    ? `(${field.args.map(a => `${a.name}: ${getSampleValue(a.type)}`).join(', ')})`
    : ''
  
  const operationName = operationType === 'query' ? 'query' : operationType
  
  return `${operationName} {
  ${field.name}${argsStr} {
    # Add fields here
  }
}`
}

/** Get a sample value for a GraphQL type */
function getSampleValue(type: string): string {
  const baseType = type.replace(/[![\]]/g, '').trim()
  
  switch (baseType) {
    case 'ID':
    case 'String':
      return '"example"'
    case 'Int':
      return '1'
    case 'Float':
      return '1.0'
    case 'Boolean':
      return 'true'
    default:
      return '""'
  }
}

/** Convert a GraphQL field to a GraphQLRequest */
function fieldToRequest(
  field: GraphQLField,
  operationType: GraphQLOperationType,
  baseUrl: string,
  collectionName: string
): GraphQLRequest {
  const query = buildSampleQuery(field, operationType)
  
  const request: GraphQLRequest = {
    type: 'graphql',
    id: generateId(`${collectionName}:graphql:${operationType}:${field.name}`),
    name: field.name,
    documentation: '',
    tags: [operationType],
    url: baseUrl,
    operationType,
    query,
    headers: [
      createTypedKeyValue({ key: 'Content-Type', value: 'application/json', enabled: true })
    ]
  }
  
  if (field.args.length > 0) {
    request.variables = JSON.stringify({}, null, 2)
  }
  
  return request
}

// ============================================================================
// Main Service
// ============================================================================

export interface GraphQLImportOptions {
  /** Base URL for GraphQL endpoint */
  baseUrl?: string
  /** Name for the imported collection */
  name?: string
  /** Original URL the GraphQL schema was fetched from (stored on ApiDocumentation.sourceUrl). */
  sourceUrl?: string
}

/**
 * Import a GraphQL SDL schema and convert it to a Folder structure
 */
export function importGraphQL(schemaString: string, options: GraphQLImportOptions = {}): EnvironmentFolder {
  const baseUrl = options.baseUrl ?? '{{baseUrl}}'
  const name = options.name ?? (options.baseUrl ? 'GraphQL API' : 'GraphQL API')
  
  const schema = parseGraphQLSchema(schemaString)
  
  // Create folders for queries, mutations, subscriptions
  const items: Folder['items'] = []
  
  if (schema.queries.length > 0) {
    const queriesFolder: Folder = {
      id: generateId(`${name}:folder:graphql:queries`),
      name: 'Queries',
      documentation: '',
      tags: ['query'],
      configuration: {},
      items: schema.queries.map(field => fieldToRequest(field, 'query', baseUrl, name))
    }
    items.push(queriesFolder)
  }

  if (schema.mutations.length > 0) {
    const mutationsFolder: Folder = {
      id: generateId(`${name}:folder:graphql:mutations`),
      name: 'Mutations',
      documentation: '',
      tags: ['mutation'],
      configuration: {},
      items: schema.mutations.map(field => fieldToRequest(field, 'mutation', baseUrl, name))
    }
    items.push(mutationsFolder)
  }

  if (schema.subscriptions.length > 0) {
    const subscriptionsFolder: Folder = {
      id: generateId(`${name}:folder:graphql:subscriptions`),
      name: 'Subscriptions',
      documentation: '',
      tags: ['subscription'],
      configuration: {},
      items: schema.subscriptions.map(field => fieldToRequest(field, 'subscription', baseUrl, name))
    }
    items.push(subscriptionsFolder)
  }

  const environment: Environment = {
    id: generateId(`${name}:env:graphql:Default`),
    name: 'Default',
    variables: [
      createTypedKeyValue({ key: 'baseUrl', value: options.baseUrl ?? 'http://localhost:4000', enabled: true })
    ]
  }

  const apiDocumentation = graphqlToApiDocumentation(schema, {
    name,
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.sourceUrl !== undefined ? { sourceUrl: options.sourceUrl } : {})
  })

  // Extract enum definitions from parsed schema
  const enumDefinitions: EnumDefinition[] = schema.enums.map((e) => ({
    id: generateId(`enum:graphql:${e.name}`),
    name: e.name,
    values: e.values,
    matchingRules: []
  }))

  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    id: generateId(`${name}:folder:graphql:root`),
    name,
    documentation: '',
    tags: [],
    configuration: {},
    environments: [environment],
    items,
    apiDocumentation,
    ...(enumDefinitions.length > 0 ? { enumDefinitions } : {})
  }

  return rootFolder
}

/**
 * Import a GraphQL schema from a file content string
 */
export function importGraphQLFromString(content: string, options: GraphQLImportOptions = {}): EnvironmentFolder {
  return importGraphQL(content, options)
}
