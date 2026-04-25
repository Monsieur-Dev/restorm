/**
 * ODataPropertyChips — compact property picker shown next to $select
 * / $expand / $orderby editors. The importer pre-fills the bound
 * entity type's property list; each pick calls `onPick(name)` so the
 * parent editor can append / integrate it.
 *
 * Internally the picker uses `MultiSelectCombo`:
 *   - Closed (default): a single trigger element, zero cost per
 *     parent re-render. Critical when the imported entity carries
 *     1000+ columns — the earlier `<Button>` grid sat on screen all
 *     the time and reconciling it on every keystroke in a sibling
 *     input made the whole tab unusable.
 *   - Open: the dropdown portals into a scrollable popover and only
 *     materialises the option rows while the user is actively picking.
 *
 * Semantic stays "append on pick": the combo's selected state lives
 * inside the picker (`pickedValues`), onChange diffs old vs. new to
 * fire `onPick` for each newly-toggled-on value. Deselecting in the
 * combo doesn't touch the parent (the contract doesn't expose a
 * removal hook); the state is there solely so checkboxes reflect
 * what the user has clicked during the current session.
 */

import React, { type CSSProperties, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MultiSelectCombo } from 'electron-core-ui/renderer'

const rowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center'
}
const labelStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--descriptionForeground)',
  whiteSpace: 'nowrap'
}
const comboWrapStyle: CSSProperties = {
  flex: 1,
  minWidth: 0
}

export interface ODataPropertyChipsProps {
  properties: readonly string[]
  onPick: (name: string) => void
  /** Optional override for the prefix label. Defaults to "Properties:". */
  label?: string
  testIdPrefix?: string
}

const ODataPropertyChipsBase: React.FC<ODataPropertyChipsProps> = ({ properties, onPick, label, testIdPrefix = 'odata-property-chip' }) => {
  const { t } = useTranslation()
  const [pickedValues, setPickedValues] = useState<string[]>([])

  // Sort alphabetically (case-insensitive, locale-aware) so the dropdown
  // surfaces properties in a predictable order regardless of the order
  // the importer happened to emit them. `slice()` keeps the parent's
  // array intact — sorting in place would mutate the request's
  // `entitySetProperties` / `navigationProperties` arrays.
  const options = useMemo(
    () => properties
      .slice()
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map((name) => ({ value: name, label: name })),
    [properties]
  )

  const handleChange = useCallback((next: string[]) => {
    const prev = pickedValues
    for (const name of next) {
      if (!prev.includes(name)) onPick(name)
    }
    setPickedValues(next)
  }, [pickedValues, onPick])

  if (properties.length === 0) return null

  const effectiveLabel = label ?? t('odataRequestTab.propertiesHint', 'Properties:')

  return (
    <div style={rowStyle} data-testid={`${testIdPrefix}-row`}>
      <span style={labelStyle}>{effectiveLabel}</span>
      <div style={comboWrapStyle}>
        <MultiSelectCombo
          options={options}
          selected={pickedValues}
          onChange={handleChange}
          placeholder={t('odataRequestTab.propertyPickerPlaceholder', 'Pick a property…')}
          data-testid={testIdPrefix}
        />
      </div>
    </div>
  )
}

export const ODataPropertyChips = React.memo(ODataPropertyChipsBase)
