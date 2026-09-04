/**
 * Cloud-hosted codegen templates — the shape returned by the `templates` Edge
 * Function and threaded from the main process to the renderer's code-generation
 * library. The official templates (curated centrally) and the caller org's own
 * (Enterprise) both use this row shape; which list a row is in is what tells the
 * two apart.
 */

export interface CloudTemplate {
  id: string
  /** The git repository holding the template (e.g. https://github.com/owner/repo). */
  url: string
  /** Free-text; also carries the human stack/type label shown in the library. */
  description: string | null
  /** Manual ordering within a list (lower first). */
  ordinal: number
}

/** The `list` response: the official set (every signed-in user) plus the caller
 * org's own (only when Enterprise). `orgName` titles the org tab. */
export interface CloudTemplatesView {
  orgName: string | null
  isEnterprise: boolean
  /** Whether the caller may add/remove the org's templates (admin or the
   * explicit `can_manage_templates` grant). The server still enforces it. */
  canManage: boolean
  official: CloudTemplate[]
  org: CloudTemplate[]
}
