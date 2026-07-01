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
   */
  canImport(content: string, filePath?: string): boolean
  /** Full parse → EnvironmentFolder. Called only after `canImport` returned true. */
  parse(content: string, opts: { sourceUrl?: string }): EnvironmentFolder
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
