import type { RuntimeId, Icon, ImportSourceType } from '../baseTypes'

/**
 * Identifies a request that came from a parsed API spec, so the
 * idempotent re-import / refresh pipeline can match the local copy
 * back to its source operation across re-imports. `operationId` is
 * the preferred match key (it's what the Swagger / GraphQL author
 * controls); `naturalKey` is the deterministic fallback derived from
 * the operation's intrinsic identity (e.g. `GET /pets/{id}` for
 * Swagger, `query getPet` for GraphQL). Both are stored so a rename
 * of either side doesn't lose the link.
 *
 * Requests created by the user manually carry no `importOrigin`, and
 * the pipeline leaves them strictly alone — they are never marked
 * deprecated / removed, never auto-merged with spec changes.
 */
export interface ImportOrigin {
  format: ImportSourceType
  operationId?: string
  naturalKey: string
}

export interface BaseRequest {
  id: RuntimeId
  name: string
  icon?: Icon
  notes?: string
  tags: string[]
  /** When set, the execution engine resolves this id to an
   * `AuthenticationRequest` stored elsewhere in the collection and
   * injects its produced headers into this request before dispatch. */
  authenticationRequestId?: RuntimeId
  /**
   * When the request was materialised by an import, the link back to
   * its source operation. Absent on user-created requests — the
   * idempotent refresh flow uses absence as the "do not touch this"
   * signal.
   */
  importOrigin?: ImportOrigin
  /**
   * `true` when the source spec marks the operation as deprecated, or
   * when an earlier deprecation has been carried forward across a
   * re-import. Surfaces in the sidebar as italics + a muted icon; the
   * request remains executable.
   */
  deprecated?: boolean
  /**
   * `true` when the operation no longer appears in the most recently
   * fetched spec. Surfaces in the sidebar as strikethrough + a muted
   * error icon; the request remains executable so users can keep
   * calling legacy endpoints during a migration window. Cleared back
   * to `false` (or removed) when the operation reappears in a later
   * spec version.
   */
  removed?: boolean
  /**
   * Serialise to a plain object (drops class identity / reactive
   * proxies). Present on the model-CLASS instances (every request class
   * implements it); OPTIONAL here because a request can also be a plain
   * deserialised object over IPC / from disk that has no methods —
   * callers must guard with `?.()` and fall back to the value itself.
   */
  toPlainObject?(): Record<string, unknown>
}
