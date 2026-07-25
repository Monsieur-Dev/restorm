import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Tooltip } from 'electron-core-ui/renderer'
import type { Environment } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import { useExclusiveHeaderPopover } from '../../hooks/useExclusiveHeaderPopover'
import {
  clearSessionRequestOverridesForRequests,
  clearStoredRequestOverridesForRequests,
  findEnvironmentById
} from '../../services/environmentSelectionStore'
import { EnvPopoverList } from './EnvSelectorPopover'
import { DEFAULT_ENV_COLOR, flattenEnvironments } from './envSelectorHelpers'

export interface RequestHeaderEnvSelectorProps {
  /** Every request id under the active request's env folder — used to
   * wipe siblings' stale per-request overrides when the user picks an
   * env with "Apply to all" on (mirrors the statusbar selector). */
  folderRequestIds: string[]
  /** Project UUID of the open file, scoping the override cleanup. */
  projectUuid?: string | null
}

/**
 * Request tab-header counterpart of the (removed) statusbar environment
 * selector: a coloured pill showing the active env's icon + name that
 * opens the shared `EnvPopoverList` BELOW the button. Must be rendered
 * inside the request's `EnvironmentProvider` — `useEnvironmentContext`
 * supplies the env list + selection + colour + setters.
 */
export const RequestHeaderEnvSelector: React.FC<RequestHeaderEnvSelectorProps> = ({
  folderRequestIds,
  projectUuid
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
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const anchorRef = useRef<HTMLSpanElement>(null)

  // Opening this popover closes any sibling header popover (and vice versa).
  useExclusiveHeaderPopover(open, useCallback(() => { setOpen(false) }, []))

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

  // Dismiss the popover on any outside click.
  useEffect(() => {
    if (!open) return undefined
    const onDocMouseDown = (e: MouseEvent): void => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as globalThis.Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => { document.removeEventListener('mousedown', onDocMouseDown) }
  }, [open])

  if (!environments || environments.length === 0) return null

  const effectiveColor = envColor ?? DEFAULT_ENV_COLOR

  return (
    <span
      ref={anchorRef}
      className="request-header-env-selector"
      onMouseEnter={() => { setHover(true) }}
      onMouseLeave={() => { setHover(false) }}
      onMouseDown={(e) => { e.stopPropagation() }}
    >
      <Button
        align="left"
        backgroundColor={effectiveColor}
        {...(selectedEnvironment?.icon ? { icon: selectedEnvironment.icon } : {})}
        className="request-header-env-button"
        onClick={() => { setOpen((v) => !v) }}
        data-testid="request-header-env-selector"
      >
        {selectedName}
      </Button>
      <Tooltip
        targetRef={anchorRef}
        show={hover && !open}
        placement="below"
        data-testid="request-header-env-tooltip"
        content={<span className="header-hover-tooltip-label">{t('requestTab.environmentSelector.switchTooltip')}</span>}
      />
      <Tooltip
        targetRef={anchorRef}
        show={open}
        placement="below"
        data-testid="request-header-env-popover"
        content={
          <div className="request-header-env-popover" onMouseDown={(e) => { e.stopPropagation() }}>
            <EnvPopoverList
              rows={flatRows}
              selectedEnvId={selectedEnvId}
              applyToAll={applyToAll}
              onApplyToAllChange={setApplyToAll}
              onSelect={handleSelect}
              onCloseRequested={() => { setOpen(false) }}
            />
          </div>
        }
      />
    </span>
  )
}

export default RequestHeaderEnvSelector
