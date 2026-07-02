import type { EnvironmentFolder } from '../../../shared/models'

/**
 * Every import format exposes this interface so the registry can dispatch
 * detection and parsing without knowing about any specific format.
 *
 * Adding a new import format requires:
 *   1. A `<Format>ImportService.ts` that implements `canImport` + exports a
 *      `parse`-compatible function and calls `importProviders.push(...)`.
 *   2. One `importProviders.push(...)` line at the bottom of that file.
 *   3. One side-effect import line in `providers.ts`.
 *
 * Zero changes to `ImportManager.ts` or any shared type file are needed per
 * new format once this foundation is in place.
 */
export interface ImportProvider {
  /** Stable string id used for dropdowns, format tracking, and error messages. */
  readonly format: string
  /**
   * Cheap content sniff — must never parse the whole document.
   * Return `true` only when this provider is confident it can handle
   * the content; return `false` if unsure (the registry tries the next
   * provider).
   *
   * `parsed` is a best-effort `JSON.parse(content)` result the registry
   * computes ONCE per detection pass and hands to every provider, so a
   * JSON-format provider's sniff doesn't re-parse the same payload once per
   * candidate. It's `undefined` when `content` isn't valid JSON (or wasn't
   * parsed at all, e.g. the extension-anchored probe in `detectFormat` that
   * calls `canImport('', filePath)`). A JSON-format provider should read
   * `parsed` when present and fall back to parsing `content` itself
   * otherwise — the fallback keeps direct/unit-test calls (which don't pass
   * a third argument) behaviour-identical. Text/XML-format providers ignore
   * this parameter entirely.
   */
  canImport(content: string, filePath?: string, parsed?: unknown): boolean
  /**
   * Full parse → EnvironmentFolder. Called only after `canImport` returned
   * true. `opts.filePath` carries the real on-disk path for file-based
   * imports (unset for URL imports) — most adapters are self-contained and
   * ignore it, but a format whose own compiler needs disk locality to
   * resolve ITS imports (e.g. a sibling format's compiler resolving a
   * relative `import` via Node module resolution from the file's
   * directory) needs the real path, not just the extracted `content`
   * string. TypeSpec's importer also reads `opts.filePath`, but only to
   * gate its file-based-only scope decision (paste/URL rejected) — it
   * deliberately does NOT compile at that real path; see
   * `TypeSpecImportService.ts`'s Trust model note for why.
   */
  parse(content: string, opts: { sourceUrl?: string; filePath?: string }): EnvironmentFolder
}

/**
 * Append-only registry. Each `*ImportService.ts` pushes its provider here at
 * module load time (via the side-effect import in `providers.ts`). Detection
 * order follows registration order — push order matches the priority in which
 * formats should be tried.
 *
 * Never splice, sort, or replace entries — the order is intentional and new
 * importers simply push to the end.
 */
export const importProviders: ImportProvider[] = []
