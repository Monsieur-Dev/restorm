// @vitest-environment node
/**
 * Every `titleKey` / `descriptionKey` / `labelKey` declared in
 * `resources/settings.yaml` must resolve to a real string in every shipped
 * locale. i18next treats a dotted key as a NESTED path, so a translation stored
 * under the flat key `"dateTimeFormat.us"` is unreachable from
 * `behavior.dateTimeFormat.us` — the settings pane then falls back to printing
 * the raw key and the language switch logs a missing-translation warning. Only
 * a resolution test catches that: the key exists in the file, just not where
 * the lookup goes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

const REPO = join(__dirname, '..', '..')
const RESTORM_LOCALES = join(REPO, 'src', 'renderer', 'locales')
const ECUI_LOCALES = join(REPO, '..', 'electron-core-ui', 'src', 'renderer', 'locales')

interface EnumValue { labelKey?: string }
interface SettingNode {
  titleKey?: string
  descriptionKey?: string
  params?: { values?: EnumValue[] }
}
interface GroupNode {
  titleKey?: string
  items?: { setting?: SettingNode }[]
}

function collectKeys(): string[] {
  const yaml = parse(readFileSync(join(REPO, 'resources', 'settings.yaml'), 'utf-8')) as {
    groups?: GroupNode[]
  }
  const keys: string[] = []
  for (const group of yaml.groups ?? []) {
    if (group.titleKey) keys.push(group.titleKey)
    for (const item of group.items ?? []) {
      const setting = item.setting
      if (!setting) continue
      if (setting.titleKey) keys.push(setting.titleKey)
      if (setting.descriptionKey) keys.push(setting.descriptionKey)
      for (const value of setting.params?.values ?? []) {
        if (value.labelKey) keys.push(value.labelKey)
      }
    }
  }
  return keys
}

/** Resolve a dotted key the way i18next does: as a path into the catalogue. */
function resolve(catalogue: unknown, key: string): unknown {
  let node = catalogue
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[segment]
  }
  return node
}

function readCatalogue(root: string, locale: string): Record<string, unknown> {
  const file = join(root, locale, 'translation.json')
  if (!existsSync(file)) return {}
  return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
}

const locales = readdirSync(RESTORM_LOCALES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const keys = collectKeys()

describe('settings.yaml translation keys', () => {
  it('declares keys for every group and setting', () => {
    expect(locales.length).toBeGreaterThan(1)
    expect(keys.length).toBeGreaterThan(10)
    // The enum option labels are the ones a flat dotted key silently breaks.
    expect(keys).toContain('behavior.dateTimeFormat.us')
    expect(keys).toContain('console.requestFormat.curl')
  })

  it.each(locales)('resolves every settings key in %s', (locale) => {
    const restorm = readCatalogue(RESTORM_LOCALES, locale)
    const ecui = readCatalogue(ECUI_LOCALES, locale)
    const unresolved = keys.filter((key) => {
      const value = resolve(restorm, key) ?? resolve(ecui, key)
      return typeof value !== 'string'
    })
    expect(unresolved).toEqual([])
  })
})
