import { createContext } from 'react'
import type { SettingValue, SettingsGroup, ResolvedSetting } from '../../types/settings'

/**
 * Which layer the Settings UI is currently editing. The provider
 * loads data for both layers up-front; the consumer (SettingsView)
 * picks the right one based on the active tab.
 */
export type SettingsScope = 'user' | 'workspace'

/**
 * Injection point for capability-gated settings (`SettingDefinition.
 * capability`) — ECUI has no notion of the host's entitlement/auth
 * system, so the host supplies both halves: whether a capability is
 * currently locked, and what to do when the user clicks the upsell's
 * "Subscribe" link. Passed through `ElectronCoreUiProvider`/
 * `SettingsProvider`; omit it entirely for a host with no capability
 * concept (every `capability`-tagged setting then just renders
 * unlocked, since there's nothing to check against).
 */
export interface CapabilityGate {
  isLocked: (capability: string) => boolean
  onSubscribe: () => void
}

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
  /** See {@link CapabilityGate}. `undefined` when the host doesn't wire one. */
  capabilityGate?: CapabilityGate | undefined
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)
