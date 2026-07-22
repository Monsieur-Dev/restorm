/**
 * A QuickConfig is a named snapshot of a request's own config fields,
 * MINUS identity (name / notes / tags / icon / id) and MINUS the auth
 * route. Loading it overwrites the request's live fields; saving it
 * captures them verbatim (no masking of credential values).
 *
 * Storage target:
 *   - 'project'  → persisted in the .restorm file (travels with the project)
 *   - 'settings' → persisted in user settings (userData/config.json; survives
 *                  project close/reopen but is user-local)
 */

export type QuickConfigStorageTarget = 'project' | 'settings'

export interface QuickConfig {
  /** Stable runtime id — stripped by prepareForSerialization for the project
   * target, regenerated on load; kept as-is for the user-settings target. */
  id: string
  /** Human-readable name. Unique within a (requestId, storageTarget) pair. */
  name: string
  /** Identifies which request owns this config (used as a lookup key). */
  requestId: string
  /** Where this config is persisted. */
  storageTarget: QuickConfigStorageTarget
  /**
   * The snapshot: every field of the request EXCEPT identity fields
   * (name / notes / tags / icon / id / importOrigin / deprecated / removed /
   * toPlainObject) and except authenticationRequestId. Captured verbatim —
   * {{}} references and literal values alike.
   */
  fields: Record<string, unknown>
}
