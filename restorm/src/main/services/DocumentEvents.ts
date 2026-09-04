/**
 * Document Events - Event types and payloads for document changes (Main Process)
 *
 * Used by SearchIndexService and other services to react to document changes.
 */

/** Event source - indicates where the change originated */
export type EventSource = 'user' | 'remote' | 'file-load' | 'graphql'

/** Base payload for document events */
export interface DocumentEventPayload {
  /** Document ID */
  id: string
  /** Document type */
  type: 'folder' | 'request' | 'environment' | 'design'
  /** Event source - where the change originated (default: 'user') */
  source?: EventSource
}

/** Payload for document created/updated events */
export interface DocumentChangedPayload extends DocumentEventPayload {
  /** The document data */
  document: unknown
  /** Parent folder ID (for requests) */
  parentFolderId?: string
  /** Parent environment ID (for sub-environments) */
  parentEnvironmentId?: string
}

/** Payload for document deleted events */
export interface DocumentDeletedPayload extends DocumentEventPayload {
  /** Parent folder ID (for requests) */
  parentFolderId?: string
}

/** Document event names */
export const DocumentEvents = {
  FOLDER_CREATED: 'document:folder:created',
  FOLDER_UPDATED: 'document:folder:updated',
  FOLDER_DELETED: 'document:folder:deleted',
  REQUEST_CREATED: 'document:request:created',
  REQUEST_UPDATED: 'document:request:updated',
  REQUEST_DELETED: 'document:request:deleted',
  ENVIRONMENT_CREATED: 'document:environment:created',
  ENVIRONMENT_UPDATED: 'document:environment:updated',
  ENVIRONMENT_DELETED: 'document:environment:deleted',
  DESIGN_CREATED: 'document:design:created',
  DESIGN_UPDATED: 'document:design:updated',
  DESIGN_DELETED: 'document:design:deleted'
} as const

export type DocumentEventName = (typeof DocumentEvents)[keyof typeof DocumentEvents]
