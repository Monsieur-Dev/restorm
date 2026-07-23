import { useContext, createContext } from 'react'
import type { Icon } from 'electron-core-ui/types'
import type { Environment } from '../../../shared/types/collections'

export interface EnvironmentContextValue {
  environments?: Environment[] | undefined
  selectedEnvId: string | null
  tagColors?: Record<string, string> | undefined
  envColor?: string | undefined
  /** Icon of the active environment, when it defines one. Derived here rather
   * than re-resolved per consumer so every surface that paints the active env
   * (send disc, statusbar, …) reads the same value. */
  envIcon?: Icon | undefined
  /** Colour to PAINT the active environment with — `envColor` when the
   * environment defines one, the shared default when it does not, and
   * `undefined` when the project has no environments at all. This is what a
   * surface showing "the environment" should use; `envColor` alone renders
   * nothing for an environment that simply never picked a colour, which is why
   * the statusbar pill and the send disc would otherwise disagree. */
  envPaintColor?: string | undefined
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
