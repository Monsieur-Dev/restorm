import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  StatusbarElement,
  useStatusbarTooltip
} from 'electron-core-ui/renderer'
import type { Environment } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import {
  clearSessionRequestOverridesForRequests,
  clearStoredRequestOverridesForRequests,
  findEnvironmentById
} from '../../services/environmentSelectionStore'
import { EnvPopoverList } from './EnvSelectorPopover'
import { DEFAULT_ENV_COLOR, type FlatEnvRow, flattenEnvironments } from './envSelectorHelpers'

interface StatusbarEnvPopoverHostProps {
  rows: FlatEnvRow[]
  selectedEnvId: string | null
  applyToAll: boolean
  onApplyToAllChange: (next: boolean) => void
  onSelect: (envId: string) => void
}

/** Statusbar host for the env list. Wires `closeTooltip` from the
 * surrounding `StatusbarElement` into the shared `EnvPopoverList` so
 * the popover dismisses as soon as the user picks an env. `useStatusbarTooltip`
 * must run inside the StatusbarElement subtree — keeping this thin
 * wrapper here (rather than inlining at the call site) keeps that
 * subtree boundary explicit. */
const StatusbarEnvPopoverHost: React.FC<StatusbarEnvPopoverHostProps> = (props) => {
  const { closeTooltip } = useStatusbarTooltip()
  return <EnvPopoverList {...props} onCloseRequested={closeTooltip} />
}

export interface StatusbarEnvironmentSelectorProps {
  /**
   * All request ids under the same env folder as the active request
   * (incl. the active one). Passed in so that when the user picks
   * an env with "Apply to all" checked, we can wipe every sibling's
   * stale per-request override in one pass — the folder default is
   * now the source of truth for those requests.
   */
  folderRequestIds: string[]
  /** Project UUID of the currently-open file — used to scope the
   * override cleanup above. Optional because the store itself
   * no-ops when it's missing (in-memory-only mode). */
  projectUuid?: string | null
  /** When true (default), the StatusbarElement carries the
   * `right-aligned` class. App.tsx flips this off when an upstream
   * status-bar entry (e.g. the auth selector) already takes that
   * role — only the leftmost-of-the-right group needs the auto
   * margin, the rest follow naturally. */
  rightAligned?: boolean
}

/**
 * Statusbar cell that reflects the currently-selected environment for
 * the active request and opens a click-triggered popover (via
 * `StatusbarElement`'s built-in tooltip system, `tooltipTrigger="click"`)
 * to switch envs. Must be wrapped in an `EnvironmentProvider` scoped
 * to the active request — `useEnvironmentContext` supplies the env
 * list + current selection + color + setters.
 */
export const StatusbarEnvironmentSelector: React.FC<StatusbarEnvironmentSelectorProps> = ({
  folderRequestIds,
  projectUuid,
  rightAligned = true
}) => {
  const { t } = useTranslation()
  const {
    environments,
    selectedEnvId,
    envColor,
    setFolderEnv,
    setRequestOverride
  } = useEnvironmentContext()
  const [applyToAll, setApplyToAll] = useState(true)

  const selectedEnvironment = useMemo<Environment | null>(() => {
    if (!environments || !selectedEnvId) return null
    return findEnvironmentById(environments, selectedEnvId)
  }, [environments, selectedEnvId])

  const selectedName = selectedEnvironment?.name ?? t('requestTab.environmentSelector.noEnvironment')

  const flatRows = useMemo(() => (
    environments && environments.length > 0 ? flattenEnvironments(environments) : []
  ), [environments])

  const handleSelect = useCallback((envId: string): void => {
    if (applyToAll) {
      // Wipe every sibling's *session* override synchronously BEFORE
      // `setFolderEnv` fires `ENV_FOLDER_ENV_CHANGED`. Otherwise a
      // sibling provider re-resolving on that event would still read
      // its stale override from the session cache and ignore the
      // fresh folder default. The disk cleanup can fall through to
      // its own async path since it only matters on next mount.
      if (projectUuid && folderRequestIds.length > 0) {
        clearSessionRequestOverridesForRequests(projectUuid, folderRequestIds)
      }
      setFolderEnv(envId)
      if (projectUuid && folderRequestIds.length > 0) {
        void clearStoredRequestOverridesForRequests(projectUuid, folderRequestIds)
      }
    } else {
      setRequestOverride(envId)
    }
  }, [applyToAll, projectUuid, folderRequestIds, setFolderEnv, setRequestOverride])

  if (!environments || environments.length === 0) return null

  const effectiveColor = envColor ?? DEFAULT_ENV_COLOR

  return (
    <StatusbarElement
      data-testid="statusbar-env-selector"
      className={rightAligned ? 'right-aligned' : ''}
      {...(selectedEnvironment?.icon ? { icon: selectedEnvironment.icon } : {})}
      backgroundColor={effectiveColor}
      title={selectedName}
      tooltipTrigger="click"
      tooltipPlacement="above"
    >
      <StatusbarEnvPopoverHost
        rows={flatRows}
        selectedEnvId={selectedEnvId}
        applyToAll={applyToAll}
        onApplyToAllChange={setApplyToAll}
        onSelect={handleSelect}
      />
    </StatusbarElement>
  )
}

export default StatusbarEnvironmentSelector
