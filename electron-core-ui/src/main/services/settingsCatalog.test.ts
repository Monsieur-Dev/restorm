import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Mocks — everything Electron-bound is stubbed, but `fs` + `js-yaml` stay REAL
// so the assembly suite below can load the YAML this library actually ships.
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  storage: new Map<string, unknown>(),
  featureEnabled: true
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: (): unknown[] => [] }
}))

vi.mock('./LoggerService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

vi.mock('./StorageService', () => ({
  getStorageService: () => ({
    get: (key: string): unknown => mockState.storage.get(key),
    set: (key: string, value: unknown): void => { mockState.storage.set(key, value) },
    delete: (key: string): void => { mockState.storage.delete(key) }
  })
}))

vi.mock('./I18nService', () => ({
  i18nService: { t: (key: string): string => key }
}))

vi.mock('./FeatureFlippingService', () => ({
  isFeatureServiceInitialized: (): boolean => true,
  getFeatureService: () => ({ isEnabled: (): boolean => mockState.featureEnabled })
}))

vi.mock('./PersistenceService', () => ({
  atomicWriteFile: vi.fn<(path: string, contents: string) => Promise<void>>(() => Promise.resolve())
}))

import type { ResolvedSetting, ResolvedSettingValue, SettingValue } from '../../types/settings'
import { SettingsService } from './SettingsService'
import {
  applySettingValue,
  buildSettingsCatalog,
  checkScopeReadable,
  checkScopeWritable,
  describeAllowedValues,
  editableScopesOf,
  resetSettingValue,
  validateSettingValue,
  validateSettingWrites,
  type SettingsCatalogDeps,
  type SettingsCatalogStore
} from './settingsCatalog'

// ---------------------------------------------------------------------------
// A hand-built registry, so the pure-function suites don't need a real service.
// ---------------------------------------------------------------------------
function setting(overrides: Partial<ResolvedSetting> & Pick<ResolvedSetting, 'storageKey' | 'type' | 'default'>): ResolvedSetting {
  const [path, id] = overrides.storageKey.split(':')
  return {
    id: id ?? overrides.storageKey,
    titleKey: `${overrides.storageKey}.title`,
    descriptionKey: `${overrides.storageKey}.description`,
    groupPath: (path ?? '').split('.').filter(Boolean),
    currentValue: overrides.default,
    isModified: false,
    ...overrides
  }
}

const FIXTURE_SETTINGS: ResolvedSetting[] = [
  setting({ storageKey: 'appearance:theme', type: 'theme', default: 'dark/Default Dark+' }),
  setting({
    storageKey: 'appearance:language',
    type: 'enum',
    default: 'en',
    userOnly: true,
    params: { values: [{ value: 'en', labelKey: 'lang.en' }, { value: 'fr', labelKey: 'lang.fr' }] }
  }),
  setting({
    storageKey: 'appearance.editor:fontSize',
    type: 'number',
    default: 14,
    params: { min: 8, max: 72, integer: true }
  }),
  setting({ storageKey: 'appearance.editor:wordWrap', type: 'toggle', default: false }),
  setting({ storageKey: 'appearance.editor:fontFamily', type: 'text', default: 'monospace', params: { maxLength: 40 } }),
  setting({ storageKey: 'files:accentColor', type: 'color-picker', default: '#0078d4', capability: 'pro.colors' })
]

const THEMES = [
  { id: 'dark/Default Dark+', name: 'Default Dark+', type: 'dark' },
  { id: 'light/Default Light+', name: 'Default Light+', type: 'light' }
]

interface FakeStore extends SettingsCatalogStore {
  userValues: Map<string, SettingValue>
  workspaceValues: Map<string, SettingValue>
  writes: { scope: string; key: string; value: SettingValue }[]
  resets: { scope: string; key: string }[]
  workspacePath: string | null
}

function createFakeStore(settings: ResolvedSetting[] = FIXTURE_SETTINGS): FakeStore {
  const store: FakeStore = {
    userValues: new Map(),
    workspaceValues: new Map(),
    writes: [],
    resets: [],
    workspacePath: '/projects/demo',
    getFiltered: () => settings,
    getUserValue: (key) => store.userValues.get(key),
    getWorkspaceValue: (key) => store.workspaceValues.get(key),
    getResolvedValue: (key): ResolvedSettingValue => {
      const ws = store.workspaceValues.get(key)
      if (ws !== undefined) return { storageKey: key, effective: ws, source: 'workspace' }
      const user = store.userValues.get(key)
      if (user !== undefined) return { storageKey: key, effective: user, source: 'user' }
      const def = settings.find((s) => s.storageKey === key)?.default ?? ''
      return { storageKey: key, effective: def, source: 'default' }
    },
    getWorkspacePath: () => store.workspacePath,
    set: (key, value) => { store.userValues.set(key, value); store.writes.push({ scope: 'user', key, value }) },
    setWorkspaceValue: (key, value) => {
      store.workspaceValues.set(key, value)
      store.writes.push({ scope: 'workspace', key, value })
    },
    resetSetting: (key) => { store.userValues.delete(key); store.resets.push({ scope: 'user', key }) },
    resetWorkspaceValue: (key) => {
      store.workspaceValues.delete(key)
      store.resets.push({ scope: 'workspace', key })
    }
  }
  return store
}

function createDeps(store: SettingsCatalogStore, themes: typeof THEMES | null = THEMES): SettingsCatalogDeps {
  return {
    store,
    translate: (key) => `t(${key})`,
    listThemes: () => themes
  }
}

function entryFor(deps: SettingsCatalogDeps, key: string, scope: 'user' | 'workspace' = 'user'): NonNullable<ReturnType<typeof buildSettingsCatalog>[number]> {
  const found = buildSettingsCatalog(deps, scope).find((e) => e.key === key)
  if (!found) throw new Error(`fixture missing setting ${key}`)
  return found
}

/** Assert a validation failed, and that its message explains why. */
function expectRejected(result: ReturnType<typeof validateSettingValue>, fragment: string): void {
  expect(result.ok).toBe(false)
  expect(result.ok ? '' : result.error).toContain(fragment)
}

// ---------------------------------------------------------------------------
// Allowed values are DERIVED from the declared type + params
// ---------------------------------------------------------------------------
describe('settingsCatalog — allowed values', () => {
  const deps = createDeps(createFakeStore())

  it('derives a boolean domain from a toggle', () => {
    expect(describeAllowedValues({ type: 'toggle', default: false }, deps)).toEqual({ kind: 'boolean' })
  })

  it('derives the enum members and translates their labels', () => {
    expect(
      describeAllowedValues(
        { type: 'enum', default: 'en', params: { values: [{ value: 'en', labelKey: 'lang.en' }] } },
        deps
      )
    ).toEqual({ kind: 'enum', values: [{ value: 'en', label: 't(lang.en)' }] })
  })

  it('derives the numeric range and integer flag', () => {
    expect(describeAllowedValues({ type: 'number', default: 14, params: { min: 8, max: 72, integer: true } }, deps))
      .toEqual({ kind: 'number', min: 8, max: 72, integer: true })
  })

  it('omits absent bounds instead of inventing them', () => {
    expect(describeAllowedValues({ type: 'number', default: 3, params: {} }, deps))
      .toEqual({ kind: 'number', integer: false })
  })

  it('derives the max length of a text setting', () => {
    expect(describeAllowedValues({ type: 'text', default: 'x', params: { maxLength: 40 } }, deps))
      .toEqual({ kind: 'text', maxLength: 40 })
  })

  it('enumerates the installed themes for a theme setting', () => {
    expect(describeAllowedValues({ type: 'theme', default: 'dark/Default Dark+' }, deps)).toEqual({
      kind: 'theme',
      values: [
        { value: 'dark/Default Dark+', label: 'Default Dark+', family: 'dark' },
        { value: 'light/Default Light+', label: 'Default Light+', family: 'light' }
      ]
    })
  })

  it('reports an empty theme list when no theme service is running', () => {
    const offline = createDeps(createFakeStore(), null)
    expect(describeAllowedValues({ type: 'theme', default: 'dark/Default Dark+' }, offline))
      .toEqual({ kind: 'theme', values: [] })
  })

  it('falls back to the primitive type for a host-registered custom type', () => {
    expect(describeAllowedValues({ type: 'color-picker', default: '#0078d4' }, deps))
      .toEqual({ kind: 'any', valueType: 'string' })
  })

  it('marks a userOnly setting as writable at the user scope only', () => {
    expect(editableScopesOf({ userOnly: true })).toEqual(['user'])
    expect(editableScopesOf({})).toEqual(['user', 'workspace'])
  })
})

// ---------------------------------------------------------------------------
// Reading the catalogue, per scope
// ---------------------------------------------------------------------------
describe('settingsCatalog — reading', () => {
  it('describes every setting with its value, domain and human description', () => {
    const store = createFakeStore()
    store.userValues.set('appearance.editor:fontSize', 18)
    const entry = entryFor(createDeps(store), 'appearance.editor:fontSize')

    expect(entry).toMatchObject({
      key: 'appearance.editor:fontSize',
      groupPath: ['appearance', 'editor'],
      title: 't(appearance.editor:fontSize.title)',
      description: 't(appearance.editor:fontSize.description)',
      type: 'number',
      default: 14,
      allowed: { kind: 'number', min: 8, max: 72, integer: true },
      value: 18,
      effective: 18,
      effectiveSource: 'user',
      editableScopes: ['user', 'workspace']
    })
  })

  it('reports the requested scope value, not the effective one', () => {
    const store = createFakeStore()
    store.userValues.set('appearance.editor:fontSize', 18)
    store.workspaceValues.set('appearance.editor:fontSize', 22)
    const deps = createDeps(store)

    expect(entryFor(deps, 'appearance.editor:fontSize', 'user').value).toBe(18)
    expect(entryFor(deps, 'appearance.editor:fontSize', 'workspace').value).toBe(22)
    // Both scopes agree on what is actually in force, and where it comes from.
    for (const scope of ['user', 'workspace'] as const) {
      expect(entryFor(deps, 'appearance.editor:fontSize', scope).effective).toBe(22)
      expect(entryFor(deps, 'appearance.editor:fontSize', scope).effectiveSource).toBe('workspace')
    }
  })

  it('reports null at a scope that does not override the setting', () => {
    const deps = createDeps(createFakeStore())
    expect(entryFor(deps, 'appearance.editor:fontSize', 'workspace').value).toBeNull()
    expect(entryFor(deps, 'appearance.editor:fontSize', 'workspace').effective).toBe(14)
    expect(entryFor(deps, 'appearance.editor:fontSize', 'workspace').effectiveSource).toBe('default')
  })

  it('surfaces the entitlement capability a setting declares', () => {
    expect(entryFor(createDeps(createFakeStore()), 'files:accentColor').capability).toBe('pro.colors')
    expect(entryFor(createDeps(createFakeStore()), 'appearance:theme').capability).toBeUndefined()
  })

  it('filters on key, title and description', () => {
    const deps = createDeps(createFakeStore())
    expect(buildSettingsCatalog(deps, 'user', 'fontsize').map((e) => e.key)).toEqual(['appearance.editor:fontSize'])
    expect(buildSettingsCatalog(deps, 'user', 'editor').map((e) => e.key)).toEqual([
      'appearance.editor:fontSize',
      'appearance.editor:wordWrap',
      'appearance.editor:fontFamily'
    ])
    expect(buildSettingsCatalog(deps, 'user', '   ')).toHaveLength(FIXTURE_SETTINGS.length)
    expect(buildSettingsCatalog(deps, 'user', 'nothing-matches-this')).toEqual([])
  })

  it('reports an empty workspace scope when no project is open', () => {
    const store = createFakeStore()
    store.workspacePath = null
    const deps = createDeps(store)
    expect(checkScopeReadable(deps, 'workspace')).toContain('No workspace is open')
    expect(checkScopeReadable(deps, 'user')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
describe('settingsCatalog — validation', () => {
  const deps = createDeps(createFakeStore())

  it('accepts a value inside the declared domain', () => {
    expect(validateSettingValue(entryFor(deps, 'appearance.editor:fontSize'), 24)).toEqual({ ok: true, value: 24 })
    expect(validateSettingValue(entryFor(deps, 'appearance.editor:wordWrap'), true)).toEqual({ ok: true, value: true })
    expect(validateSettingValue(entryFor(deps, 'appearance:language'), 'fr')).toEqual({ ok: true, value: 'fr' })
    expect(validateSettingValue(entryFor(deps, 'appearance:theme'), 'light/Default Light+'))
      .toEqual({ ok: true, value: 'light/Default Light+' })
  })

  it('rejects a value outside the numeric range and names the bound', () => {
    const entry = entryFor(deps, 'appearance.editor:fontSize')
    expectRejected(validateSettingValue(entry, 4), 'below the minimum 8')
    expectRejected(validateSettingValue(entry, 500), 'above the maximum 72')
    expectRejected(validateSettingValue(entry, 14.5), 'expects an integer')
    expectRejected(validateSettingValue(entry, '20'), 'expects a finite number')
  })

  it('rejects an unknown enum member and lists the accepted ones', () => {
    expectRejected(validateSettingValue(entryFor(deps, 'appearance:language'), 'kl'), 'Allowed values: en, fr')
  })

  it('rejects an unknown theme id and lists the installed ones', () => {
    expectRejected(
      validateSettingValue(entryFor(deps, 'appearance:theme'), 'dark/Nope'),
      'Allowed values: dark/Default Dark+, light/Default Light+'
    )
  })

  it('accepts any theme id when no theme service can vouch for the list', () => {
    const offline = createDeps(createFakeStore(), null)
    expect(validateSettingValue(entryFor(offline, 'appearance:theme'), 'dark/Whatever'))
      .toEqual({ ok: true, value: 'dark/Whatever' })
  })

  it('rejects a wrong primitive type', () => {
    expectRejected(validateSettingValue(entryFor(deps, 'appearance.editor:wordWrap'), 'yes'), 'expects a boolean, received string')
    expectRejected(validateSettingValue(entryFor(deps, 'files:accentColor'), 42), 'expects a string, received number')
  })

  it('rejects text past its declared maximum length', () => {
    expectRejected(validateSettingValue(entryFor(deps, 'appearance.editor:fontFamily'), 'x'.repeat(41)), 'at most 40 characters')
  })
})

// ---------------------------------------------------------------------------
// Scope guards
// ---------------------------------------------------------------------------
describe('settingsCatalog — scope guards', () => {
  it('rejects an unknown key and points at the listing route', () => {
    const deps = createDeps(createFakeStore())
    const error = checkScopeWritable(deps, undefined, 'nope:nope', 'user')
    expect(error).toContain('Unknown setting "nope:nope"')
  })

  it('rejects a workspace write when no project is open', () => {
    const store = createFakeStore()
    store.workspacePath = null
    const deps = createDeps(store)
    expect(checkScopeWritable(deps, entryFor(deps, 'appearance.editor:fontSize'), 'appearance.editor:fontSize', 'workspace'))
      .toContain('No workspace is open')
    // The user scope is unaffected by a closed project.
    expect(checkScopeWritable(deps, entryFor(deps, 'appearance.editor:fontSize'), 'appearance.editor:fontSize', 'user'))
      .toBeNull()
  })

  it('rejects a workspace write to a user-only setting', () => {
    const deps = createDeps(createFakeStore())
    expect(checkScopeWritable(deps, entryFor(deps, 'appearance:language'), 'appearance:language', 'workspace'))
      .toContain('user-only')
    expect(checkScopeWritable(deps, entryFor(deps, 'appearance:language'), 'appearance:language', 'user')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------
describe('settingsCatalog — writing', () => {
  it('writes through the service method matching the scope', () => {
    const store = createFakeStore()
    const deps = createDeps(store)
    applySettingValue(deps, 'user', 'appearance:theme', 'light/Default Light+')
    applySettingValue(deps, 'workspace', 'appearance.editor:fontSize', 20)
    expect(store.writes).toEqual([
      { scope: 'user', key: 'appearance:theme', value: 'light/Default Light+' },
      { scope: 'workspace', key: 'appearance.editor:fontSize', value: 20 }
    ])
  })

  it('resets through the service method matching the scope', () => {
    const store = createFakeStore()
    const deps = createDeps(store)
    resetSettingValue(deps, 'user', 'appearance:theme')
    resetSettingValue(deps, 'workspace', 'appearance.editor:fontSize')
    expect(store.resets).toEqual([
      { scope: 'user', key: 'appearance:theme' },
      { scope: 'workspace', key: 'appearance.editor:fontSize' }
    ])
  })

  it('splits a batch into accepted and rejected writes before anything is applied', () => {
    const store = createFakeStore()
    const deps = createDeps(store)
    const catalog = buildSettingsCatalog(deps, 'user')
    const result = validateSettingWrites(deps, catalog, 'user', [
      { key: 'appearance.editor:fontSize', value: 20 },
      { key: 'appearance.editor:fontSize', value: 900 },
      { key: 'ghost:setting', value: 1 }
    ])

    expect(result.accepted).toEqual([{ key: 'appearance.editor:fontSize', value: 20 }])
    expect(result.rejected.map((r) => r.key)).toEqual(['appearance.editor:fontSize', 'ghost:setting'])
    // Validation alone must not have touched the store.
    expect(store.writes).toEqual([])
  })

  it('rejects a batch entry the target scope cannot accept', () => {
    const deps = createDeps(createFakeStore())
    const catalog = buildSettingsCatalog(deps, 'workspace')
    const result = validateSettingWrites(deps, catalog, 'workspace', [{ key: 'appearance:language', value: 'fr' }])
    expect(result.accepted).toEqual([])
    expect(result.rejected[0]?.error).toContain('user-only')
  })
})

// ---------------------------------------------------------------------------
// The catalogue is assembled from the SHIPPED library defaults plus whatever
// the consuming app registers — no key is known to this module in advance.
// ---------------------------------------------------------------------------
describe('settingsCatalog — dynamic assembly (library defaults + app config)', () => {
  const libraryDefaults = fileURLToPath(new URL('../../../resources/settings/defaults.yaml', import.meta.url))
  let tempDir: string
  let appConfigPath: string

  beforeEach(() => {
    mockState.storage.clear()
    mockState.featureEnabled = true
    tempDir = mkdtempSync(join(tmpdir(), 'ecui-settings-catalog-'))
    appConfigPath = join(tempDir, 'settings.yaml')
    writeFileSync(
      appConfigPath,
      [
        'groups:',
        '  - id: "myapp"',
        '    titleKey: "myapp.title"',
        '    items:',
        '      - setting:',
        '          id: "syncEnabled"',
        '          titleKey: "myapp.syncEnabled"',
        '          descriptionKey: "myapp.syncEnabledDescription"',
        '          type: "toggle"',
        '          default: true',
        '      - setting:',
        '          id: "retries"',
        '          titleKey: "myapp.retries"',
        '          type: "number"',
        '          default: 3',
        '          params:',
        '            min: 0',
        '            max: 10',
        '            integer: true',
        ''
      ].join('\n'),
      'utf-8'
    )
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  function catalogDeps(): SettingsCatalogDeps {
    const service = new SettingsService(libraryDefaults, appConfigPath)
    return { store: service, translate: (key) => key, listThemes: () => THEMES }
  }

  it('exposes the library base settings and the app additions side by side', () => {
    const keys = buildSettingsCatalog(catalogDeps(), 'user').map((e) => e.key)
    // Base (electron-core-ui/resources/settings/defaults.yaml)
    expect(keys).toContain('appearance:theme')
    expect(keys).toContain('appearance:language')
    expect(keys).toContain('appearance.editor:fontSize')
    expect(keys).toContain('files:autoSave')
    // App additions, discovered with no code change here
    expect(keys).toContain('myapp:syncEnabled')
    expect(keys).toContain('myapp:retries')
  })

  it('derives the domain of an app setting from the app YAML alone', () => {
    const entry = entryFor(catalogDeps(), 'myapp:retries')
    expect(entry.allowed).toEqual({ kind: 'number', min: 0, max: 10, integer: true })
    expect(entry.default).toBe(3)
    expect(entry.groupPath).toEqual(['myapp'])
  })

  it('carries the declarations of the library through unchanged', () => {
    const deps = catalogDeps()
    const language = entryFor(deps, 'appearance:language')
    // `userOnly: true` in the shipped YAML — locale is a per-machine choice.
    expect(language.editableScopes).toEqual(['user'])
    expect(language.allowed.kind).toBe('enum')
    expect(language.allowed.kind === 'enum' && language.allowed.values.some((v) => v.value === 'fr')).toBe(true)

    const fontSize = entryFor(deps, 'appearance.editor:fontSize')
    expect(fontSize.allowed).toEqual({ kind: 'number', min: 8, max: 72, integer: true })
  })

  it('hides a feature-gated setting exactly as the settings page does', () => {
    mockState.featureEnabled = false
    expect(buildSettingsCatalog(catalogDeps(), 'user').map((e) => e.key)).not.toContain('appearance:advancedVisualEffects')
    mockState.featureEnabled = true
    expect(buildSettingsCatalog(catalogDeps(), 'user').map((e) => e.key)).toContain('appearance:advancedVisualEffects')
  })

  it('round-trips a write through the real service at the user scope', () => {
    const deps = catalogDeps()
    applySettingValue(deps, 'user', 'myapp:retries', 7)
    const entry = entryFor(deps, 'myapp:retries')
    expect(entry.value).toBe(7)
    expect(entry.effective).toBe(7)
    expect(entry.effectiveSource).toBe('user')

    resetSettingValue(deps, 'user', 'myapp:retries')
    const afterReset = entryFor(deps, 'myapp:retries')
    expect(afterReset.value).toBeNull()
    expect(afterReset.effective).toBe(3)
    expect(afterReset.effectiveSource).toBe('default')
  })

  it('round-trips a write through the real service at the workspace scope', () => {
    const service = new SettingsService(libraryDefaults, appConfigPath)
    service.setWorkspacePath(tempDir)
    const deps: SettingsCatalogDeps = { store: service, translate: (key) => key, listThemes: () => THEMES }

    expect(checkScopeReadable(deps, 'workspace')).toBeNull()
    applySettingValue(deps, 'workspace', 'myapp:syncEnabled', false)

    const entry = entryFor(deps, 'myapp:syncEnabled', 'workspace')
    expect(entry.value).toBe(false)
    expect(entry.effectiveSource).toBe('workspace')
    // The user layer is untouched — the overlay is what changed.
    expect(entryFor(deps, 'myapp:syncEnabled', 'user').value).toBeNull()
  })
})
