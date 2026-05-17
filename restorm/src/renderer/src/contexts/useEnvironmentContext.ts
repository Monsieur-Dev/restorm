import { useContext, createContext } from 'react'
import type { Environment } from '../../../shared/types/collections'

export interface EnvironmentContextValue {
  environments?: Environment[] | undefined
  selectedEnvId: string | null
  tagColors?: Record<string, string> | undefined
  envColor?: string | undefined
  /** Project UUID that owns the env-folder selected by
   * `persistenceKey.projectUuid` (mirrored here so callers like
   * `SendButtonEnvSwitcher` can run sibling-override cleanup without
   * a separate prop). `undefined` in in-memory-only mode. */
  projectUuid?: string | undefined
  /** Every request id under the env folder this provider serves —
   * including the request the provider was instantiated for. Used
   * by the popover hosts to wipe stale per-request overrides on
   * sibling requests when the user picks an env with "Apply to all"
   * on. Empty / undefined when the host couldn't enumerate them
   * (e.g. folder tabs without a request scope). */
  folderRequestIds?: string[] | undefined
  /** Write the env-folder default. Callers should also clear any
   * per-request overrides for sibling requests they know about. */
  setFolderEnv: (envId: string) => void
  /** Write a per-request override. Pass `null` to clear. */
  setRequestOverride: (envId: string | null) => void
}

export const EnvironmentContext = createContext<EnvironmentContextValue | undefined>(undefined)

export function useEnvironmentContext(): EnvironmentContextValue {
  const ctx = useContext(EnvironmentContext)
  if (!ctx) {
    throw new Error('useEnvironmentContext must be used within an EnvironmentProvider')
  }
  return ctx
}

/** Non-throwing variant: returns `null` when no provider is mounted.
 * Used by components that ship in both "scoped to a request" and
 * "context-free" surfaces — e.g. the Send-button env switcher
 * appears inside the workbench's per-request `<EnvironmentProvider>`
 * AND inside `AuthenticationSetupModal`, which renders the
 * `LocalAuthenticationRequestForm` as a self-contained ephemeral
 * form with no env scope. The strict throw breaks the modal; the
 * optional variant lets the host disable its env-related side
 * effects gracefully. */
export function useOptionalEnvironmentContext(): EnvironmentContextValue | null {
  return useContext(EnvironmentContext) ?? null
}
