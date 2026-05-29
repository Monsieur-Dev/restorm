import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Tooltip, getContrastColor } from 'electron-core-ui/renderer'
import { EnvironmentValue } from '../../../../shared/types/collections'
import { EnvPopoverList } from '../MainView/EnvSelectorPopover'
import { DEFAULT_ENV_COLOR } from '../MainView/envSelectorHelpers'
import { useAllEnvironments } from '../../hooks/useAllEnvironments'

export interface EnvironmentValueCellProps {
  value: EnvironmentValue
  onChange: (next: EnvironmentValue) => void
  dataTestId?: string | undefined
}

/**
 * The `environment` value widget: a coloured button (env colour + icon + name)
 * that opens the shared env-selection popover, listing *every* environment
 * across *all* environment folders (not scoped to one folder). Picking an env
 * stores its globally-unique id on the {@link EnvironmentValue}. Replaces the
 * plain text field on the left of the type control group.
 */
export const EnvironmentValueCell: React.FC<EnvironmentValueCellProps> = ({ value, onChange, dataTestId }) => {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const rows = useAllEnvironments()
  const envId = value.value || null
  const selected = useMemo(() => rows.find((r) => r.env.id === envId)?.env ?? null, [rows, envId])
  const color = selected?.color ?? DEFAULT_ENV_COLOR

  // Dismiss on outside pointer-down; the popover is portalled, so guard the
  // listbox subtree too. Capture phase so a host that swallows mousedown (the
  // React Flow graph pane) can't keep it open. Mirrors EnvButtonCell.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (anchorRef.current?.contains(t)) return
      if (document.querySelector('[data-testid="tvf-env-selector-listview"]')?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => { document.removeEventListener('mousedown', onDown, true) }
  }, [open])

  return (
    <div ref={anchorRef} className="tvf-env-button nodrag">
      <Button
        fullWidth
        align="center"
        backgroundColor={color}
        style={{ color: getContrastColor(color) }}
        {...(selected?.icon ? { icon: selected.icon } : {})}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        {...(dataTestId && { 'data-testid': `${dataTestId}-value-input-environment` })}
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
            onApplyToAllChange={() => { /* single-target selection */ }}
            hideApplyToAll
            onSelect={(id) => { onChange(new EnvironmentValue(id)) }}
            onCloseRequested={() => { setOpen(false) }}
            testIdPrefix="tvf-env-selector"
          />
        )}
      />
    </div>
  )
}

export default EnvironmentValueCell
