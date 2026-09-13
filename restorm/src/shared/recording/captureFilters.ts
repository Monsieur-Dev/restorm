/**
 * White / black list semantics of a recording session, shared by the main
 * capture engine (live filtering) and the renderer (regex validation in
 * the config table).
 *
 * A url is KEPT when:
 * - the white list is empty OR the url matches at least one white entry
 *   (the white list is an OR), AND
 * - the url matches no black entry — the black list has the last word.
 *
 * Entries are regular-expression sources. An entry that does not compile
 * is ignored by the filter (and reported so the UI can flag it) rather
 * than blocking everything or letting everything through.
 */

export interface CompiledFilterList {
  regexes: RegExp[]
  /** Indexes (into the source list) of the entries that failed to compile. */
  invalid: number[]
}

export interface CompiledFilters {
  whitelist: CompiledFilterList
  blacklist: CompiledFilterList
}

export function compileFilterList(patterns: readonly string[]): CompiledFilterList {
  const regexes: RegExp[] = []
  const invalid: number[] = []
  patterns.forEach((pattern, index) => {
    const trimmed = pattern.trim()
    if (trimmed === '') return
    try {
      regexes.push(new RegExp(trimmed))
    } catch {
      invalid.push(index)
    }
  })
  return { regexes, invalid }
}

export function compileFilters(whitelist: readonly string[], blacklist: readonly string[]): CompiledFilters {
  return { whitelist: compileFilterList(whitelist), blacklist: compileFilterList(blacklist) }
}

/** `true` when a regex source compiles (the config table colours the others). */
export function isValidFilterPattern(pattern: string): boolean {
  if (pattern.trim() === '') return true
  try {
    new RegExp(pattern.trim())
    return true
  } catch {
    return false
  }
}

export function passesFilters(url: string, filters: CompiledFilters): boolean {
  const white = filters.whitelist.regexes
  if (white.length > 0 && !white.some((re) => re.test(url))) return false
  return !filters.blacklist.regexes.some((re) => re.test(url))
}
