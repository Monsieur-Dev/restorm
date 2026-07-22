#!/usr/bin/env node
/**
 * scripts/check-i18n.mjs
 *
 * Repo-wide i18n guard-rail — run at commit time (fast path, pure file I/O, ~<1 s).
 *
 * Two checks:
 *   1. Missing-from-en: a static t('key') call references a key absent from the
 *      base `en` locale. i18next can never resolve it; every locale falls back to
 *      the inline English default (or the raw key string if no default is given).
 *
 *   2. False-tick: a non-en/fr locale carries a value byte-identical to the en
 *      value for a key whose en value reads as English prose (≥3 ASCII words).
 *      The translator copied the source string instead of translating it.
 *
 * Allow-list (.i18n-allow-list.json at repo root, git-tracked):
 *   dynamic_key_patterns  — wildcard patterns (e.g. "scenario.help.*") for keys
 *                           derived from template-literal interpolations; exempt
 *                           from check 1 as long as en contains matching keys.
 *   false_tick_exceptions — exact dotted key paths that are legitimately identical
 *                           to the en value: proper nouns, syntax examples, codes,
 *                           or pre-existing translation debt being tracked elsewhere.
 *
 * Exit 0 = clean. Exit 1 = violations printed to stdout.
 *
 * Usage: node scripts/check-i18n.mjs
 */

import { readFileSync, readdirSync } from 'fs'
import { resolve, join, extname, relative } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

// ── Configuration ─────────────────────────────────────────────────────────────

/** Directories containing per-locale translation.json files. */
const LOCALE_DIRS = [
  join(ROOT, 'restorm/src/renderer/locales'),
  join(ROOT, 'electron-core-ui/src/renderer/locales'),
]

/** Source trees to scan for t() call sites. */
const SOURCE_ROOTS = [
  join(ROOT, 'restorm/src/renderer/src'),
  join(ROOT, 'electron-core-ui/src/renderer'),
]

/** Locale codes that are never checked (base locale + intentional exemptions). */
const EXEMPT_LOCALES = new Set(['en', 'fr', 'demo'])

/** Directory names to skip during source walks. */
const SKIP_DIRS = new Set(['node_modules', 'dist', '__snapshots__', 'locales'])

/** File extensions treated as source. */
const SOURCE_EXTS = new Set(['.ts', '.tsx'])

/** File-name suffixes that identify test files (excluded from scan). */
const TEST_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx']

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Yield all non-test source file paths under `dir`, skipping SKIP_DIRS. */
function* walkSource(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walkSource(full)
    } else if (
      SOURCE_EXTS.has(extname(entry.name)) &&
      !TEST_SUFFIXES.some((s) => entry.name.endsWith(s))
    ) {
      yield full
    }
  }
}

/** Flatten a nested JSON object to a dot-notation key → value map. */
function flatten(obj, prefix = '') {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key))
    } else {
      out[key] = String(v)
    }
  }
  return out
}

/** Load and flatten a locale's translation.json. Returns {} on missing/invalid. */
function loadLocale(localeDir, locale) {
  const file = join(localeDir, locale, 'translation.json')
  try {
    return flatten(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return {}
  }
}

/**
 * Precompute line-start byte offsets for `content` so lineOf() is O(log n).
 * lineStarts[i] = byte offset where line (i+1) begins.
 */
function buildLineIndex(content) {
  const starts = [0]
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') starts.push(i + 1)
  }
  return starts
}

/** Return the 1-based line number of byte offset `pos` using a pre-built index. */
function lineOf(lineStarts, pos) {
  let lo = 0, hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineStarts[mid] <= pos) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

/** Return true if `value` looks like English prose that should be translated.
 *  Criterion: ≥3 whitespace-separated tokens, every character in ASCII printable. */
function isEnglishProse(value) {
  return (
    value.split(/\s+/).filter(Boolean).length >= 3 &&
    /^[\x20-\x7E]+$/.test(value)
  )
}

/**
 * Return true if `key` matches any pattern in `patterns`.
 * Patterns support "*" as a wildcard for any sequence of characters.
 */
function matchesAny(key, patterns) {
  return patterns.some((p) => {
    const re = new RegExp(
      '^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*') + '$'
    )
    return re.test(key)
  })
}

// ── Regex patterns for t() call-site extraction ───────────────────────────────

// Static calls: t('some.key', …) or t("some.key", …)
// Captures the key string (group 2). Keys are dot-separated alphanumeric segments.
const STATIC_RE = /\bt\s*\(\s*(['"])([a-zA-Z0-9][a-zA-Z0-9_.]*)\1/g

// Dynamic template-literal calls: t(`prefix.${expr}`, …)
// Captures the static text before the first interpolation (group 1).
const DYNAMIC_RE = /\bt\s*\(\s*`([^`$]*)\$\{/g

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  // Load allow-list (missing file → all lists empty, not an error).
  let allowList = {
    dynamic_key_patterns: [],
    missing_from_en_exceptions: [],
    false_tick_exceptions: [],
  }
  try {
    allowList = JSON.parse(readFileSync(join(ROOT, '.i18n-allow-list.json'), 'utf8'))
  } catch {
    // no-op
  }
  const dynamicPatterns = allowList.dynamic_key_patterns ?? []
  const missingFromEnExceptions = new Set(allowList.missing_from_en_exceptions ?? [])
  const falseTickExceptions = new Set(allowList.false_tick_exceptions ?? [])

  // Load every locale for every locale dir.
  // Structure: localesData[localeDir][locale] = { key: value, … }
  const localesData = {}
  for (const localeDir of LOCALE_DIRS) {
    localesData[localeDir] = {}
    let entries
    try {
      entries = readdirSync(localeDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        localesData[localeDir][entry.name] = loadLocale(localeDir, entry.name)
      }
    }
  }

  // Build a combined en flat-map from both locale dirs.
  const enCombined = {}
  for (const [, locales] of Object.entries(localesData)) {
    Object.assign(enCombined, locales['en'] ?? {})
  }

  // ── Scan source files ───────────────────────────────────────────────────────
  const staticKeys = [] // { key, file, line }
  const dynamicPrefixes = [] // { prefix, file, line }

  for (const srcRoot of SOURCE_ROOTS) {
    for (const filePath of walkSource(srcRoot)) {
      const content = readFileSync(filePath, 'utf8')
      const relFile = relative(ROOT, filePath)
      const lineIdx = buildLineIndex(content)

      for (const m of content.matchAll(STATIC_RE)) {
        staticKeys.push({ key: m[2], file: relFile, line: lineOf(lineIdx, m.index) })
      }

      for (const m of content.matchAll(DYNAMIC_RE)) {
        // Strip trailing '.' so "scenario.help." → "scenario.help"
        const prefix = m[1].replace(/\.$/, '')
        if (prefix) {
          dynamicPrefixes.push({ prefix, file: relFile, line: lineOf(lineIdx, m.index) })
        }
      }
    }
  }

  // Deduplicate static entries (same key+file+line only once).
  const seenStatic = new Set()
  const uniqueStatic = staticKeys.filter(({ key, file, line }) => {
    const id = `${key}|${file}:${line}`
    if (seenStatic.has(id)) return false
    seenStatic.add(id)
    return true
  })

  // ── Check 1: missing from en ────────────────────────────────────────────────
  const missingFromEn = []

  // A pluralised key never appears under its bare name: i18next stores it
  // as `<key>_one` / `<key>_other` (plus `_zero`/`_two`/`_few`/`_many` for
  // the locales that need them) and resolves the suffix at call time from
  // `count`. Treating the bare name as absent would report a key that is
  // perfectly translated.
  const CLDR_PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other']
  const hasKey = (key) =>
    key in enCombined || CLDR_PLURAL_SUFFIXES.some((suffix) => `${key}_${suffix}` in enCombined)

  for (const { key, file, line } of uniqueStatic) {
    if (!hasKey(key) && !missingFromEnExceptions.has(key)) {
      missingFromEn.push({ key, file, line })
    }
  }

  // Dynamic prefixes: flag those with no matching en key AND not in the
  // dynamic_key_patterns allow-list (only report each unique prefix once).
  const seenDynPrefix = new Set()
  for (const { prefix, file, line } of dynamicPrefixes) {
    if (seenDynPrefix.has(prefix)) continue
    seenDynPrefix.add(prefix)

    const syntheticPattern = `${prefix}.*`
    if (matchesAny(syntheticPattern, dynamicPatterns)) continue

    // Prefix is valid if en has at least one key that starts with "<prefix>."
    const hasEnMatch = Object.keys(enCombined).some(
      (k) => k === prefix || k.startsWith(`${prefix}.`)
    )
    if (!hasEnMatch) {
      missingFromEn.push({ key: `${prefix}.* [dynamic template]`, file, line })
    }
  }

  // ── Check 2: false-tick translations ───────────────────────────────────────
  // Collect unique keys referenced in source that exist in en with prose values.
  const proseKeys = new Map() // key → en value
  for (const { key } of uniqueStatic) {
    if (
      key in enCombined &&
      isEnglishProse(enCombined[key]) &&
      !falseTickExceptions.has(key)
    ) {
      proseKeys.set(key, enCombined[key])
    }
  }

  // For each prose key, find which non-en/fr locales carry the exact en value.
  const falseTickMap = new Map() // key → Set<locale>
  for (const [localeDir, locales] of Object.entries(localesData)) {
    for (const [locale, flat] of Object.entries(locales)) {
      if (EXEMPT_LOCALES.has(locale)) continue
      for (const [key, enVal] of proseKeys) {
        if (flat[key] === enVal) {
          if (!falseTickMap.has(key)) falseTickMap.set(key, new Set())
          falseTickMap.get(key).add(locale)
        }
      }
    }
  }

  const falseTicks = [...falseTickMap.entries()]
    .map(([key, localeSet]) => ({
      key,
      locales: [...localeSet].sort(),
      enValue: proseKeys.get(key),
    }))
    .sort((a, b) => a.key.localeCompare(b.key))

  // ── Report ─────────────────────────────────────────────────────────────────
  let hasError = false

  if (missingFromEn.length > 0) {
    hasError = true
    console.log('\n❌ i18n: keys missing from the base `en` locale\n')
    console.log(
      '   These t() call sites rely on the inline English default because the key\n' +
      '   is absent from en/translation.json. Add the key to fix the fallback.\n'
    )
    for (const { key, file, line } of missingFromEn) {
      console.log(`   ${file}:${line}  →  ${key}`)
    }
    console.log()
  }

  if (falseTicks.length > 0) {
    hasError = true
    console.log('❌ i18n: false-tick translations (non-en/fr value identical to English prose)\n')
    console.log(
      '   Translate the key properly, or add it to false_tick_exceptions in\n' +
      '   .i18n-allow-list.json if the identical value is genuinely intentional.\n'
    )
    for (const { key, locales, enValue } of falseTicks) {
      const preview = enValue.length > 70 ? enValue.slice(0, 67) + '…' : enValue
      console.log(`   ${key}`)
      console.log(`     locales : ${locales.join(', ')}`)
      console.log(`     en value: "${preview}"`)
    }
    console.log()
  }

  if (!hasError) {
    console.log('✅ i18n check passed')
    process.exit(0)
  } else {
    process.exit(1)
  }
}

main()
