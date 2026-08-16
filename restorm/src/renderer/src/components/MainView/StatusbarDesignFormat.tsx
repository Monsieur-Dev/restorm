import React from 'react'
import { useTranslation } from 'react-i18next'
import { StatusbarElement } from 'electron-core-ui/renderer'
import { DESIGN_FILE_FORMAT_VERSION } from '../../../../shared/config/fileFormatVersion'

/**
 * Bottom-right "design · format 1.1" cell — shown only while the
 * focused workbench tab is a Design tab, as a quiet reminder that the
 * open project persists at the design file format. Rendered AFTER the
 * `rightAligned` MCP indicator (never `rightAligned` itself: that
 * auto-margin slot is single-occupancy).
 */
export const StatusbarDesignFormat: React.FC<{ visible: boolean }> = ({ visible }) => {
  const { t } = useTranslation()
  if (!visible) return null
  return (
    <StatusbarElement
      title={t('design.statusbar.format', 'design · format {{version}}', { version: String(DESIGN_FILE_FORMAT_VERSION) })}
      data-testid="app-statusbar-design-format"
    />
  )
}
