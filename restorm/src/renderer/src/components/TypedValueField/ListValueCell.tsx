import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, InputBox, ScrollableElement, Tooltip } from 'electron-core-ui/renderer'
import { ListValue, StringValue, type ValueType } from '../../../../shared/types/collections'
import type { EnvValueTypeGroup } from '../../hooks/collectEnvValueTypeGroups'
import { TypedValueField } from './TypedValueField'

interface ListValueCellProps {
  value: ListValue
  onChange: (next: ValueType) => void
  valueTypeGroups?: EnvValueTypeGroup[] | undefined
  /** Forwarded to each row so a list inside a `setVariable` can't reference the
   * variable it itself declares (direct self-reference). */
  excludeVariableName?: string | undefined
  dataTestId?: string | undefined
}

/**
 * The editor cell for a `ListValue`: a read-only preview field (the items'
 * display, ellipsised) and a pencil button that opens the ECUI popover. The
 * popover lists each item as its OWN unrestricted `TypedValueField` (so a row
 * can be a string, number, variable, environment… or another list — nesting
 * opens a further popover) inside a bounded-height ECUI `ScrollableElement`,
 * with a "+" to append a row and a remove on each.
 *
 * Items are kept as `ValueType[]` on the `ListValue`; the owning node serialises
 * the whole list recursively on persist.
 */
export const ListValueCell: React.FC<ListValueCellProps> = ({ value, onChange, valueTypeGroups, excludeVariableName, dataTestId }) => {
  const { t } = useTranslation()
  const anchorRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const items = value.items

  const setItems = useCallback((next: ValueType[]): void => { onChange(new ListValue(next)) }, [onChange])

  // Dismiss on outside pointer-down; the popover is portalled by the Tooltip,
  // so guard its subtree too. Capture phase so the React Flow pane can't keep
  // it open. Mirrors EnvironmentValueCell.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e: MouseEvent): void => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (anchorRef.current?.contains(t)) return
      if (document.querySelector('[data-testid="tvf-list-popover"]')?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => { document.removeEventListener('mousedown', onDown, true) }
  }, [open])

  const preview = items.length === 0 ? '—' : value.toString()

  return (
    <div ref={anchorRef} className="tvf-list-cell nodrag" style={{ display: 'flex', flex: 1, minWidth: 0 }}>
      <InputBox
        value={preview}
        options={{ type: 'text' }}
        disabled
        {...(dataTestId && { 'data-testid': `${dataTestId}-value-input-list` })}
      />
      <Button
        secondary
        medium
        icon="edit"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        options={{ ariaLabel: t('typedValue.list.edit', 'Edit list') }}
        {...(dataTestId && { 'data-testid': `${dataTestId}-list-edit-button` })}
      />
      <Tooltip
        targetRef={anchorRef}
        show={open}
        placement="below"
        content={(
          <div
            data-testid="tvf-list-popover"
            className="tvf-list-popover nodrag"
            onMouseDown={(e) => { e.stopPropagation() }}
            style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 320 }}
          >
            <ScrollableElement options={{ horizontal: 'hidden' }} style={{ maxHeight: '40vh' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 4 }}>
                {items.length === 0 && (
                  <div className="tvf-list-empty" style={{ opacity: 0.6, fontSize: 12, padding: '2px 0' }}>—</div>
                )}
                {items.map((it, i) => (
                  <div key={i} className="tvf-list-row nodrag">
                    <TypedValueField
                      value={it}
                      onChange={(next) => { const n = items.slice(); n[i] = next; setItems(n) }}
                      onRemove={() => { setItems(items.filter((_, j) => j !== i)) }}
                      allowEnvironment
                      allowNull
                      allowList
                      allowAllVariables
                      {...(valueTypeGroups ? { valueTypeGroups } : {})}
                      {...(excludeVariableName ? { excludeVariableName } : {})}
                      {...(dataTestId && { dataTestId: `${dataTestId}-list-item-${i}` })}
                    />
                  </div>
                ))}
              </div>
            </ScrollableElement>
            <div className="tvf-list-add-row">
              <Button
                small
                secondary
                icon="add"
                onClick={() => { setItems([...items, new StringValue('')]) }}
                options={{ ariaLabel: t('typedValue.list.add', 'Add value'), title: t('typedValue.list.add', 'Add value') }}
                {...(dataTestId && { 'data-testid': `${dataTestId}-list-add` })}
              />
            </div>
          </div>
        )}
      />
    </div>
  )
}
