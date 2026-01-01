/**
 * @graphqlField Decorator
 * Marks a property as a GraphQL field with type information
 */

import { setPropertyMetadata, getPropertyMetadata, getAllPropertyMetadata, setClassMetadata, getClassMetadata } from './metadata'

// Add new metadata key
const GRAPHQL_FIELD_KEY = Symbol('graphqlField')
const GRAPHQL_TYPE_KEY = Symbol('graphqlType')

/**
 * Configuration for GraphQL field
 */
export interface GraphQLFieldConfig {
  /** GraphQL type name (e.g., 'String', 'Int', 'KeyValue') */
  type: string
  /** Whether the field can be null */
  nullable?: boolean
  /** Whether the field is an array */
  isArray?: boolean
  /** Description for GraphQL schema */
  description?: string
}

/**
 * Configuration for GraphQL type (class-level)
 */
export interface GraphQLTypeConfig {
  /** GraphQL type name (defaults to class name) */
  name?: string
  /** Description for GraphQL schema */
  description?: string
}

/**
 * Mark a class as a GraphQL type.
 * Optional - if not used, the class name will be used as the type name.
 */
export function graphqlType(config?: GraphQLTypeConfig): ClassDecorator {
  return (target: object) => {
    setClassMetadata(target, GRAPHQL_TYPE_KEY, {
      name: config?.name,
      description: config?.description
    })
  }
}

/**
 * Get GraphQL type config for a class
 */
export function getGraphQLTypeConfig(target: unknown): GraphQLTypeConfig | undefined {
  return getClassMetadata(target, GRAPHQL_TYPE_KEY) as GraphQLTypeConfig | undefined
}

/**
 * Mark a property as a GraphQL field.
 */
export function graphqlField(config: GraphQLFieldConfig): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    setPropertyMetadata(target.constructor, propertyKey, GRAPHQL_FIELD_KEY, {
      type: config.type,
      nullable: config.nullable ?? false,
      isArray: config.isArray ?? false,
      description: config.description
    })
  }
}

/**
 * Check if a property is a GraphQL field
 */
export function isGraphQLField(target: unknown, propertyKey: string | symbol): boolean {
  return getPropertyMetadata(target, propertyKey, GRAPHQL_FIELD_KEY) !== undefined
}

/**
 * Get GraphQL field config for a property
 */
export function getGraphQLFieldConfig(target: unknown, propertyKey: string | symbol): GraphQLFieldConfig | undefined {
  return getPropertyMetadata(target, propertyKey, GRAPHQL_FIELD_KEY) as GraphQLFieldConfig | undefined
}

/**
 * Get all GraphQL fields for a class
 */
export function getGraphQLFields(target: unknown): Map<string | symbol, GraphQLFieldConfig> {
  return getAllPropertyMetadata(target, GRAPHQL_FIELD_KEY) as Map<string | symbol, GraphQLFieldConfig>
}
