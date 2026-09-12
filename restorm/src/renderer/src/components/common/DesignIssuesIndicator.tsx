import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconView } from 'electron-core-ui/renderer'
import { useFolderDesignIssues } from '../../services/folderDesignIssuesStore'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import './DesignIssuesIndicator.css'

/** The design-issues glyph: a Phosphor exclamation mark, warning colour — kept
 * visually distinct from the red secret-error badge that may sit beside it. */
const DESIGN_ISSUE_ICON = { type: 'phosphor', value: 'ExclamationMark' } as const

export interface DesignIssuesIndicatorProps {
  /** The env-folder ("API") whose background design-validation drives the badge. */
  folderId: string
  style?: React.CSSProperties
  'data-testid'?: string
}

/**
 * A small "!" shown on an API env-folder's sidebar row when the background
 * `validateApiDesign` pass found at least one problem in its projected design.
 * Renders nothing when the design is clean, so it reserves no space on healthy
 * APIs. The count is surfaced in the hover tooltip; the full list lives in the
 * env-folder's "Issues" tab.
 */
export const DesignIssuesIndicator: React.FC<DesignIssuesIndicatorProps> = ({
  folderId,
  style,
  'data-testid': dataTestId
}) => {
  const { t } = useTranslation()
  const issues = useFolderDesignIssues(folderId)
  if (issues.length === 0) return null
  return (
    <HeaderHoverTooltip label={t('design.issuesList.badgeTooltip', { count: issues.length })}>
      <span
        className="design-issues-indicator"
        role="img"
        aria-label={t('design.issuesList.badgeAria')}
        style={style}
        {...(dataTestId ? { 'data-testid': dataTestId } : { 'data-testid': `design-issues-indicator-${folderId}` })}
      >
        <IconView icon={DESIGN_ISSUE_ICON} size={14} />
      </span>
    </HeaderHoverTooltip>
  )
}
