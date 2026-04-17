import type { RuntimeId } from 'electron-core-ui/types'
import type { ValueType } from './valueTypes'

export type { RuntimeId }

export type IconType =
  | 'emoji'
  | 'codicon'
  | 'iconoir'
  | 'phosphor'
  | 'material'
  | 'simpleicons'
  | 'feather'
  | 'fontawesome'
  | 'none'

export interface Icon {
  type: IconType
  value: string
}

export interface KeyValue {
  id?: RuntimeId | undefined
  key: string
  value: ValueType
  description?: string | undefined
  enabled?: boolean | undefined
}

export interface Environment {
  id: RuntimeId
  name: string
  icon?: Icon
  color?: string
  variables: KeyValue[]
  subEnvironments?: Environment[]
}

export type FolderConfiguration = Record<string, never>

/** Identifies how an EnvironmentFolder was created. */
export type ImportSourceType =
  | 'swagger'
  | 'graphql'
  | 'grpc'
  | 'wsdl'
  | 'asyncapi'
  | 'postman'
  | 'insomnia'
  | 'bruno'
  | 'curl'
  | 'powershell'
  | 'url'

/**
 * Rule that matches an enum definition to request URLs/parameters.
 * When a request's URL matches `pathPattern`, the parameter named
 * `paramName` should use the owning EnumDefinition's allowed values.
 */
export interface EnumMatchingRule {
  /** Glob or regex-like pattern for the URL path (e.g. "/pet/findByStatus"). */
  pathPattern: string
  /** HTTP method filter (e.g. "get"). Empty string means any method. */
  method: string
  /** Name of the query/path parameter that uses this enum. */
  paramName: string
}

/**
 * A named set of allowed values for enum parameters.
 * Stored at the EnvironmentFolder level so all requests in the
 * folder can reference the same definition.
 */
export interface EnumDefinition {
  id: RuntimeId
  /** Display name (e.g. "PetStatus", derived from the Swagger schema key). */
  name: string
  /** The closed set of allowed string values. */
  values: string[]
  /** Rules that bind this enum to specific request URL + parameter combos. */
  matchingRules: EnumMatchingRule[]
}
