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
export const REQUEST_TYPES = ['http', 'graphql', 'grpc', 'soap', 'websocket'] as const
export type RequestType = (typeof REQUEST_TYPES)[number]

/** HTTP request body type discriminator */
export const HTTP_BODY_TYPES = ['text', 'file', 'formData', 'xWwwFormUrlEncoded'] as const
export type HTTPBodyType = (typeof HTTP_BODY_TYPES)[number]

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
