import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * The Serbian locale ships in Gaj LATIN, and every value in it must be.
 *
 * Serbian is written in both scripts, so a Cyrillic value here is not a
 * broken string: it renders, it says the right thing, and it satisfies
 * every check this repo has. `check-i18n` compares key PARITY across
 * locales — a value in the wrong script has every key it should have, so
 * the guard stays green while one locale shows two alphabets in the same
 * settings panel. Nothing else looks at scripts.
 *
 * It arrived through a union rather than a diff: one change normalised
 * this file to Latin, another translated three new keys into Cyrillic,
 * and neither was wrong on its own. Only the merge of the two is.
 *
 * SCOPE — restorm's `sr` file only, and deliberately so.
 * `electron-core-ui`'s locales, INCLUDING its own `sr`, legitimately
 * contain Cyrillic: the language picker names every language in its own
 * script, so `"uk": "Українська"` appears byte-identically in all of them
 * by design. Extending this assertion to ECUI would fail on a correct
 * value, and a guard that fires on correct data is one the next person
 * weakens or deletes.
 */

const SERBIAN_LOCALE = join(__dirname, '..', '..', 'src', 'renderer', 'locales', 'sr', 'translation.json')

/** Cyrillic and its supplement — the range Serbian Cyrillic lives in. */
const CYRILLIC = /[Ѐ-ԯ]/

function cyrillicValues(node: unknown, path: string, found: string[]): void {
  if (typeof node === 'string') {
    if (CYRILLIC.test(node)) found.push(`${path} = ${node}`)
    return
  }
  if (node === null || typeof node !== 'object') return
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    cyrillicValues(value, path ? `${path}.${key}` : key, found)
  }
}

describe('the Serbian locale is written in Latin', () => {
  const parsed: unknown = JSON.parse(readFileSync(SERBIAN_LOCALE, 'utf-8'))

  it('reads the locale', () => {
    expect(parsed).toBeTypeOf('object')
    expect(Object.keys(parsed as Record<string, unknown>).length).toBeGreaterThan(0)
  })

  it('has no Cyrillic in any value', () => {
    const offenders: string[] = []
    cyrillicValues(parsed, '', offenders)
    expect(
      offenders,
      'these values are Serbian Cyrillic in a Latin locale — transliterate them (Cyrillic to Latin needs no digraph lookahead: њ is always nj), and keep the register of the surrounding values'
    ).toEqual([])
  })
})
