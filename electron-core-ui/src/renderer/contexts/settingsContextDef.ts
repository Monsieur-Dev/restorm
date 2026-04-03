import { createContext } from 'react'
import type { ComponentType } from 'react'
import type { SettingValue, SettingsGroup, ResolvedSetting } from '../../types/settings'
import type { SettingRendererProps } from '../components/Settings/renderers/types'

export interface SettingsContextValue {
  groups: SettingsGroup[]
  settings: Map<string, ResolvedSetting>
  renderers: Record<string, string>
  customRenderers: Record<string, ComponentType<SettingRendererProps>>
  isLoading: boolean
  getSetting: (storageKey: string) => ResolvedSetting | undefined
  setSetting: (storageKey: string, value: SettingValue) => Promise<void>
  resetSetting: (storageKey: string) => Promise<void>
  searchQuery: string
  setSearchQuery: (query: string) => void
  filteredSettings: ResolvedSetting[]
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)
