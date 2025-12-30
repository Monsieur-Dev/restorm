/**
 * GraphQL Schema Generator - Generates GraphQL schema from decorated classes
 *
 * This service reads decorator metadata from classes and generates:
 * - GraphQL type definitions
 * - Input types for mutations
 * - Query resolvers
 * - Mutation resolvers
 * - Subscription resolvers
 */

import {
  getSearchableProperties,
  getNonSerialisedProperties,
  getSeparateFilesProperties,
  getSeparateFoldersProperties,
  getFileNamingConfig
} from '../decorators'
import { logger } from './LoggerService'

// ============================================================================
// Types
// ============================================================================

/** GraphQL scalar type mapping */
type GraphQLScalarType = 'String' | 'Int' | 'Float' | 'Boolean' | 'ID' | 'JSON'

/** Field definition for schema generation */
interface FieldDefinition {
  name: string
  type: string
  nullable: boolean
  isArray: boolean
  description?: string
}

/** Schema generation configuration */
export interface SchemaGeneratorConfig {
  /** Include subscription types */
  includeSubscriptions?: boolean
  /** Custom scalar types */
  customScalars?: string[]
  /** Prefix for input types */
  inputPrefix?: string
  /** Suffix for input types */
  inputSuffix?: string
}

/** Registered class with its metadata */
interface RegisteredClass {
  constructor: new (...args: unknown[]) => unknown
  typeName: string
  fields: FieldDefinition[]
  isUnion?: boolean
  unionTypes?: string[]
}

// ============================================================================
// Schema Generator Class
// ============================================================================

/**
 * GraphQL Schema Generator
 * Generates GraphQL schema definitions from TypeScript classes with decorators
 */
class GraphQLSchemaGenerator {
  private registeredClasses = new Map<string, RegisteredClass>()
  private enumTypes = new Map<string, string[]>()
  private unionTypes = new Map<string, string[]>()
  private config: Required<SchemaGeneratorConfig> = {
    includeSubscriptions: true,
    customScalars: ['JSON'],
    inputPrefix: '',
    inputSuffix: 'Input'
  }

  /**
   * Configure the schema generator
   */
  configure(config: SchemaGeneratorConfig): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Register an enum type
   */
  registerEnum(name: string, values: string[]): void {
    this.enumTypes.set(name, values)
    logger.debug('[GraphQLSchemaGenerator] Registered enum', { name, values })
  }

  /**
   * Register a union type
   */
  registerUnion(name: string, types: string[]): void {
    this.unionTypes.set(name, types)
    logger.debug('[GraphQLSchemaGenerator] Registered union', { name, types })
  }

  /**
   * Register a class for schema generation
   */
  registerClass(
    constructor: new (...args: unknown[]) => unknown,
    typeName: string,
    fields: FieldDefinition[]
  ): void {
    const nonSerialised = getNonSerialisedProperties(constructor)
    const searchableProps = getSearchableProperties(constructor)
    const separateFilesProps = getSeparateFilesProperties(constructor)
    const separateFoldersProps = getSeparateFoldersProperties(constructor)
    const fileNamingConfig = getFileNamingConfig(constructor)

    // Filter out non-serialised fields
    const filteredFields = fields.filter(f => !nonSerialised.has(f.name))

    // Add searchable metadata to fields
    const enrichedFields = filteredFields.map(field => ({
      ...field,
      searchable: searchableProps.get(field.name),
      separateFiles: separateFilesProps.has(field.name),
      separateFolders: separateFoldersProps.has(field.name)
    }))

    this.registeredClasses.set(typeName, {
      constructor,
      typeName,
      fields: enrichedFields
    })

    logger.debug('[GraphQLSchemaGenerator] Registered class', {
      typeName,
      fieldCount: enrichedFields.length,
      hasFileNaming: !!fileNamingConfig
    })
  }

  /**
   * Generate the complete GraphQL schema
   */
  generateSchema(): string {
    const parts: string[] = []

    // Add scalar types
    if (this.config.customScalars.length > 0) {
      parts.push(this.generateScalars())
    }

    // Add enum types
    for (const [name, values] of this.enumTypes) {
      parts.push(this.generateEnumType(name, values))
    }

    // Add object types
    for (const [, registered] of this.registeredClasses) {
      parts.push(this.generateObjectType(registered))
    }

    // Add union types
    for (const [name, types] of this.unionTypes) {
      parts.push(this.generateUnionType(name, types))
    }

    // Add input types
    for (const [, registered] of this.registeredClasses) {
      parts.push(this.generateInputType(registered))
    }

    // Add Query type
    parts.push(this.generateQueryType())

    // Add Mutation type
    parts.push(this.generateMutationType())

    // Add Subscription type
    if (this.config.includeSubscriptions) {
      parts.push(this.generateSubscriptionType())
    }

    return parts.filter(Boolean).join('\n\n')
  }

  /**
   * Generate scalar definitions
   */
  private generateScalars(): string {
    return this.config.customScalars
      .map(scalar => `scalar ${scalar}`)
      .join('\n')
  }

  /**
   * Generate enum type definition
   */
  private generateEnumType(name: string, values: string[]): string {
    const enumValues = values.map(v => `  ${v}`).join('\n')
    return `enum ${name} {\n${enumValues}\n}`
  }

  /**
   * Generate union type definition
   */
  private generateUnionType(name: string, types: string[]): string {
    return `union ${name} = ${types.join(' | ')}`
  }

  /**
   * Generate object type definition
   */
  private generateObjectType(registered: RegisteredClass): string {
    const fields = registered.fields
      .map(f => this.formatField(f))
      .join('\n')

    return `type ${registered.typeName} {\n${fields}\n}`
  }

  /**
   * Generate input type definition
   */
  private generateInputType(registered: RegisteredClass): string {
    const inputName = `${this.config.inputPrefix}${registered.typeName}${this.config.inputSuffix}`

    // For input types, make ID optional and exclude read-only fields
    const fields = registered.fields
      .filter(f => f.name !== 'type') // Exclude discriminator fields
      .map(f => {
        const isIdField = f.name === 'id'
        return this.formatField({
          ...f,
          nullable: isIdField ? true : f.nullable
        })
      })
      .join('\n')

    return `input ${inputName} {\n${fields}\n}`
  }

  /**
   * Format a single field
   */
  private formatField(field: FieldDefinition): string {
    let type = field.type
    if (field.isArray) {
      type = `[${type}!]`
    }
    if (!field.nullable) {
      type = `${type}!`
    }
    const description = field.description ? `  # ${field.description}\n` : ''
    return `${description}  ${field.name}: ${type}`
  }

  /**
   * Generate Query type
   */
  private generateQueryType(): string {
    const queries: string[] = []

    for (const [, registered] of this.registeredClasses) {
      const typeName = registered.typeName
      const lowerName = typeName.charAt(0).toLowerCase() + typeName.slice(1)

      // Single item query
      queries.push(`  ${lowerName}(id: String!): ${typeName}`)

      // List query
      queries.push(`  ${lowerName}s: [${typeName}!]!`)
    }

    // Add search query
    queries.push(`  search(query: String!, limit: Int): [SearchResult!]!`)

    return `type Query {\n${queries.join('\n')}\n}`
  }

  /**
   * Generate Mutation type
   */
  private generateMutationType(): string {
    const mutations: string[] = []

    for (const [, registered] of this.registeredClasses) {
      const typeName = registered.typeName
      const inputName = `${this.config.inputPrefix}${typeName}${this.config.inputSuffix}`

      // Create mutation
      mutations.push(`  create${typeName}(parentId: String, input: ${inputName}!): ${typeName}!`)

      // Update mutation
      mutations.push(`  update${typeName}(id: String!, input: ${inputName}!): ${typeName}!`)

      // Delete mutation
      mutations.push(`  delete${typeName}(id: String!): Boolean!`)

      // Move mutation (for items that can be reordered)
      mutations.push(`  move${typeName}(id: String!, newParentId: String!, index: Int!): ${typeName}!`)
    }

    return `type Mutation {\n${mutations.join('\n')}\n}`
  }

  /**
   * Generate Subscription type
   */
  private generateSubscriptionType(): string {
    const subscriptions: string[] = []

    for (const [, registered] of this.registeredClasses) {
      const typeName = registered.typeName
      const lower = typeName.charAt(0).toLowerCase() + typeName.slice(1)

      // Created subscription
      subscriptions.push(`  ${lower}Created: ${typeName}!`)

      // Updated subscription
      subscriptions.push(`  ${lower}Updated: ${typeName}!`)

      // Deleted subscription
      subscriptions.push(`  ${lower}Deleted: String!`)
    }

    return `type Subscription {\n${subscriptions.join('\n')}\n}`
  }

  /**
   * Generate a SearchResult type
   */
  generateSearchResultType(): string {
    return `type SearchResult {
  id: String!
  type: String!
  name: String!
  score: Float!
  highlights: [String!]!
}`
  }

  /**
   * Clear all registered types
   */
  clear(): void {
    this.registeredClasses.clear()
    this.enumTypes.clear()
    this.unionTypes.clear()
  }
}

// Singleton instance
export const graphQLSchemaGenerator = new GraphQLSchemaGenerator()

/**
 * Helper function to infer GraphQL type from TypeScript type
 */
export function inferGraphQLType(value: unknown): GraphQLScalarType {
  if (typeof value === 'string') return 'String'
  if (typeof value === 'number') return Number.isInteger(value) ? 'Int' : 'Float'
  if (typeof value === 'boolean') return 'Boolean'
  return 'JSON'
}

/**
 * Create field definitions from a class prototype
 */
export function createFieldDefinitions(
  _prototype: object,
  fieldConfigs: Record<string, {
    type: string
    nullable?: boolean
    isArray?: boolean
    description?: string
  }>
): FieldDefinition[] {
  return Object.entries(fieldConfigs).map(([name, config]) => {
    const field: FieldDefinition = {
      name,
      type: config.type,
      nullable: config.nullable ?? false,
      isArray: config.isArray ?? false
    }
    if (config.description !== undefined) {
      field.description = config.description
    }
    return field
  })
}
