/**
 * The machine-readable view of the settings registry — the same group tree the
 * GUI settings page renders, flattened into self-describing entries an external
 * agent can enumerate and mutate without knowing a single setting id in advance.
 *
 * Everything here is DERIVED. There is no per-setting logic anywhere in this
 * file: allowed values come from the YAML `type` + `params` a setting declares,
 * titles/descriptions come from its i18n keys, and writes go through the plain
 * `SettingsService` methods the GUI itself calls. A setting added to any YAML
 * config — the library's defaults or the consuming app's own file — therefore
 * shows up in this catalogue automatically, with its constraints, on the next
 * read.
 *
 * That write-through property also carries the "apply" behaviour for free: the
 * renderer's `SettingsProvider` already listens to the `settings:changed`
 * broadcast that `SettingsService.set()` / `setWorkspaceValue()` emit and runs
 * whatever side effect a key needs (swapping the theme, changing the locale via
 * the i18n IPC). Writing through the service is what makes those apply live, so
 * this module must never reach around it.
 */

import type {
  EnumParams,
  NumberParams,
  ResolvedSetting,
  ResolvedSettingValue,
  SettingValue,
  TextParams
} from '../../types/settings'

// ==========================================================================
// Scopes
// ==========================================================================

/**
 * The two writable layers. `user` is the global, app-wide layer (persisted by
 * `StorageService`); `workspace` is the per-project overlay
 * (`<workspace>/.restorm/settings.json`). Mirrors `SettingValueSource` minus
 * `default`, which is computed and cannot be written to.
 */
export type SettingsScope = 'user' | 'workspace'

/** The scopes a caller may name. */
export const SETTINGS_SCOPES: readonly SettingsScope[] = ['user', 'workspace']

// ==========================================================================
// Allowed values
// ==========================================================================

/**
 * What a setting will accept, derived from its declared `type` + `params`.
 * Discriminated on `kind` so a caller can render or validate a control without
 * a lookup table of setting ids.
 */
export type SettingAllowedValues =
  | { kind: 'boolean' }
  | { kind: 'enum'; values: { value: string; label: string }[] }
  | { kind: 'number'; min?: number; max?: number; integer: boolean }
  | { kind: 'text'; maxLength?: number }
  | { kind: 'theme'; values: { value: string; label: string; family: string }[] }
  /** A type with a custom (host-registered) renderer: only the primitive type is known. */
  | { kind: 'any'; valueType: 'string' | 'number' | 'boolean' }

/** A theme as the catalogue needs it — a structural subset of `ThemeInfo`. */
export interface CatalogThemeInfo {
  id: string
  name: string
  type: string
}

// ==========================================================================
// Catalogue entry
// ==========================================================================

export interface SettingCatalogEntry {
  /** Canonical storage key, e.g. `appearance.editor:fontSize`. */
  key: string
  /** Group path segments, outermost first. */
  groupPath: string[]
  /** Translated title (falls back to the raw i18n key when unresolved). */
  title: string
  /** Translated description of what the setting does; empty when none is declared. */
  description: string
  /** Declared renderer type (`toggle` | `number` | `text` | `enum` | `theme` | custom). */
  type: string
  /** Value used when neither layer carries one. */
  default: SettingValue
  /** What this setting accepts. */
  allowed: SettingAllowedValues
  /** The value stored AT THE REQUESTED SCOPE, or `null` when that layer doesn't override it. */
  value: SettingValue | null
  /** The value actually in force, across every layer. */
  effective: SettingValue
  /** Which layer `effective` came from. */
  effectiveSource: ResolvedSettingValue['source']
  /** Scopes that may write this setting — `['user']` for a `userOnly` setting. */
  editableScopes: SettingsScope[]
  /** Entitlement capability gating the setting in the GUI, when it declares one. */
  capability?: string
}

// ==========================================================================
// Dependencies
// ==========================================================================

/**
 * The slice of `SettingsService` the catalogue needs. Declared structurally so
 * the module stays unit-testable without an Electron app, and so a host can
 * feed it an equivalent store.
 */
export interface SettingsCatalogStore {
  getFiltered(): ResolvedSetting[]
  getUserValue(storageKey: string): SettingValue | undefined
  getWorkspaceValue(storageKey: string): SettingValue | undefined
  getResolvedValue(storageKey: string): ResolvedSettingValue
  getWorkspacePath(): string | null
  set(storageKey: string, value: SettingValue): void
  setWorkspaceValue(storageKey: string, value: SettingValue): void
  resetSetting(storageKey: string): void
  resetWorkspaceValue(storageKey: string): void
}

export interface SettingsCatalogDeps {
  store: SettingsCatalogStore
  /** Resolves an i18n key to display text; return the key itself when unknown. */
  translate: (key: string) => string
  /** Available themes, or `null` when the host has no theme service running. */
  listThemes: () => CatalogThemeInfo[] | null
}

// ==========================================================================
// Building the catalogue
// ==========================================================================

function isEnumParams(params: unknown): params is EnumParams {
  return typeof params === 'object' && params !== null && Array.isArray((params as EnumParams).values)
}

function asNumberParams(params: unknown): NumberParams {
  return typeof params === 'object' && params !== null ? (params as NumberParams) : {}
}

function asTextParams(params: unknown): TextParams {
  return typeof params === 'object' && params !== null ? (params as TextParams) : {}
}

function primitiveTypeOf(value: SettingValue): 'string' | 'number' | 'boolean' {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'string'
}

/** Derive what a setting accepts from its declared type + params. */
export function describeAllowedValues(
  setting: Pick<ResolvedSetting, 'type' | 'params' | 'default'>,
  deps: Pick<SettingsCatalogDeps, 'translate' | 'listThemes'>
): SettingAllowedValues {
  switch (setting.type) {
    case 'toggle':
      return { kind: 'boolean' }
    case 'enum': {
      const values = isEnumParams(setting.params)
        ? setting.params.values.map((v) => ({ value: v.value, label: deps.translate(v.labelKey) }))
        : []
      return { kind: 'enum', values }
    }
    case 'number': {
      const params = asNumberParams(setting.params)
      return {
        kind: 'number',
        ...(params.min !== undefined ? { min: params.min } : {}),
        ...(params.max !== undefined ? { max: params.max } : {}),
        integer: params.integer === true
      }
    }
    case 'text': {
      const params = asTextParams(setting.params)
      return { kind: 'text', ...(params.maxLength !== undefined ? { maxLength: params.maxLength } : {}) }
    }
    case 'theme': {
      const themes = deps.listThemes()
      return {
        kind: 'theme',
        values: (themes ?? []).map((t) => ({ value: t.id, label: t.name, family: t.type }))
      }
    }
    default:
      return { kind: 'any', valueType: primitiveTypeOf(setting.default) }
  }
}

/** The scopes a setting may be written at. */
export function editableScopesOf(setting: Pick<ResolvedSetting, 'userOnly'>): SettingsScope[] {
  return setting.userOnly === true ? ['user'] : ['user', 'workspace']
}

/**
 * Flatten the assembled registry (library defaults + whatever the consuming app
 * registered, feature-gated entries already stripped) into catalogue entries
 * read at `scope`. `query` filters case-insensitively over key + title +
 * description.
 */
export function buildSettingsCatalog(
  deps: SettingsCatalogDeps,
  scope: SettingsScope,
  query?: string
): SettingCatalogEntry[] {
  const entries = deps.store.getFiltered().map((setting): SettingCatalogEntry => {
    const scopedValue =
      scope === 'workspace'
        ? deps.store.getWorkspaceValue(setting.storageKey)
        : deps.store.getUserValue(setting.storageKey)
    const resolved = deps.store.getResolvedValue(setting.storageKey)
    return {
      key: setting.storageKey,
      groupPath: setting.groupPath,
      title: deps.translate(setting.titleKey),
      description: setting.descriptionKey ? deps.translate(setting.descriptionKey) : '',
      type: setting.type,
      default: setting.default,
      allowed: describeAllowedValues(setting, deps),
      value: scopedValue ?? null,
      effective: resolved.effective,
      effectiveSource: resolved.source,
      editableScopes: editableScopesOf(setting),
      ...(setting.capability !== undefined ? { capability: setting.capability } : {})
    }
  })

  const needle = query?.trim().toLowerCase()
  if (!needle) return entries
  return entries.filter(
    (e) =>
      e.key.toLowerCase().includes(needle) ||
      e.title.toLowerCase().includes(needle) ||
      e.description.toLowerCase().includes(needle)
  )
}

// ==========================================================================
// Validation
// ==========================================================================

export type SettingValidation =
  | { ok: true; value: SettingValue }
  | { ok: false; error: string }

function typeName(value: unknown): string {
  return value === null ? 'null' : typeof value
}

/**
 * Check a candidate value against what the entry declares it accepts. Errors
 * name the constraint AND the accepted values, so a caller that guessed wrong
 * can correct itself without a second round-trip.
 */
export function validateSettingValue(entry: SettingCatalogEntry, value: unknown): SettingValidation {
  const allowed = entry.allowed
  switch (allowed.kind) {
    case 'boolean':
      if (typeof value !== 'boolean') {
        return { ok: false, error: `"${entry.key}" expects a boolean, received ${typeName(value)}` }
      }
      return { ok: true, value }
    case 'enum': {
      if (typeof value !== 'string') {
        return { ok: false, error: `"${entry.key}" expects a string, received ${typeName(value)}` }
      }
      if (!allowed.values.some((v) => v.value === value)) {
        const ids = allowed.values.map((v) => v.value).join(', ')
        return { ok: false, error: `"${value}" is not a valid value for "${entry.key}". Allowed values: ${ids}` }
      }
      return { ok: true, value }
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, error: `"${entry.key}" expects a finite number, received ${typeName(value)}` }
      }
      if (allowed.integer && !Number.isInteger(value)) {
        return { ok: false, error: `"${entry.key}" expects an integer, received ${String(value)}` }
      }
      if (allowed.min !== undefined && value < allowed.min) {
        return { ok: false, error: `${String(value)} is below the minimum ${String(allowed.min)} for "${entry.key}"` }
      }
      if (allowed.max !== undefined && value > allowed.max) {
        return { ok: false, error: `${String(value)} is above the maximum ${String(allowed.max)} for "${entry.key}"` }
      }
      return { ok: true, value }
    }
    case 'text': {
      if (typeof value !== 'string') {
        return { ok: false, error: `"${entry.key}" expects a string, received ${typeName(value)}` }
      }
      if (allowed.maxLength !== undefined && value.length > allowed.maxLength) {
        return {
          ok: false,
          error: `"${entry.key}" accepts at most ${String(allowed.maxLength)} characters, received ${String(value.length)}`
        }
      }
      return { ok: true, value }
    }
    case 'theme': {
      if (typeof value !== 'string') {
        return { ok: false, error: `"${entry.key}" expects a string, received ${typeName(value)}` }
      }
      // An empty list means no theme service is running — the id can't be
      // checked, so let it through rather than rejecting every write.
      if (allowed.values.length > 0 && !allowed.values.some((v) => v.value === value)) {
        const ids = allowed.values.map((v) => v.value).join(', ')
        return { ok: false, error: `"${value}" is not a known theme id. Allowed values: ${ids}` }
      }
      return { ok: true, value }
    }
    case 'any': {
      if (typeName(value) !== allowed.valueType) {
        return { ok: false, error: `"${entry.key}" expects a ${allowed.valueType}, received ${typeName(value)}` }
      }
      return { ok: true, value: value as SettingValue }
    }
  }
}

/**
 * Reject a write the target scope cannot accept: an unknown key, a workspace
 * write with no project open, or a `userOnly` setting at workspace scope.
 * Returns `null` when the write may proceed.
 */
export function checkScopeWritable(
  deps: SettingsCatalogDeps,
  entry: SettingCatalogEntry | undefined,
  key: string,
  scope: SettingsScope
): string | null {
  if (!entry) {
    return `Unknown setting "${key}". Call the settings listing route to see every available key.`
  }
  if (scope === 'workspace') {
    if (deps.store.getWorkspacePath() === null) {
      return 'No workspace is open, so workspace-scoped settings cannot be written. Open a project first, or use the user scope.'
    }
    if (!entry.editableScopes.includes('workspace')) {
      return `"${key}" is a user-only setting and cannot be overridden at the workspace scope.`
    }
  }
  return null
}

/** Rejects a workspace READ when no project is open. Returns `null` otherwise. */
export function checkScopeReadable(deps: SettingsCatalogDeps, scope: SettingsScope): string | null {
  if (scope === 'workspace' && deps.store.getWorkspacePath() === null) {
    return 'No workspace is open, so the workspace scope is empty. Open a project first, or read the user scope.'
  }
  return null
}

// ==========================================================================
// Writing
// ==========================================================================

/**
 * Write through the same service method the GUI uses, so the change is
 * persisted, broadcast, and applied (theme swap, locale swap, …) identically to
 * a click in the settings page.
 */
export function applySettingValue(
  deps: SettingsCatalogDeps,
  scope: SettingsScope,
  key: string,
  value: SettingValue
): void {
  if (scope === 'workspace') {
    deps.store.setWorkspaceValue(key, value)
  } else {
    deps.store.set(key, value)
  }
}

/** Drop the value at `scope`, falling back to the layer beneath it. */
export function resetSettingValue(deps: SettingsCatalogDeps, scope: SettingsScope, key: string): void {
  if (scope === 'workspace') {
    deps.store.resetWorkspaceValue(key)
  } else {
    deps.store.resetSetting(key)
  }
}

// ==========================================================================
// Batch validation
// ==========================================================================

export interface SettingWriteRequest {
  key: string
  value: unknown
}

export interface SettingWriteRejection {
  key: string
  error: string
}

/**
 * Validate a whole batch before any of it is applied, so a partially-valid
 * patch never leaves the app in a half-written state.
 */
export function validateSettingWrites(
  deps: SettingsCatalogDeps,
  catalog: SettingCatalogEntry[],
  scope: SettingsScope,
  writes: SettingWriteRequest[]
): { accepted: { key: string; value: SettingValue }[]; rejected: SettingWriteRejection[] } {
  const byKey = new Map(catalog.map((e) => [e.key, e]))
  const accepted: { key: string; value: SettingValue }[] = []
  const rejected: SettingWriteRejection[] = []

  for (const write of writes) {
    const entry = byKey.get(write.key)
    const scopeError = checkScopeWritable(deps, entry, write.key, scope)
    if (scopeError !== null || !entry) {
      rejected.push({ key: write.key, error: scopeError ?? `Unknown setting "${write.key}".` })
      continue
    }
    const validation = validateSettingValue(entry, write.value)
    if (!validation.ok) {
      rejected.push({ key: write.key, error: validation.error })
      continue
    }
    accepted.push({ key: write.key, value: validation.value })
  }

  return { accepted, rejected }
}
