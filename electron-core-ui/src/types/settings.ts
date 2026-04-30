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
