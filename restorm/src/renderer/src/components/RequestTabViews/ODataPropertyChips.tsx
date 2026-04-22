/**
 * ODataPropertyChips — small helper row that lists known property
 * names as clickable chips. Click → invoke `onPick(name)` so the
 * parent builder can append it to the current value. Used under
 * $select / $orderby / $expand when the importer has pre-filled the
 * bound entity type's properties.
 */

import React, { type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'electron-core-ui/renderer'

const rowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  alignItems: 'center'
}
const labelStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--descriptionForeground)',
  marginRight: 4
}

export interface ODataPropertyChipsProps {
  properties: readonly string[]
  onPick: (name: string) => void
  /** Optional override for the prefix label. Defaults to
   * "Properties:". */
  label?: string
  testIdPrefix?: string
}

const ODataPropertyChipsBase: React.FC<ODataPropertyChipsProps> = ({ properties, onPick, label, testIdPrefix = 'odata-property-chip' }) => {
  const { t } = useTranslation()
  if (properties.length === 0) return null
  return (
    <div style={rowStyle} data-testid={`${testIdPrefix}-row`}>
      <span style={labelStyle}>
        {label ?? t('odataRequestTab.propertiesHint', 'Properties:')}
      </span>
      {properties.map((name) => (
        <Button
          key={name}
          small
          onClick={() => { onPick(name) }}
          options={{
            ariaLabel: t('odataRequestTab.propertyPickAria', { name }),
            title: t('odataRequestTab.propertyPickTitle', { name })
          }}
          data-testid={`${testIdPrefix}-${name}`}
        >
          {name}
        </Button>
      ))}
    </div>
  )
}

// Dynamics entities can carry 1000+ columns, one `<Button>` per chip —
// the row becomes the dominant cost of every parent re-render (each
// keystroke on `$filter` / `$select` ran the entire diff through
// thousands of Buttons). `React.memo` with a shallow props comparison
// is enough: `properties` is the reactive array-proxy on the
// `ODataRequest` (stable reference across renders), and the parent
// already `useCallback`-memoizes `onPick`.
export const ODataPropertyChips = React.memo(ODataPropertyChipsBase)
