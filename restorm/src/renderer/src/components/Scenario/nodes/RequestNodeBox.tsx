import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { Button } from 'electron-core-ui/renderer'
import { isRequest } from '../../../../../shared/types/collections'
import { Badge } from '../../common/Badge'
import { RegistryBadge } from '../../common/RegistryBadge'
import { requestBadgeType, requestBadgeMode } from '../../../utils/badgeUtils'
import { httpBadgeIdFor } from '../../../../../shared/utils/httpMethod'
import { useScenarioBoundResolver, useScenarioRequestEnv } from '../scenarioBoundResolver'
import { TypedValueField } from '../../TypedValueField'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { EnvironmentValue } from '../../../../../shared/types/collections'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { useSelectorSection } from './scenarioOverridePorts'

/** The request node's `env` field is pinned to the `environment` type: every
 * other concrete type is excluded, leaving the env picker plus — via the
 * Variables submenu — variables *declared* of type environment (a variable's
 * own type must survive the filter, and only `environment` does here). */
const ENV_PINNED_EXCLUDE: ValueTypeKind[] = [
  'string', 'secret', 'number', 'dateTime', 'color', 'expression', 'boolean', 'enum', 'enumList', 'customList', 'customListMulti'
]

/**
 * `request` node — bound to a saved request (`config.requestId`). The header
 * shows its method badge + live name; the left column mirrors the request's
 * structure as collapsible sections (headers / path params / params / body),
 * each row a `name ↔ value` pair with a grey input anchor (and the value's
 * description as a hover tooltip on the name). All resolved live from the tree.
 */
export const RequestNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const resolve = useScenarioBoundResolver()
  const resolveEnv = useScenarioRequestEnv()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const requestId = typeof data.config?.['requestId'] === 'string' ? data.config['requestId'] : undefined
  const item = requestId && resolve ? resolve(requestId) : null
  const request = item && isRequest(item) ? item : null
  const envInfo = requestId && resolveEnv ? resolveEnv(requestId) : null

  const fallbackLabel = typeof data.config?.['label'] === 'string' ? data.config['label'] : undefined
  const title = request?.name ?? fallbackLabel
  // Plain HTTP requests render the registry-driven method badge (verbatim
  // casing, http_other fallback color for custom verbs); every other protocol
  // — and the HTTP mock-server SRV capsule — stays on the legacy Badge until
  // the registry covers them.
  const headerIcon = request
    ? (request.type === 'http' && (request as { server?: boolean }).server !== true
        ? <RegistryBadge badgeId={httpBadgeIdFor((request as { method?: string }).method ?? 'GET')} text={(request as { method?: string }).method ?? 'GET'} />
        : <Badge type={requestBadgeType(request)} mode={requestBadgeMode(request)} />)
    : undefined

  // Nameless section with the env field — only when the request sits under an
  // environment folder. A value selector pinned to the `environment` type: the
  // picker lists every env across all folders, defaulting to the request's base
  // pinned env, and the Variables submenu surfaces environment-typed variables.
  // Carries an optional `env` data input so an upstream link can drive it too.
  const envSection: ScenarioNodeSection | null = envInfo
    ? {
      id: 'env',
      rows: [{
        id: 'env',
        port: { id: 'env', type: 'target' },
        content: (
          <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
            {/* A visible caption so this env override-port row reads as its own
             * labeled field — without it the bare picker's anchor sits under the
             * quick-config selector above and looks like the selector is
             * wireable (it is not — the selector carries no port). */}
            <div className="scn-field-caption">{t('scenario.actionOverride.fields.env', 'Environment')}</div>
            <TypedValueField
              value={data.config?.['env'] !== undefined ? normalizeValueType(data.config['env']) : new EnvironmentValue(envInfo.selectedEnvId ?? '')}
              onChange={(next) => { data.onSetConfig?.(id, { env: serializeValueForPersistence(next) }) }}
              valueTypeGroups={valueTypeGroups}
              excludeTypes={ENV_PINNED_EXCLUDE}
              allowEnvironment
              dataTestId="scn-request-env"
            />
          </div>
        )
      }]
    }
    : null
  // First body line: a link to open the bound request in a workbench tab.
  const editSection: ScenarioNodeSection | null = (request && requestId && data.onOpenItem)
    ? {
      id: 'edit',
      rows: [{
        id: 'edit',
        content: (
          <Button
            externalLink
            className="nodrag"
            data-testid="scn-request-edit-link"
            onClick={(e) => { e.stopPropagation(); data.onOpenItem?.(requestId) }}
          >
            {t('scenario.editRequest', 'Edit request')}
          </Button>
        )
      }]
    }
    : null
  // Quick-config selector (a chooser, not a port): picks a file-saved config as
  // the action's base. Hidden when the request has no project configs.
  const config = data.config ?? {}
  const onSetConfig = (patch: Record<string, unknown>): void => { data.onSetConfig?.(id, patch) }
  // Null (no row reserved) when the request has no project config; appears live
  // when one is added.
  const selectorSection = useSelectorSection(request, config, onSetConfig)

  const left: ScenarioNodeSection[] = [
    editSection,
    selectorSection,
    envSection
  ].filter((s): s is ScenarioNodeSection => s !== null)

  const right: ScenarioNodeCell[] = [
    { id: 'response', label: 'response', port: { id: 'response', role: 'response', type: 'source' } }
  ]
  return (
    <ScenarioNodeBoxBase
      id={id}
      data={data}
      selected={selected}
      left={left}
      right={right}
     
      {...(headerIcon ? { headerIcon } : {})}
      {...(title ? { title } : {})}
    />
  )
}

export default RequestNodeBox
