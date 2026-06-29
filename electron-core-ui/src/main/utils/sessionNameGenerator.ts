import { uniqueNamesGenerator, adjectives, animals } from 'unique-names-generator'

/** Max random re-draws before falling back to a numeric suffix. */
const MAX_RETRIES = 5

/**
 * Generate a single random adjective-animal name, kebab-separated and
 * lower-case (e.g. `lucky-unicorn`, `brave-panda`). Exported for unit
 * testing and tooling; callers that need uniqueness guarantees should use
 * {@link generateUniqueSessionName} instead.
 */
export function generateSessionName(): string {
  return uniqueNamesGenerator({ dictionaries: [adjectives, animals], separator: '-', style: 'lowerCase' })
}

/**
 * Generate a session name guaranteed not to clash with any entry in
 * `existingNames`. Algorithm:
 *
 * 1. Draw up to {@link MAX_RETRIES} random names — return the first one
 *    that is not already taken.
 * 2. If all draws collide, fix the last drawn base and append `-2`, `-3`, …
 *    until a free slot is found (safe: the existing set is always finite).
 *
 * The optional `worktreeSuffix` is appended as `<name>@<suffix>` AFTER
 * collision resolution so the full composed name is what gets checked and
 * returned — useful in DEV to distinguish simultaneous worktrees.
 *
 * @param existingNames - names already in use, e.g. from `readAllInstancesIncludingCut`
 * @param worktreeSuffix - optional context label appended with `@` (DEV mode only)
 * @param _generateName - injectable generator; defaults to {@link generateSessionName} (override in tests)
 */
export function generateUniqueSessionName(
  existingNames: string[],
  worktreeSuffix?: string,
  _generateName: () => string = generateSessionName
): string {
  const existing = new Set(existingNames)
  const compose = (base: string): string => (worktreeSuffix !== undefined ? `${base}@${worktreeSuffix}` : base)

  let lastBase = _generateName()
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) lastBase = _generateName()
    const candidate = compose(lastBase)
    if (!existing.has(candidate)) return candidate
  }

  // All random draws collided — fix `lastBase` and increment a numeric suffix.
  let n = 2
  for (;;) {
    const candidate = compose(`${lastBase}-${String(n)}`)
    if (!existing.has(candidate)) return candidate
    n++
  }
}
