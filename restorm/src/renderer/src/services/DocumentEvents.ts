/**
 * Document Events - Event types and payloads for document changes
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
  type: 'folder' | 'request' | 'environment'
  /** Event source - where the change originated (default: 'user') */
  source?: EventSource
}

/** Payload for document created/updated events */
export interface DocumentChangedPayload extends DocumentEventPayload {
  /** The document data */
  document: unknown
  /** Parent folder ID (for requests) */
  parentFolderId?: string | undefined
  /** Parent environment ID (for sub-environments) */
  parentEnvironmentId?: string | undefined
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
  /**
   * Emitted right after a request completes and a new entry is pushed
   * to its response history. Consumers (e.g. the status-bar history
   * button) re-query `responseHistoryList` to refresh their
   * "has any history yet?" signal without polling.
   */
  REQUEST_HISTORY_RECORDED: 'request:history:recorded',
  /**
   * Request to open the response-history modal for a specific request.
   * Emitted by the status-bar history button; subscribed by each
   * mounted request tab so the matching one opens its own modal.
   */
  REQUEST_HISTORY_OPEN: 'request:history:open'
} as const

export type DocumentEventName = (typeof DocumentEvents)[keyof typeof DocumentEvents]

/** Payload for `REQUEST_HISTORY_RECORDED` and `REQUEST_HISTORY_OPEN`. */
export interface RequestHistoryEventPayload {
  /** Request id the history entry belongs to (or is requested for). */
  requestId: string
}
