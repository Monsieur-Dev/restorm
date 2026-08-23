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
  /** Parent environment ID (for sub-environments) — lets the save-unit bridge
   * redirect a deleted sub-env onto its top-level environment's unit. */
  parentEnvironmentId?: string
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
  REQUEST_HISTORY_OPEN: 'request:history:open',
  /**
   * Request to set the active environment for a specific request.
   * Every mounted provider matching the request id picks it up and
   * applies the change locally.
   */
  REQUEST_ENV_SET: 'request:env:set',
  /**
   * Broadcast that an env folder's default environment has changed.
   * Every mounted `EnvironmentProvider` whose `envFolderId` matches
   * re-resolves its active env (override → folder default → first
   * env). Emitted by the status-bar picker when the "Apply to all"
   * checkbox is ticked.
   */
  ENV_FOLDER_ENV_CHANGED: 'env-folder:env:changed',
  /**
   * A request started / finished executing. Drives the running beam on the
   * request's sidebar badge (and replaces the in-tab progress bar). Emitted by
   * `BaseRequestTabView` whenever its `isLoading` flips; consumed by
   * `requestExecutingStore`.
   */
  REQUEST_EXECUTION_STARTED: 'request:execution:started',
  REQUEST_EXECUTION_ENDED: 'request:execution:ended',
  /**
   * The per-environment cookie jar changed — a response captured a Set-Cookie,
   * or a jar was edited/cleared. The main process broadcasts it after any jar
   * mutation; the Cookie jar tab and per-request Cookies tabs re-read their
   * list so an open view follows a live capture without polling.
   */
  COOKIES_CHANGED: 'cookies:changed'
} as const

export type DocumentEventName = (typeof DocumentEvents)[keyof typeof DocumentEvents]

/** Payload for `REQUEST_HISTORY_RECORDED` and `REQUEST_HISTORY_OPEN`. */
export interface RequestHistoryEventPayload {
  /** Request id the history entry belongs to (or is requested for). */
  requestId: string
}

/** Payload for `REQUEST_ENV_SET`. */
export interface RequestEnvEventPayload {
  requestId: string
  envId: string | null
}

/** Payload for `ENV_FOLDER_ENV_CHANGED`. */
export interface EnvFolderEnvEventPayload {
  projectUuid: string
  envFolderId: string
  envId: string
}
