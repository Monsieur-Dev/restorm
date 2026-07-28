#!/usr/bin/env node
/**
 * Generate per-locale "What's new" changelogs from scripts/changelog-i18n.json.
 *
 * English is canonical in ../CHANGELOG.md; this writes ../changelogs/<locale>.md
 * for every non-English locale in the translations file, using the same
 * `## vX.Y.Z` section format the in-app "What's new" parser expects. The
 * UpdateService reads changelogs/<locale>.md for the user's UI language and falls
 * back to CHANGELOG.md (English) when a locale file is missing.
 *
 * Workflow when adding a release: add the English section to ../CHANGELOG.md and
 * the translated bullets to changelog-i18n.json, then run:
 *   node scripts/generate-changelogs.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataPath = resolve(__dirname, 'changelog-i18n.json')
const outDir = resolve(__dirname, '../changelogs')

const data = JSON.parse(readFileSync(dataPath, 'utf8'))
const header = data.header ?? '# Changelog'
mkdirSync(outDir, { recursive: true })

// Locales are the union of note keys across all versions, minus English
// (English is served from CHANGELOG.md, not changelogs/en.md).
const locales = new Set()
for (const v of data.versions) for (const l of Object.keys(v.notes ?? {})) if (l !== 'en') locales.add(l)

let written = 0
for (const locale of [...locales].sort()) {
  const parts = [header, '']
  for (const v of data.versions) {
    const notes = v.notes?.[locale]
    if (!notes || notes.length === 0) {
      console.warn(`WARN: locale "${locale}" is missing notes for v${v.version} — skipping that section`)
      continue
    }
    parts.push(`## v${v.version}`, '')
    for (const bullet of notes) parts.push(`- ${bullet}`)
    parts.push('')
  }
  const md = parts.join('\n').replace(/\n+$/, '\n')
  writeFileSync(resolve(outDir, `${locale}.md`), md)
  written++
}

console.log(`Generated ${written} localized changelog(s) in changelogs/`)
