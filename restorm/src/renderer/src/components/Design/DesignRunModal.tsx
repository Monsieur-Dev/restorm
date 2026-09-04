import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  CodeEditor,
  InputBox,
  MessageType
} from 'electron-core-ui/renderer'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import type { ApiDesign, DesignRoute, DesignRouteGroup } from '../../../../shared/types/collections'
import { composeRoutePath, groupChainBasePath } from '../../../../shared/design/apiDesignDoc'
import { httpBadgeIdFor } from '../../../../shared/utils/httpMethod'
import { RegistryBadge } from '../common/RegistryBadge'
import { useDesignServerCounters, useIsDesignServerListening } from '../../services/designServerStore'

export interface DesignRunPanelProps {
  design: ApiDesign
  /** The served port (echo — shown in the header while listening). */
  port: number
}

/** One route's chosen return: absent = the design's default response. */
interface ForcedChoice {
  code: string
  body?: string
}

/**
 * The live run panel, rendered INLINE in the Server section (below the
 * "Serve this design" controls): the live face of a serving design. Lists
 * every route with its per-run call counter; each route expands into the
 * list of returns it can serve — the design's default response, every
 * declared status code, plus a user-defined code with an optional custom
 * body — where clicking a bullet FORCES that return (effective on the next
 * request, no restart) and each bullet shows how many calls it answered
 * this run. Starting / stopping is the spin above; this panel only reflects.
 */
export const DesignRunPanel: React.FC<DesignRunPanelProps> = ({ design, port }) => {
  const { t } = useTranslation()
  const listening = useIsDesignServerListening(design.id)
  const counters = useDesignServerCounters(design.id)
  const [expandedRouteId, setExpandedRouteId] = useState<string | null>(null)
  // routeId → the forced choice mirrored locally (the main process owns
  // the authoritative map; this mirror drives the radio rendering).
  const [forcedByRoute, setForcedByRoute] = useState<Record<string, ForcedChoice | undefined>>({})

  const applyForced = useCallback((routeId: string, choice: ForcedChoice | null) => {
    setForcedByRoute((prev) => ({ ...prev, [routeId]: choice ?? undefined }))
    void window.restorm?.designServer.setForced(design.id, routeId, choice)
  }, [design.id])

  return (
    <div className="design-run-panel" data-testid="design-run-modal">
      <div className="design-run-header">
        <span className={`design-run-status-dot${listening ? ' listening' : ''}`} aria-hidden="true" />
        <span className="design-run-title">
          {listening
            ? t('design.run.listening', 'Serving on http://localhost:{{port}}', { port })
            : t('design.run.stopped', 'Server stopped')}
        </span>
        <span className="design-run-total" data-testid="design-run-total">
          {t('design.run.totalCalls', '{{count}} call(s) this run', { count: counters.total })}
        </span>
      </div>

      <div className="design-run-routes">
        {design.routeGroups.map((group) => (
          <React.Fragment key={group.id}>
            {group.routes.map((route) => (
              <RunRouteRow
                key={route.id}
                design={design}
                group={group}
                route={route}
                callCount={counters.routes[route.id]?.total ?? 0}
                byCode={counters.routes[route.id]?.byCode ?? {}}
                expanded={expandedRouteId === route.id}
                onToggle={() => { setExpandedRouteId(expandedRouteId === route.id ? null : route.id) }}
                forced={forcedByRoute[route.id]}
                onForce={(choice) => { applyForced(route.id, choice) }}
              />
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

interface RunRouteRowProps {
  design: ApiDesign
  group: DesignRouteGroup
  route: DesignRoute
  callCount: number
  byCode: Record<string, number>
  expanded: boolean
  onToggle: () => void
  forced: ForcedChoice | undefined
  onForce: (choice: ForcedChoice | null) => void
}

const RunRouteRow: React.FC<RunRouteRowProps> = ({ design, group, route, callCount, byCode, expanded, onToggle, forced, onForce }) => {
  const { t } = useTranslation()
  const [customCode, setCustomCode] = useState('')
  const [customBody, setCustomBody] = useState('')

  const method = route.doc.match.method ?? 'GET'
  const fullPath = composeRoutePath({
    ...(design.server?.basePath !== undefined ? { designBasePath: design.server.basePath } : {}),
    groupBasePath: groupChainBasePath(design, group)
  }, route.doc.match.urlPattern)
  const declaredCodes = Object.keys(route.doc.responses ?? {}).sort()
  const forcedCustom = forced !== undefined && !declaredCodes.includes(forced.code) ? forced : undefined

  const applyCustom = (): void => {
    if (!/^[1-5][0-9]{2}$/.test(customCode)) return
    onForce({ code: customCode, ...(customBody.trim() !== '' ? { body: customBody } : {}) })
  }

  return (
    <div className={`design-run-route${expanded ? ' expanded' : ''}`} data-testid={`design-run-route-${route.id}`}>
      <button
        type="button"
        className="design-run-route-header"
        aria-expanded={expanded}
        onClick={onToggle}
        data-testid={`design-run-route-header-${route.id}`}
      >
        <span className={`codicon codicon-chevron-${expanded ? 'down' : 'right'}`} />
        <RegistryBadge badgeId={httpBadgeIdFor(method)} text={method} />
        <span className="design-run-route-title">{route.doc.summary ?? fullPath}</span>
        <span className="design-run-route-path">{fullPath}</span>
        {forced !== undefined && (
          <span className="design-run-forced-pill" data-testid={`design-run-forced-pill-${route.id}`}>
            {t('design.run.forcedPill', 'forced {{code}}', { code: forced.code })}
          </span>
        )}
        <span className="design-run-route-count" data-testid={`design-run-count-${route.id}`}>
          {callCount}
        </span>
      </button>

      {expanded && (
        <ul className="design-run-returns">
          <ReturnBullet
            label={t('design.run.defaultReturn', 'Design response (default)')}
            selected={forced === undefined}
            count={undefined}
            onPick={() => { onForce(null) }}
            testId={`design-run-return-default-${route.id}`}
          />
          {declaredCodes.map((code) => (
            <ReturnBullet
              key={code}
              label={t('design.run.codeReturn', 'Answer {{code}}', { code })}
              detail={route.doc.responses?.[code]?.description}
              selected={forced?.code === code && forced.body === undefined}
              count={byCode[code] ?? 0}
              onPick={() => { onForce({ code }) }}
              testId={`design-run-return-${code}-${route.id}`}
            />
          ))}
          <li className={`design-run-return design-run-return-custom${forcedCustom !== undefined ? ' selected' : ''}`}>
            <div className="design-run-custom-fields">
              <div className="design-run-custom-code">
                <InputBox
                  value={customCode}
                  onChange={setCustomCode}
                  options={{
                    type: 'text',
                    maxLength: 3,
                    placeholder: '502',
                    ariaLabel: t('design.run.customCode', 'Custom status code'),
                    validationOptions: {
                      validation: (value: string) => {
                        if (value === '' || /^[1-5][0-9]{2}$/.test(value)) return null
                        return { content: t('design.routes.responses.codeInvalid', 'Enter a 3-digit status code'), type: MessageType.ERROR }
                      }
                    }
                  }}
                  data-testid={`design-run-custom-code-${route.id}`}
                />
              </div>
              <div className="design-run-custom-body">
                <CodeEditor
                  value={customBody}
                  onChange={(value) => { setCustomBody(value ?? '') }}
                  language="json"
                  autoHeight={{ maxHeight: 500, minHeight: 56 }}
                  options={{
                    ariaLabel: t('design.run.customBody', 'Custom response body'),
                    minimap: { enabled: false },
                    lineNumbers: 'off',
                    scrollBeyondLastLine: false,
                    folding: false,
                    overviewRulerLanes: 0,
                    renderLineHighlight: 'none',
                    wordWrap: 'on'
                  }}
                  data-testid={`design-run-custom-body-${route.id}`}
                />
              </div>
              <HeaderHoverTooltip label={t('design.run.customApply', 'Force')}>
                <Button
                  secondary
                  small
                  icon="check"
                  options={{ ariaLabel: t('design.run.customApply', 'Force') }}
                  onClick={applyCustom}
                  data-testid={`design-run-custom-apply-${route.id}`}
                />
              </HeaderHoverTooltip>
            </div>
            {forcedCustom !== undefined && (
              <span className="design-run-return-count">{byCode[forcedCustom.code] ?? 0}</span>
            )}
          </li>
        </ul>
      )}
    </div>
  )
}

interface ReturnBulletProps {
  label: string
  detail?: string | undefined
  selected: boolean
  count: number | undefined
  onPick: () => void
  testId: string
}

const ReturnBullet: React.FC<ReturnBulletProps> = ({ label, detail, selected, count, onPick, testId }) => (
  <li className={`design-run-return${selected ? ' selected' : ''}`}>
    <button type="button" className="design-run-return-pick" onClick={onPick} data-testid={testId}>
      <span className={`codicon codicon-${selected ? 'circle-filled' : 'circle-large-outline'}`} aria-hidden="true" />
      <span className="design-run-return-label">{label}</span>
      {detail !== undefined && <span className="design-run-return-detail">{detail}</span>}
    </button>
    {count !== undefined && <span className="design-run-return-count">{count}</span>}
  </li>
)
