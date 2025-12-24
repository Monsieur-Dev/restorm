/**
 * Document Events - Event types and payloads for document changes
 *
 * Used by SearchIndexService and other services to react to document changes.
 */

/** Base payload for document events */
export interface DocumentEventPayload {
  /** Document ID */
  id: string
  /** Document type */
  type: 'folder' | 'request'
}

/** Payload for document created/updated events */
export interface DocumentChangedPayload extends DocumentEventPayload {
  /** The document data */
  document: unknown
  /** Parent folder ID (for requests) */
  parentFolderId?: string
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
  REQUEST_DELETED: 'document:request:deleted'
} as const

export type DocumentEventName = (typeof DocumentEvents)[keyof typeof DocumentEvents]
