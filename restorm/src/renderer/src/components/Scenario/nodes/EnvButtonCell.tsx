import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Tooltip, getContrastColor } from 'electron-core-ui/renderer'
import type { Environment } from '../../../../../shared/types/collections'
import { EnvPopoverList } from '../../MainView/EnvSelectorPopover'
import { DEFAULT_ENV_COLOR, flattenEnvironments } from '../../MainView/envSelectorHelpers'
import { findEnvironmentById } from '../../../services/environmentSelectionStore'

export interface EnvButtonCellProps {
  environments: Environment[]
  /** Default selection — the env currently selected for the bound request. */
  defaultEnvId: string | null
}

/**
 * The request node's environment picker: a coloured button (env colour +
 * icon + name) that opens the shared env-selection popover — the same list
 * the Send button's right-click shows. Selection is node-local for now
 * (defaults to the request's selected env); persistence lands with the
 * scenario config schema.
 */
export const EnvButtonCell: React.FC<EnvButtonCellProps> = ({ environments, defaultEnvId }) => {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [envId, setEnvId] = useState<string | null>(defaultEnvId)

  const selected = useMemo(() => (envId ? findEnvironmentById(environments, envId) : null), [environments, envId])
  const rows = useMemo(() => flattenEnvironments(environments), [environments])
  const color = selected?.color ?? DEFAULT_ENV_COLOR

  // Dismiss on outside pointer-down (the popover is portalled, so guard the
  // listbox subtree too) — mirrors the Send-button switcher.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (anchorRef.current?.contains(t)) return
      if (document.querySelector('[data-testid="scn-env-selector-listview"]')?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => { document.removeEventListener('mousedown', onDown, true) }
  }, [open])

  return (
    <div ref={anchorRef} className="scn-env-button nodrag">
      <Button
        small
        fullWidth
        align="center"
        backgroundColor={color}
        style={{ color: getContrastColor(color) }}
        {...(selected?.icon ? { icon: selected.icon } : {})}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
      >
        {selected?.name ?? '—'}
      </Button>
      <Tooltip
        targetRef={anchorRef}
        show={open}
        placement="below"
        content={(
          <EnvPopoverList
            rows={rows}
            selectedEnvId={envId}
            applyToAll={false}
            onApplyToAllChange={() => { /* node selection is single-target */ }}
            hideApplyToAll
            onSelect={(id) => { setEnvId(id) }}
            onCloseRequested={() => { setOpen(false) }}
            testIdPrefix="scn-env-selector"
          />
        )}
      />
    </div>
  )
}

export default EnvButtonCell
