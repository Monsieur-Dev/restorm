// ==========================================================================
// Setting Value Types
// ==========================================================================

/** Primitive value that a setting can hold */
export type SettingValue = string | number | boolean

// ==========================================================================
// Setting Params (type-specific configuration)
// ==========================================================================

export interface EnumValue {
  value: string
  labelKey: string
  /** Optional emoji/icon prefixed to the option label — currently used by
   * the language enum's flags. When absent, the option renders as label
   * text alone. */
  flag?: string | undefined
}

export interface EnumParams {
  values: EnumValue[]
}

export interface NumberParams {
  min?: number | undefined
  max?: number | undefined
  integer?: boolean | undefined
}

export interface TextParams {
  maxLength?: number | undefined
}

/** Union of all type-specific params */
export type SettingParams = EnumParams | NumberParams | TextParams | Record<string, unknown>

// ==========================================================================
// Setting Definition
// ==========================================================================

export interface SettingDefinition {
  id: string
  titleKey: string
  descriptionKey?: string | undefined
  type: string        // 'enum' | 'number' | 'text' | 'theme' | 'toggle' | custom
  default: SettingValue
  params?: SettingParams | undefined
  /** Feature flag name that gates this setting. When set, the setting is hidden from the UI if the feature is disabled. */
  feature?: string | undefined
  /** Default value to use when the associated feature is disabled. Required when `feature` is set. */
  featureDisabledDefault?: SettingValue | undefined
  /**
   * When `true`, the setting can only be edited at the user level — a
   * workspace `.restorm/settings.json` (or whatever the host wires) is
   * not allowed to override it. Useful for machine-identity values
   * like locale or, eventually, account credentials. Defaults to
   * `false`: every setting is workspace-overridable unless flagged.
   */
  userOnly?: boolean | undefined
  /**
   * Capability id that gates this setting via the host's entitlement
   * system — distinct from `feature` above (an environment-driven
   * feature flag that HIDES the setting when off). When set, and the
   * host's `SettingsProvider`/`ElectronCoreUiProvider` `capabilityGate`
   * prop reports it locked, the setting's control renders greyed through
   * `GatedControl` with an upsell instead of being hidden — a locked
   * setting stays VISIBLE, matching the rest of the app's "visible but
   * disabled" gating convention (`GatedControl`'s own contract).
   */
  capability?: string | undefined
}

// ==========================================================================
// Settings Group Hierarchy
// ==========================================================================

/** An item in a settings group: either a setting or a nested group */
export type SettingsGroupItem =
  | { setting: SettingDefinition }
  | { group: SettingsGroup }

export interface SettingsGroup {
  id: string
  titleKey: string
  items: SettingsGroupItem[]
}

// ==========================================================================
// YAML Configuration Root
// ==========================================================================

export interface SettingsYamlConfig {
  overrideDefaultGroups?: boolean | undefined
  groups: SettingsGroup[]
}

// ==========================================================================
// Resolved Setting (runtime, flattened)
// ==========================================================================

export interface ResolvedSetting extends SettingDefinition {
  /** Group path segments, e.g. ['appearance', 'editor'] */
  groupPath: string[]
  /** Storage key, e.g. 'appearance.editor:fontSize' */
  storageKey: string
  /** Current persisted value (or default if not set) */
  currentValue: SettingValue
  /** True if currentValue differs from default */
  isModified: boolean
}

/** Where a setting's effective value came from. Workspace beats user; user beats default. */
export type SettingValueSource = 'workspace' | 'user' | 'default'

export interface ResolvedSettingValue {
  storageKey: string
  /** The value the host should actually use. */
  effective: SettingValue
  /** Layer the effective value comes from. */
  source: SettingValueSource
  /** Set to `'workspace'` when both layers carry a value and workspace wins. */
  overriddenBy?: 'workspace'
}

// ==========================================================================
// Type Guards
// ==========================================================================

export function isSettingItem(item: SettingsGroupItem): item is { setting: SettingDefinition } {
  return 'setting' in item
}

export function isGroupItem(item: SettingsGroupItem): item is { group: SettingsGroup } {
  return 'group' in item
}

// ==========================================================================
// Storage keys
// ==========================================================================

/**
 * The canonical storage-key format: `<group1>.<group2>.<groupN>:<settingId>`
 * — a flat (single-level) group produces just `<groupId>:<settingId>`.
 * `SettingsService.buildStorageKey` (main process) delegates to this
 * exact function; any renderer code that needs to read/write a setting
 * outside the `useSetting()`/YAML-driven path (e.g. a host hook that
 * hardcodes a settings key, like `usePushModal.ts`'s Push-modal
 * settings) MUST use this too rather than re-deriving the format by
 * hand — a hand-rolled key that doesn't match what the registered YAML
 * setting resolves to silently reads/writes a DIFFERENT storage entry
 * than the one the visible Settings UI row uses.
 */
export function buildSettingsStorageKey(groupPath: string[], settingId: string): string {
  return groupPath.length > 0 ? `${groupPath.join('.')}:${settingId}` : settingId
}
