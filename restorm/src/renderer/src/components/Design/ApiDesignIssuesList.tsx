import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Callout } from 'electron-core-ui/renderer'
import type { DesignIssueView } from '../../../../shared/design/describeDesignIssue'
import { designPathForDisplay } from '../../../../shared/design/describeDesignIssue'
import { specPathToRestorm } from '../../../../shared/design/designFromDocumentation'
import { httpBadgeIdFor } from '../../../../shared/utils/httpMethod'
import type { ApiDocumentation, OperationDocumentation } from '../../../../shared/types/apiDocumentation'
import { RegistryBadge } from '../common/RegistryBadge'
import { DocumentationHost } from '../documentation/DocumentationHost'
import './ApiDesignIssuesList.css'

/** One concrete offender under a problem group — deduped by its label. */
interface Offender {
  key: string
  label: string
  route?: { method: string; pattern: string }
}

/** Match a route issue back to its documentation operation. Two routes can
 * share a normalized surface (the whole point of a duplicate-path issue), so we
 * match on the EXACT restorm-normalized pattern + method, never a fuzzy path. */
function findOperation(apiDoc: ApiDocumentation, route: { method: string; pattern: string }): OperationDocumentation | undefined {
  const method = route.method.toUpperCase()
  return apiDoc.operations.find((op) => {
    const opMethod = (op.match.method ?? 'GET').toUpperCase()
    return opMethod === method && specPathToRestorm(op.match.urlPattern) === route.pattern
  })
}

/**
 * One offender row. A route renders as an accordion: a verb badge + the real
 * path, and — when the API's documentation is available — expands to that
 * route's documentation slice (the same `DocumentationHost` the request Doc tab
 * uses). A non-route entity (a model/enum name, a property) renders as a plain
 * labelled row.
 */
const OffenderRow: React.FC<{ offender: Offender; apiDocumentation?: ApiDocumentation | undefined }> = ({ offender, apiDocumentation }) => {
  const [expanded, setExpanded] = useState(false)
  const route = offender.route
  const operation = useMemo(() => (
    route !== undefined && apiDocumentation !== undefined
      ? findOperation(apiDocumentation, route)
      : undefined
  ), [route, apiDocumentation])

  // A route-scoped documentation: narrow the operations to the matched one so
  // the (fuzzy) route filter can only resolve to it, then let the slice grow the
  // model closure normally.
  const scopedDoc = useMemo<ApiDocumentation | undefined>(() => (
    apiDocumentation !== undefined && operation !== undefined
      ? { ...apiDocumentation, operations: [operation] }
      : undefined
  ), [apiDocumentation, operation])

  // With a verb badge the method is already shown — render only the path so it
  // doesn't read "GET GET /items/{id}".
  const header = (
    <>
      {route !== undefined && (
        <RegistryBadge badgeId={httpBadgeIdFor(route.method)} text={route.method} />
      )}
      <span className="api-design-offender-label">{route !== undefined ? designPathForDisplay(route.pattern) : offender.label}</span>
    </>
  )

  // Only a route whose operation resolved can expand to a documentation slice.
  if (route === undefined || scopedDoc === undefined) {
    return <div className="api-design-offender-row api-design-offender-static">{header}</div>
  }

  return (
    <div className="api-design-offender-row">
      <button
        type="button"
        className="api-design-offender-toggle"
        aria-expanded={expanded}
        onClick={() => { setExpanded((v) => !v) }}
        data-testid={`api-design-offender-${offender.key}`}
      >
        <span className={`codicon codicon-chevron-${expanded ? 'down' : 'right'} api-design-offender-chevron`} aria-hidden="true" />
        {header}
      </button>
      {expanded && (
        <div className="api-design-offender-doc">
          <DocumentationHost
            apiDocumentation={scopedDoc}
            filters={[{ type: 'http', method: route.method, url: designPathForDisplay(route.pattern) }]}
            showRouteMatchLine={false}
            testId={`api-design-offender-doc-${offender.key}`}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Read-only rendering of the API-design issues found by `validateApiDesign` for
 * one API. Issues are grouped by their `code` (the problem TYPE) so a design
 * with twenty duplicate routes reads as one row with a count; within a group,
 * every concrete offender is listed — a route as an expandable accordion that
 * reveals its documentation, other entities as a labelled row.
 *
 * Self-contained (issues + optional documentation + i18n) so it can be reused
 * as-is: today inside the env-folder "Issues" tab, later inside a post-import
 * recap modal.
 */
export const ApiDesignIssuesList: React.FC<{
  issues: readonly DesignIssueView[]
  apiDocumentation?: ApiDocumentation | undefined
}> = ({ issues, apiDocumentation }) => {
  const { t } = useTranslation()
  if (issues.length === 0) return null

  // Group by problem type, preserving first-seen order for a stable list.
  const order: string[] = []
  const byCode = new Map<string, DesignIssueView[]>()
  for (const issue of issues) {
    const bucket = byCode.get(issue.code)
    if (bucket === undefined) {
      order.push(issue.code)
      byCode.set(issue.code, [issue])
    } else {
      bucket.push(issue)
    }
  }

  return (
    <div className="api-design-issues-list" data-testid="api-design-issues-list">
      <div className="api-design-issues-list-callout">
        <Callout variant="warning" message={t('design.issuesList.intro')} />
      </div>
      <ul className="api-design-issues-groups">
        {order.map((code) => {
          const group = byCode.get(code) ?? []
          // Aggregate, list-context wording (e.g. "Several routes answer the
          // same method and path"), NOT the designer's per-entity phrasing.
          const label = t(`design.issuesList.code.${code}`, code)
          // Distinct offenders — a route by its pattern+method, others by label.
          const offenders: Offender[] = []
          const seen = new Set<string>()
          for (const iss of group) {
            const key = iss.route !== undefined
              ? `${iss.route.method} ${iss.route.pattern}`
              : (iss.subjectLabel ?? iss.subject ?? '')
            if (key === '' || seen.has(key)) continue
            seen.add(key)
            offenders.push({
              key: key.replace(/[^A-Za-z0-9]+/g, '-'),
              label: iss.subjectLabel ?? iss.subject ?? key,
              ...(iss.route !== undefined ? { route: iss.route } : {})
            })
          }
          return (
            <li key={code} className="api-design-issue-group" data-testid={`api-design-issue-group-${code}`}>
              <div className="api-design-issue-group-header">
                <span className="codicon codicon-error api-design-issue-icon" aria-hidden="true" />
                <span className="api-design-issue-label">{label}</span>
                <span className="api-design-issue-count">({group.length})</span>
              </div>
              {offenders.length > 0 && (
                <div className="api-design-issue-offenders">
                  {offenders.map((offender) => (
                    <OffenderRow key={offender.key} offender={offender} apiDocumentation={apiDocumentation} />
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
