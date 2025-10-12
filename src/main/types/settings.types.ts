/**
 * Setting types supported by the settings system
 */
export enum SettingType {
  BOOLEAN = 'boolean',
  NUMBER = 'number',
  STRING = 'string',
  ENUM = 'enum',
  RANGE = 'range'
}

/**
 * Base setting definition interface
 */
interface BaseSettingDefinition {
  key: string
  name: string
  description: string
  defaultValue: unknown
}

/**
 * Boolean setting definition
 */
export interface BooleanSettingDefinition extends BaseSettingDefinition {
  type: SettingType.BOOLEAN
  defaultValue: boolean
}

/**
 * Number setting definition
 */
export interface NumberSettingDefinition extends BaseSettingDefinition {
  type: SettingType.NUMBER
  defaultValue: number
}

/**
 * String setting definition
 */
export interface StringSettingDefinition extends BaseSettingDefinition {
  type: SettingType.STRING
  defaultValue: string
}

/**
 * Enum setting definition
 */
export interface EnumSettingDefinition extends BaseSettingDefinition {
  type: SettingType.ENUM
  defaultValue: string
  options: string[]
}

/**
 * Range setting definition (slider)
 */
export interface RangeSettingDefinition extends BaseSettingDefinition {
  type: SettingType.RANGE
  defaultValue: number
  min: number
  max: number
  step?: number
}

/**
 * Union type for all setting definitions
 */
export type SettingDefinition =
  | BooleanSettingDefinition
  | NumberSettingDefinition
  | StringSettingDefinition
  | EnumSettingDefinition
  | RangeSettingDefinition

/**
 * Category containing subcategories or settings
 */
export interface SettingCategory {
  key: string
  name: string
  description?: string
  categories?: Record<string, SettingCategory>
  settings?: Record<string, SettingDefinition>
}

/**
 * Root settings schema structure
 */
export interface SettingsSchema {
  categories: Record<string, SettingCategory>
}

/**
 * Flattened setting with full path
 */
export interface FlattenedSetting extends SettingDefinition {
  fullPath: string
  categoryPath: string[]
}

