/**
 * "+ override field" affordance for a KV override section (headers / params /
 * path params). A scenario action may need to override a field the bound request
 * doesn't pre-define (e.g. add a header only for this run) — this lets the user
 * name a new key, which then appears as its own override port row.
 *
 * The trigger is a CODICON-ONLY small button (a small ECUI button can't hold
 * text — it clips), labelled via an ECUI Tooltip. Clicking it reveals a small
 * inline key input; Enter / the confirm codicon adds the key.
 */

import React, { useState, useRef, useCallback } from 'react'
import { Button, InputBox } from 'electron-core-ui/renderer'
import { HeaderHoverTooltip } from '../../MainView/HeaderHoverTooltip'

export interface OverrideFieldAdderProps {
  tooltip: string
  existingKeys: string[]
  onAdd: (key: string) => void
  dataTestId?: string
}

export const OverrideFieldAdder: React.FC<OverrideFieldAdderProps> = ({ tooltip, existingKeys, onAdd, dataTestId }) => {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const commit = useCallback((): void => {
    const trimmed = (inputRef.current?.value ?? key).trim()
    if (trimmed === '' || existingKeys.includes(trimmed)) { setOpen(false); setKey(''); return }
    onAdd(trimmed)
    setKey('')
    setOpen(false)
  }, [key, existingKeys, onAdd])

  if (!open) {
    return (
      <HeaderHoverTooltip label={tooltip} placement="below">
        <Button
          secondary
          small
          line
          icon="add"
          options={{ ariaLabel: tooltip }}
          {...(dataTestId ? { 'data-testid': dataTestId } : {})}
          onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        />
      </HeaderHoverTooltip>
    )
  }

  return (
    <div
      className="nodrag"
      onMouseDown={(e) => { e.stopPropagation() }}
      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <InputBox
          value={key}
          onChange={setKey}
          changeDebounceMs={0}
          inputRef={inputRef}
          options={{ placeholder: tooltip, ariaLabel: tooltip }}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') { setOpen(false); setKey('') }
          }}
          {...(dataTestId ? { 'data-testid': `${dataTestId}-input` } : {})}
        />
      </div>
      <Button
        small
        icon="check"
        options={{ ariaLabel: tooltip }}
        {...(dataTestId ? { 'data-testid': `${dataTestId}-confirm` } : {})}
        onClick={(e) => { e.stopPropagation(); commit() }}
      />
    </div>
  )
}

export default OverrideFieldAdder
