import React from 'react'
import { useTranslation } from 'react-i18next'
import { Callout } from 'electron-core-ui/renderer'
import type { DesignIssue } from '../../../../shared/design/validateApiDesign'

/**
 * Entity-level validation errors surfaced as a stack of error callouts at the
 * top of a model / enum / route(-group) detail pane. Only the issues whose id
 * path ENDS at this entity are shown (a name collision, a duplicate, an empty
 * name, a dangling reference the entity itself carries) — the sub-rows
 * (properties, params, responses) surface their own inline errors, so listing
 * them here too would double up.
 */
export const DesignIssuesCallout: React.FC<{ issues: readonly DesignIssue[]; entityId: string }> = ({ issues, entityId }) => {
  const { t } = useTranslation()
  const mine = issues.filter((iss) => iss.path[iss.path.length - 1] === entityId)
  if (mine.length === 0) return null
  return (
    <div className="design-entity-issues-callout" data-testid="design-entity-issues-callout">
      {mine.map((iss, i) => {
        const label = t(`design.issue.${iss.code}`, iss.code)
        const message = iss.subject !== undefined && iss.subject !== '' ? `${label} — ${iss.subject}` : label
        return <Callout key={`${iss.code}-${i}`} variant="error" message={message} />
      })}
    </div>
  )
}
