/**
 * Read-only preview of the RESOLVED URL (Handlebars substituted main-side),
 * rendered directly under a request's URL field, with a copy button at the
 * end of the line.
 *
 * The row ALWAYS occupies its space, value or not — every request editor
 * shows the same silhouette, so switching protocols never shifts the layout.
 * It replaces the old hover tooltip on the URL container (and OData's local
 * pre-resolution preview): the resolution is visible at a glance instead of
 * hiding behind a hover.
 *
 * The `data-resolved-url` attribute carries the shown value for the e2e
 * suites that assert URL resolution (previously read off the tooltip host).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'electron-core-ui/renderer'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'

export interface ResolvedUrlPreviewProps {
  /** The resolved URL — empty string when nothing is resolved yet. */
  value: string
  /** Test id of the row; the copy button appends `-copy`. */
  'data-testid'?: string
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  marginTop: 4,
  // The reserved silhouette: the row keeps its height with no value.
  minHeight: 24
}

// A selectable LABEL, deliberately not styled like an input: the value is
// output, not something to edit — plain muted mono text whose characters can
// still be swept and copied by hand.
const valueStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontFamily: 'monospace',
  fontSize: 12,
  lineHeight: '22px',
  color: 'var(--descriptionForeground)',
  padding: '0 8px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  userSelect: 'text',
  cursor: 'text'
}

export const ResolvedUrlPreview: React.FC<ResolvedUrlPreviewProps> = ({
  value,
  'data-testid': dataTestId = 'url-resolved-preview'
}) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [hovered, setHovered] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current) }, [])

  const copy = useCallback((): void => {
    if (!value) return
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      if (resetTimer.current) clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => { setCopied(false) }, 1500)
    }).catch(() => {
      // clipboard denied — nothing sensible to surface
    })
  }, [value])

  const copyLabel = copied
    ? t('requestTab.resolvedUrlPreview.copied')
    : t('requestTab.resolvedUrlPreview.copy')

  return (
    <div
      style={rowStyle}
      data-testid={dataTestId}
      data-resolved-url={value}
      onMouseEnter={() => { setHovered(true) }}
      onMouseLeave={() => { setHovered(false) }}
    >
      <div style={valueStyle} title="">
        {value}
      </div>
      {/* The copy button only materialises while the pointer is over the
        * row — faded in/out, and inert while invisible so a blind click
        * where it hides never lands on it. */}
      <div style={{ flexShrink: 0, opacity: hovered ? 1 : 0, transition: 'opacity 150ms ease', pointerEvents: hovered ? 'auto' : 'none' }}>
        <HeaderHoverTooltip label={copyLabel} placement="below">
          <Button
            small
            secondary
            line
            icon={copied ? 'check' : 'copy'}
            disabled={value.length === 0}
            options={{ ariaLabel: copyLabel }}
            style={{ flexShrink: 0, padding: '0 4px' }}
            data-testid={`${dataTestId}-copy`}
            onClick={copy}
          />
        </HeaderHoverTooltip>
      </div>
    </div>
  )
}

export default ResolvedUrlPreview
