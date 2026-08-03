// @vitest-environment node
/**
 * The About dialog ships every line of its copy through `t('about.*')`. A key
 * missing from a locale silently falls back to English, and a key present but
 * still holding the English string is invisible to any "missing key" check —
 * the dialog just renders English next to translated neighbours. These tests
 * pin both halves: every key in every locale, and nothing left at its English
 * value unless the language genuinely uses that word.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const LOCALES_DIR = join(__dirname, '..', '..', 'src', 'renderer', 'locales')

/**
 * Keys whose English wording IS the word that language uses — `Website` is the
 * German and Dutch term, `Documentation` the French one, and `Version` is
 * spelled identically in Danish, German and Swedish.
 */
const KEEPS_ENGLISH_WORD: Record<string, string[]> = {
  da: ['version'],
  de: ['version', 'links.website'],
  fr: ['version', 'links.documentation'],
  nl: ['links.website'],
  sv: ['version']
}

type AboutSection = Record<string, unknown>

function aboutSection(locale: string): AboutSection {
  const raw = readFileSync(join(LOCALES_DIR, locale, 'translation.json'), 'utf-8')
  const parsed = JSON.parse(raw) as { about?: AboutSection }
  const about = parsed.about
  expect(about, `${locale} has no "about" section`).toBeDefined()
  return about ?? {}
}

/** Flattens the nested section into dotted key → string pairs. */
function flatten(section: AboutSection, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(section)) {
    if (typeof value === 'string') {
      out[`${prefix}${key}`] = value
    } else if (value !== null && typeof value === 'object') {
      Object.assign(out, flatten(value as AboutSection, `${prefix}${key}.`))
    }
  }
  return out
}

const locales = readdirSync(LOCALES_DIR).sort()
const english = flatten(aboutSection('en'))

describe('About dialog localization', () => {
  it('covers the whole shipped locale set', () => {
    expect(locales.length).toBe(27)
  })

  it.each(locales)('%s carries every About key', (locale) => {
    const entries = flatten(aboutSection(locale))
    expect(Object.keys(entries).sort()).toEqual(Object.keys(english).sort())
    for (const [key, value] of Object.entries(entries)) {
      expect(value.trim().length, `${locale}.${key} is empty`).toBeGreaterThan(0)
    }
  })

  it.each(locales)('%s is really translated, not an English placeholder', (locale) => {
    if (locale === 'en') return
    const entries = flatten(aboutSection(locale))
    const allowed = KEEPS_ENGLISH_WORD[locale] ?? []
    const untranslated = Object.keys(entries).filter(
      (key) => entries[key] === english[key] && !allowed.includes(key)
    )
    expect(untranslated).toEqual([])
  })

  it.each(locales)('%s keeps the version interpolation placeholder', (locale) => {
    expect(flatten(aboutSection(locale))['version']).toContain('{{version}}')
  })

  it.each(locales)('%s translates the trademark sentence away from French', (locale) => {
    if (locale === 'fr') return
    const trademark = flatten(aboutSection(locale))['legal.trademark']
    expect(trademark).not.toBe(flatten(aboutSection('fr'))['legal.trademark'])
    // The registered mark and the filing authority are proper nouns and stay.
    expect(trademark).toContain('Restorm®')
    expect(trademark).toContain('INPI')
  })

  it.each(locales)('%s keeps the publisher and the year in the copyright line', (locale) => {
    const copyright = flatten(aboutSection(locale))['legal.copyright']
    expect(copyright).toContain('© 2026')
    expect(copyright).toContain('Monsieur Dev')
  })
})
