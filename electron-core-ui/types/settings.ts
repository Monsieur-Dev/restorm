export interface SettingOption {
  label: string
  value: string | number | boolean
}

export interface SettingDefinition {
  type: 'string' | 'boolean' | 'number' | 'select' | 'multiselect' | 'object' | 'array'
  title: string
  description?: string
  default?: string | number | boolean | unknown[] | Record<string, unknown>
  enum?: string[]
  enumDescriptions?: string[]
  options?: SettingOption[]
  items?: {
    type: string
    properties?: Record<string, SettingDefinition>
  }
  properties?: Record<string, SettingDefinition>
  minimum?: number
  maximum?: number
  pattern?: string
  format?: string
}

export interface SettingCategory {
  key: string
  name: string
  description?: string
  settings?: Record<string, SettingDefinition>
  categories?: Record<string, SettingCategory>
}

export interface SettingsSchema {
  title?: string
  description?: string
  categories: Record<string, SettingCategory>
}
