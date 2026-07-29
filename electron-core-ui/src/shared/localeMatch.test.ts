import { describe, it, expect } from 'vitest'
import { matchSupportedLocale } from './localeMatch'

const SUPPORTED = ['en', 'fr', 'de', 'zh-CN', 'zh-TW']

describe('matchSupportedLocale', () => {
  it('matches an exact supported tag', () => {
    expect(matchSupportedLocale(['fr'], SUPPORTED, 'en')).toBe('fr')
  })

  it('matches a region-qualified tag by base language', () => {
    expect(matchSupportedLocale(['fr-FR'], SUPPORTED, 'en')).toBe('fr')
  })

  it('matches an underscore-separated tag by base language', () => {
    expect(matchSupportedLocale(['de_DE'], SUPPORTED, 'en')).toBe('de')
  })

  it('is case-insensitive on the exact-tag pass', () => {
    expect(matchSupportedLocale(['zh-cn'], SUPPORTED, 'en')).toBe('zh-CN')
  })

  it('prefers an exact regional match over a base-language match', () => {
    // zh-TW should resolve to the Traditional variant, not fall through to
    // a base-language 'zh' match (which does not exist in SUPPORTED anyway,
    // but this pins the precedence for when it does).
    expect(matchSupportedLocale(['zh-TW'], SUPPORTED, 'en')).toBe('zh-TW')
  })

  it('resolves a bare macro-language onto the first shipped regional variant', () => {
    // Shipping English to a Chinese-locale user because we only ship the
    // regional codes would defeat the whole point; 'zh' unqualified reads
    // as Simplified, which is the first shipped variant here.
    expect(matchSupportedLocale(['zh'], SUPPORTED, 'en')).toBe('zh-CN')
  })

  it('resolves a script-qualified candidate onto the variant sharing the most subtags', () => {
    expect(matchSupportedLocale(['zh-Hant-TW'], SUPPORTED, 'en')).toBe('zh-TW')
    expect(matchSupportedLocale(['zh-Hans-CN'], SUPPORTED, 'en')).toBe('zh-CN')
  })

  it('resolves a region-only candidate through the script that region implies', () => {
    // Hong Kong and Macau write Traditional: matching them on the raw
    // subtags alone would score zero against both shipped variants and hand
    // a Traditional reader the Simplified build.
    expect(matchSupportedLocale(['zh-HK'], SUPPORTED, 'en')).toBe('zh-TW')
    expect(matchSupportedLocale(['zh-MO'], SUPPORTED, 'en')).toBe('zh-TW')
    expect(matchSupportedLocale(['zh-SG'], SUPPORTED, 'en')).toBe('zh-CN')
  })

  it('resolves a script-only candidate with no region at all', () => {
    expect(matchSupportedLocale(['zh-Hant'], SUPPORTED, 'en')).toBe('zh-TW')
    expect(matchSupportedLocale(['zh-Hans'], SUPPORTED, 'en')).toBe('zh-CN')
  })

  it('resolves the script form Chromium lists ahead of the regional one', () => {
    // A Hong Kong / Taiwan user's navigator.languages leads with the script
    // form; it must land on the same shipped variant the regional form
    // would, rather than approximating to the other script.
    expect(matchSupportedLocale(['zh-Hant', 'zh-TW', 'zh'], SUPPORTED, 'en')).toBe('zh-TW')
    expect(matchSupportedLocale(['zh-HK', 'zh-Hant', 'zh'], SUPPORTED, 'en')).toBe('zh-TW')
  })

  it('keeps candidate preference above match precision', () => {
    // The candidate list is a ranked preference, not a pool of equals: a
    // user asking for Canadian French ahead of German must not be handed
    // German just because that tag happens to be shipped verbatim.
    expect(matchSupportedLocale(['fr-CA', 'de'], SUPPORTED, 'en')).toBe('fr')
  })

  it('prefers a bare supported base language over a subtag-overlap match', () => {
    // 'fr-CA' must land on the shipped bare 'fr', never on some other
    // fr-* variant that happens to share a subtag.
    expect(matchSupportedLocale(['fr-CA'], [...SUPPORTED, 'fr-CA-x'], 'en')).toBe('fr')
  })

  it('does not cross base languages on the overlap pass', () => {
    // 'pt-BR' shares the 'br' subtag with nothing shipped and its base is
    // unsupported here, so it must fall back rather than borrow a match.
    expect(matchSupportedLocale(['pt-BR'], SUPPORTED, 'en')).toBe('en')
  })

  it('tries candidates in order and returns the first supported match', () => {
    expect(matchSupportedLocale(['ja-JP', 'fr-FR', 'en-US'], SUPPORTED, 'en')).toBe('fr')
  })

  it('falls back when no candidate matches any supported code', () => {
    expect(matchSupportedLocale(['ja-JP', 'ko-KR'], SUPPORTED, 'en')).toBe('en')
  })

  it('falls back on an empty candidate list', () => {
    expect(matchSupportedLocale([], SUPPORTED, 'en')).toBe('en')
  })

  it('skips empty-string candidates without matching them', () => {
    expect(matchSupportedLocale(['', 'de'], SUPPORTED, 'en')).toBe('de')
  })
})
