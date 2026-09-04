import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Tooltip } from 'electron-core-ui/renderer'
import type { Environment } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import { useExclusiveHeaderPopover } from '../../hooks/useExclusiveHeaderPopover'
import { findEnvironmentById } from '../../services/environmentSelectionStore'
import { EnvPopoverList } from './EnvSelectorPopover'
import { DEFAULT_ENV_COLOR, flattenEnvironments } from './envSelectorHelpers'

/**
 * Design tab-header environment selector — the design's counterpart of
 * {@link RequestHeaderEnvSelector}. A coloured pill showing the active env's
 * icon + name that opens the shared {@link EnvPopoverList} below it. Must be
 * rendered inside the design's `EnvironmentProvider`
 * (`useEnvironmentContext` supplies the env list + selection + colour).
 *
 * A design has no child requests, so the selection is a per-design pick
 * (`setRequestOverride`, keyed by the design id in the persistence key) and
 * the "Apply to all requests" footer is hidden — unlike the request selector.
 */
export const DesignHeaderEnvSelector: React.FC = () => {
  const { t } = useTranslation()
  const { environments, selectedEnvId, envColor, setRequestOverride } = useEnvironmentContext()
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
    setRequestOverride(envId)
  }, [setRequestOverride])

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
        data-testid="design-header-env-selector"
      >
        {selectedName}
      </Button>
      <Tooltip
        targetRef={anchorRef}
        show={hover && !open}
        placement="below"
        data-testid="design-header-env-tooltip"
        content={<span className="header-hover-tooltip-label">{t('requestTab.environmentSelector.switchTooltip')}</span>}
      />
      <Tooltip
        targetRef={anchorRef}
        show={open}
        placement="below"
        data-testid="design-header-env-popover"
        content={
          <div className="request-header-env-popover" onMouseDown={(e) => { e.stopPropagation() }}>
            <EnvPopoverList
              rows={flatRows}
              selectedEnvId={selectedEnvId}
              applyToAll={false}
              onApplyToAllChange={() => { /* single-target: no apply-to-all */ }}
              onSelect={handleSelect}
              onCloseRequested={() => { setOpen(false) }}
              hideApplyToAll
              testIdPrefix="design-header-env-selector"
            />
          </div>
        }
      />
    </span>
  )
}
