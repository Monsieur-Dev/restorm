import React from 'react'
import { useTranslation } from 'react-i18next'
import { DelayedTooltip } from './DelayedTooltip'
import './statusCodeTooltip.css'

/** Translation keys ship `httpStatus.<code>.{name,description}` for a
 *  fixed set of common codes — codes outside this list have no
 *  standards-defined reason in our locale files, so the tooltip
 *  layers that depend on the standard reason simply skip it (rather
 *  than fall back to a generic "Statut inconnu"). Centralised here
 *  so doc-viewer and response-panel call sites stay in lockstep when
 *  the locale files add or rename codes. */
const KNOWN_STATUS_CODES = new Set([
  '100', '101',
  '200', '201', '202', '204',
  '301', '302', '304',
  '400', '401', '403', '404', '405', '408', '409', '410', '415', '422', '429',
  '500', '501', '502', '503', '504'
])

interface RfcReasonContentProps {
  code: string
}

/** Localised "name + description" block — the standards-defined human
 *  reason for a known status code. Callers must check
 *  `KNOWN_STATUS_CODES.has(code)` first; the component itself assumes
 *  the keys exist. */
const RfcReasonContent: React.FC<RfcReasonContentProps> = ({ code }) => {
  const { t } = useTranslation()
  return (
    <div className="status-code-tooltip__rfc">
      <span className="status-code-tooltip__rfc-name">{t(`httpStatus.${code}.name`)}</span>
      <span className="status-code-tooltip__rfc-description">{t(`httpStatus.${code}.description`)}</span>
    </div>
  )
}

export interface DocViewerStatusCodeTooltipProps {
  code: string
  children: React.ReactNode
  /** Optional CSS class hung on the hover wrapper. */
  className?: string
  /** Optional test id stamped on the tooltip. */
  testId?: string
}

/**
 * Doc-viewer variant: surfaces the standards-defined name +
 * description on hover, but only when the code is one of the
 * recognised set — non-standard codes (e.g. 499, 598) get no
 * tooltip rather than a generic "Statut inconnu" fallback.
 */
export const DocViewerStatusCodeTooltip: React.FC<DocViewerStatusCodeTooltipProps> = ({
  code,
  children,
  className,
  testId
}) => {
  if (!KNOWN_STATUS_CODES.has(code)) {
    return <>{children}</>
  }
  return (
    <DelayedTooltip
      content={<RfcReasonContent code={code} />}
      {...(className !== undefined ? { className } : {})}
      {...(testId !== undefined ? { testId } : {})}
    >
      {children}
    </DelayedTooltip>
  )
}

export interface ResponseInfoStatusCodeTooltipProps {
  code: string
  /** Description the OpenAPI doc attached to this code on this
   *  specific route. When undefined / empty the component renders
   *  the children plain — no tooltip at all. The product call:
   *  "n'affiche rien" if the doc doesn't describe the code. */
  docDescription: string | undefined
  children: React.ReactNode
  className?: string
  testId?: string
}

/**
 * Response-panel "Infos" variant: surfaces a tooltip when either the
 * spec attached a description to this exact code OR the code is one
 * of the recognised standards-defined codes — and combines them
 * stacked when both are available. If neither side has anything to
 * say (the spec ignores the code AND it's not in the standards set),
 * the children render plain with no tooltip.
 */
export const ResponseInfoStatusCodeTooltip: React.FC<ResponseInfoStatusCodeTooltipProps> = ({
  code,
  docDescription,
  children,
  className,
  testId
}) => {
  const docTrimmed = (docDescription ?? '').trim()
  const hasDoc = docTrimmed.length > 0
  const hasStandard = KNOWN_STATUS_CODES.has(code)
  if (!hasDoc && !hasStandard) {
    return <>{children}</>
  }
  const content = (
    <div className="status-code-tooltip__stack">
      {hasDoc && <div className="status-code-tooltip__doc">{docTrimmed}</div>}
      {hasStandard && <RfcReasonContent code={code} />}
    </div>
  )
  return (
    <DelayedTooltip
      content={content}
      {...(className !== undefined ? { className } : {})}
      {...(testId !== undefined ? { testId } : {})}
    >
      {children}
    </DelayedTooltip>
  )
}
