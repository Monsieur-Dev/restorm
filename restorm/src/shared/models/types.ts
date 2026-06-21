/**
 * Shared types for Restorm models
 */

import type { RuntimeId } from 'electron-core-ui/types'

// Re-export RuntimeId for consumers
export type { RuntimeId }

/**
 * Type of icon (emoji character, codicon name, library icons, or no icon).
 */
export type IconType = 'emoji' | 'codicon' | 'iconoir' | 'phosphor' | 'material' | 'simpleicons' | 'feather' | 'fontawesome' | 'none'

/**
 * Represents an icon that can be an emoji, codicon, or an icon from supported libraries.
 */
export interface Icon {
  /** The type of icon */
  type: IconType
  /** The icon value - emoji character for 'emoji', icon name for library icons, empty for 'none' */
  value: string
}

/** HTTP methods */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export type HTTPMethod = (typeof HTTP_METHODS)[number]

/** GraphQL operation type */
export const GRAPHQL_OPERATION_TYPES = ['query', 'mutation', 'subscription'] as const
export type GraphQLOperationType = (typeof GRAPHQL_OPERATION_TYPES)[number]

/** gRPC call type */
export const GRPC_CALL_TYPES = ['unary', 'serverStreaming', 'clientStreaming', 'bidirectional'] as const
export type GrpcCallType = (typeof GRPC_CALL_TYPES)[number]

/** WebSocket protocol type */
export const WEBSOCKET_PROTOCOLS = ['websocket', 'socketio', 'mqtt'] as const
export type WebSocketProtocol = (typeof WEBSOCKET_PROTOCOLS)[number]

/** Request type discriminator */
export const REQUEST_TYPES = ['http', 'graphql', 'grpc', 'soap', 'websocket', 'odata', 'auth'] as const
export type RequestType = (typeof REQUEST_TYPES)[number]

/** OData protocol version. The type keeps all three versions so the
 * persisted shape is stable across phases; the execution engine only
 * branches on them when a subsequent PR wires the v2/v3 differences
 * (`d.results` wrapper, `$inlinecount` query option, etc.). Phase 1
 * treats every `odataVersion` as v4. */
export const ODATA_VERSIONS = ['v2', 'v3', 'v4'] as const
export type ODataVersion = (typeof ODATA_VERSIONS)[number]

/**
 * HTTP request body type discriminator. These are the canonical
 * on-the-wire / on-disk spellings — kebab-case for the multi-word
 * members so a `body.type` round-trips through persistence, the
 * execution engine, and the UI without any spelling translation.
 */
export const HTTP_BODY_TYPES = ['text', 'file', 'form-data', 'x-www-form-urlencoded'] as const
export type HTTPBodyType = (typeof HTTP_BODY_TYPES)[number]

/**
 * GraphQL enum member names for {@link HTTP_BODY_TYPES}. GraphQL enum
 * values must be valid identifiers, so the kebab-case wire spellings
 * cannot be enum members verbatim; these are the SCREAMING_SNAKE_CASE
 * names that map 1:1 (same order) onto the canonical kebab values.
 */
export const HTTP_BODY_TYPE_ENUM_NAMES = ['TEXT', 'FILE', 'FORM_DATA', 'X_WWW_FORM_URLENCODED'] as const

/** Folder type discriminator */
export type FolderType = 'standard' | 'environment'

/** Folder configuration (currently empty, environments moved to EnvironmentFolder) */
export type FolderConfiguration = Record<string, never>

/**
 * Base interface for items that can be contained in folders.
 * Used to avoid circular dependencies between Folder and Request classes.
 */
export interface BaseFolderItem {
  id: RuntimeId
  name: string
  toPlainObject(): Record<string, unknown>
}
