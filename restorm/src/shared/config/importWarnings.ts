/**
 * Machine-readable identities for the non-fatal problems an import can carry.
 *
 * A warning is NOT a failure: the import succeeded and produced a folder, but
 * something in the source could not be fully honoured — a spec with dangling
 * `$ref`s, a `requestBody` with no `content`, etc. The import wizard shows
 * these beside the successful preview so the user knows what was skipped and
 * why, instead of discovering a half-built tree with no explanation.
 *
 * Same split as `importErrors`: the sentence is ours and fully localised (the
 * renderer renders it from the `code`), while spec-local, untranslatable text
 * — the actual broken ref strings, operation paths — rides in the reserved
 * `detail` param and is shown verbatim in its own slot. Warnings only travel
 * on the structured `ImportResult`, never through a rejected IPC call, so
 * unlike errors they need no coded-message transport.
 */

/** Every non-fatal import problem the app can name. */
export const IMPORT_WARNING_CODES = [
  /** An OpenAPI spec imported, but parts of it are structurally broken —
   *  unresolved `$ref`s, a `requestBody` without `content`. Those pieces
   *  were skipped; the `detail` param names the specifics and `count` gives
   *  the total number of problems found. */
  'openApiStructuralIssues'
] as const

export type ImportWarningCode = typeof IMPORT_WARNING_CODES[number]

/** Parameters interpolated into the translated sentence. The `detail` key is
 * RESERVED for untranslatable upstream text, rendered in its own slot. */
export type ImportWarningParams = Record<string, string>

/** Parameter name reserved for raw, untranslatable upstream text. */
export const IMPORT_WARNING_DETAIL_PARAM = 'detail'

export interface ImportWarningDescriptor {
  code: ImportWarningCode
  params: ImportWarningParams
}
