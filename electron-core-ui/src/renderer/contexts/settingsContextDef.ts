import { createContext } from 'react'
import type { SettingValue, SettingsGroup, ResolvedSetting } from '../../types/settings'

/**
 * Which layer the Settings UI is currently editing. The provider
 * loads data for both layers up-front; the consumer (SettingsView)
 * picks the right one based on the active tab.
 */
export type SettingsScope = 'user' | 'workspace'

export interface SettingsContextValue {
  groups: SettingsGroup[]
  settings: Map<string, ResolvedSetting>
  isLoading: boolean
  getSetting: (storageKey: string) => ResolvedSetting | undefined
  setSetting: (storageKey: string, value: SettingValue) => Promise<void>
  resetSetting: (storageKey: string) => Promise<void>
  searchQuery: string
  setSearchQuery: (query: string) => void
  filteredSettings: ResolvedSetting[]
  /** Currently-active workspace directory or `null` if none is open. */
  workspacePath: string | null
  /** Workspace overrides keyed by storageKey; empty when no workspace is active. */
  workspaceValues: Record<string, SettingValue>
  /** Upsert a workspace override. No-op when no workspace is active. */
  setWorkspaceSetting: (storageKey: string, value: SettingValue) => Promise<void>
  /** Drop a workspace override. No-op when no workspace is active. */
  resetWorkspaceSetting: (storageKey: string) => Promise<void>
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)
