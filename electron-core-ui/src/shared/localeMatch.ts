/**
 * Regions that imply a script, so a region-qualified tag and a
 * script-qualified one can be compared. BCP-47 lets a locale name its
 * script (`zh-Hant`), its region (`zh-HK`), both (`zh-Hant-HK`) or neither
 * (`zh`), and an OS is free to report any of those forms — without this
 * mapping `zh-HK` shares no subtag with a shipped `zh-TW` and would lose to
 * `zh-CN`, i.e. a Traditional-Chinese user would get Simplified.
 */
const SCRIPT_BY_REGION: Readonly<Record<string, string>> = {
  cn: 'hans',
  sg: 'hans',
  tw: 'hant',
  hk: 'hant',
  mo: 'hant'
}

/**
 * Match a list of candidate BCP-47 locale tags (e.g. the OS/browser locale
 * and its fallbacks, most-preferred first) against a list of supported
 * language codes, returning the supported code that fits best.
 *
 * Candidate order dominates: the list is the user's stated preference, so
 * the first candidate that matches anything wins, even approximately.
 * (`['fr-CA', 'de']` must resolve to a shipped `fr` — someone asking for
 * Canadian French ahead of German does not want German just because we
 * happen to ship that tag verbatim.) Within a single candidate, three
 * passes run from most to least precise:
 *
 * 1. Exact tag match, case-insensitive — so `zh-cn` matches the shipped
 *    `zh-CN` entry without the caller having to know our casing convention.
 * 2. Base-language match against a bare (subtag-less) supported code —
 *    `fr-FR` / `fr_FR` matches a shipped `fr`.
 * 3. Best subtag overlap among the supported codes sharing the candidate's
 *    base language, comparing script and region on equal footing (see
 *    {@link SCRIPT_BY_REGION}): `zh-HK` and `zh-Hant` both resolve to
 *    `zh-TW`, `zh-Hans-CN` to `zh-CN`. A candidate that names nothing but
 *    its base language (a bare `zh`) has nothing to discriminate on and
 *    takes the first shipped variant of that language, which is the
 *    conventional reading of an unqualified macro-language tag.
 *
 * Returns `fallback` when no candidate matches any supported code.
 */
export function matchSupportedLocale(
  candidates: readonly string[],
  supported: readonly string[],
  fallback: string
): string {
  const present = candidates.filter((candidate) => Boolean(candidate))

  const supportedByExactTag = new Map(supported.map((code) => [code.toLowerCase(), code]))
  const supportedByBaseLanguage = new Map(
    supported
      .filter((code) => baseLanguage(code) === code.toLowerCase())
      .map((code) => [code.toLowerCase(), code])
  )

  for (const candidate of present) {
    const exactMatch = supportedByExactTag.get(candidate.toLowerCase())
    if (exactMatch) {
      return exactMatch
    }

    const baseMatch = supportedByBaseLanguage.get(baseLanguage(candidate))
    if (baseMatch) {
      return baseMatch
    }

    const overlapMatch = bestSubtagOverlap(candidate, supported)
    if (overlapMatch) {
      return overlapMatch
    }
  }

  return fallback
}

/**
 * Among the supported codes sharing `candidate`'s base language, pick the
 * one with the most qualifying subtags (script/region, base language
 * excluded) in common. Returns undefined when no supported code shares the
 * base language.
 */
function bestSubtagOverlap(candidate: string, supported: readonly string[]): string | undefined {
  const base = baseLanguage(candidate)
  const candidateSubtags = qualifyingSubtags(candidate)

  let best: string | undefined
  let bestScore = -1

  for (const code of supported) {
    if (baseLanguage(code) !== base) {
      continue
    }
    const score = [...qualifyingSubtags(code)].filter((subtag) => candidateSubtags.has(subtag)).length
    if (score > bestScore) {
      bestScore = score
      best = code
    }
  }

  return best
}

/**
 * Everything in `tag` that discriminates between variants of the same
 * language, with each region also contributing the script it implies so
 * that `zh-HK` and `zh-Hant` overlap.
 */
function qualifyingSubtags(tag: string): Set<string> {
  const subtags = tag.toLowerCase().split(/[-_]/).slice(1)
  const qualifying = new Set(subtags)

  for (const subtag of subtags) {
    const impliedScript = SCRIPT_BY_REGION[subtag]
    if (impliedScript) {
      qualifying.add(impliedScript)
    }
  }

  return qualifying
}

function baseLanguage(tag: string): string {
  return (tag.split(/[-_]/)[0] ?? tag).toLowerCase()
}
