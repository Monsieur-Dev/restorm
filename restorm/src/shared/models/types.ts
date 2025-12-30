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
export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

/** GraphQL operation type */
export type GraphQLOperationType = 'query' | 'mutation' | 'subscription'

/** gRPC call type */
export type GrpcCallType = 'unary' | 'server-stream' | 'client-stream' | 'bidirectional-stream'

/** WebSocket protocol type */
export type WebSocketProtocol = 'websocket' | 'socketio' | 'mqtt'

/** Request type discriminator */
export type RequestType = 'http' | 'graphql' | 'grpc' | 'soap' | 'websocket'

/** HTTP request body type discriminator */
export type HTTPBodyType = 'text' | 'file' | 'form-data' | 'x-www-form-urlencoded'

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
