import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  InputBox,
  SelectBox,
  Toggle,
  type ISelectData
} from 'electron-core-ui/renderer'
import type {
  ApiDesign,
  DesignAuthKind,
  DesignPagination,
  DesignRoute,
  DesignRouteGroup,
  RouteTraffic
} from '../../../../shared/types/collections'
import { composeRoutePath } from '../../../../shared/design/apiDesignDoc'
import { replaceRoute } from './designMutations'

const AUTH_KINDS: readonly DesignAuthKind[] = ['none', 'bearer', 'apiKeyHeader', 'basic']
const TRAFFIC: readonly (RouteTraffic | '')[] = ['', 'low', 'medium', 'high']

export interface RouteSettingsTabProps {
  design: ApiDesign
  group: DesignRouteGroup
  route: DesignRoute
  /** Jump back to the owning group's card ("edit in the group ↗"). */
  onOpenGroup: (groupId: string) => void
}

/**
 * The route Settings tab: the group-inherited contract read-only
 * (auth, base path, headers) with a jump to the group, then the
 * route's own behaviour — idempotence, cache lifetime, expected
 * traffic, deprecation, auth override, pagination bounds.
 */
export const RouteSettingsTab: React.FC<RouteSettingsTabProps> = ({ design, group, route, onOpenGroup }) => {
  const { t } = useTranslation()

  const commit = useCallback((next: DesignRoute) => {
    replaceRoute(design, group.id, route.id, next)
  }, [design, group.id, route.id])

  const patchMeta = useCallback((patch: {
    idempotent?: boolean | undefined
    cacheSeconds?: number | undefined
    authOverride?: DesignAuthKind | undefined
    pagination?: DesignPagination | undefined
  }) => {
    const merged = { ...(route.design ?? {}), ...patch }
    const { idempotent, cacheSeconds, authOverride, pagination, ...rest } = merged
    const design_ = { ...rest } as NonNullable<DesignRoute['design']>
    if (idempotent !== undefined) design_.idempotent = idempotent
    if (cacheSeconds !== undefined) design_.cacheSeconds = cacheSeconds
    if (authOverride !== undefined) design_.authOverride = authOverride
    if (pagination !== undefined) design_.pagination = pagination
    const { design: _oldMeta, ...routeRest } = route
    const next: DesignRoute = Object.keys(design_).length > 0 ? { ...routeRest, design: design_ } : { ...routeRest }
    commit(next)
  }, [commit, route])

  const inheritedAuth = group.design?.auth ?? design.defaultAuth ?? 'none'
  const inheritedBase = composeRoutePath({
    ...(design.server?.basePath !== undefined ? { designBasePath: design.server.basePath } : {}),
    ...(group.design?.versionPrefix !== undefined ? { versionPrefix: group.design.versionPrefix } : {}),
    ...(group.design?.basePath !== undefined ? { groupBasePath: group.design.basePath } : {})
  }, '/')
  const inheritedHeaders = group.design?.headers ?? []

  const authOverrideOptions = [
    { text: t('design.routes.settings.authInherited', 'Inherited from the group') },
    ...AUTH_KINDS.map((kind) => ({ text: t(`design.auth.${kind === 'none' ? 'none' : kind}`, kind) }))
  ]
  const authOverrideIndex = route.design?.authOverride === undefined
    ? 0
    : Math.max(0, AUTH_KINDS.indexOf(route.design.authOverride) + 1)

  const anyPaginated = Object.values(route.design?.responses ?? {}).some((r) => r.paginated === true)

  return (
    <div className="design-route-settings" data-testid={`design-route-settings-${route.id}`}>
      <h3 className="design-settings-group-title">{t('design.routes.settings.inherited', 'Inherited from the group')}</h3>
      <div className="design-inherited-block" data-testid="design-route-inherited">
        <p>
          <span className="design-field-label">{t('design.settings.api.defaultAuth', 'Default auth')}</span>{' '}
          {t(`design.auth.${inheritedAuth}`, inheritedAuth)}
        </p>
        <p>
          <span className="design-field-label">{t('design.settings.api.basePath', 'Base path')}</span>{' '}
          <code>{inheritedBase}</code>
        </p>
        {inheritedHeaders.length > 0 && (
          <p>
            <span className="design-field-label">{t('design.routes.settings.headers', 'Contract headers')}</span>{' '}
            {inheritedHeaders.map((h) => h.name).join(', ')}
          </p>
        )}
        <Button link onClick={() => { onOpenGroup(group.id) }} data-testid="design-route-open-group">
          {t('design.routes.settings.editGroup', 'Edit in the group ↗')}
        </Button>
      </div>

      <h3 className="design-settings-group-title">{t('design.routes.settings.behaviour', 'Behaviour')}</h3>
      <div className="design-settings-grid">
        <label className="design-flag-toggle">
          <span className="design-field-label">{t('design.routes.settings.idempotent', 'Idempotent')}</span>
          <Toggle
            checked={route.design?.idempotent === true}
            onChange={(checked) => { patchMeta({ idempotent: checked ? true : undefined }) }}
            aria-label={t('design.routes.settings.idempotent', 'Idempotent')}
            data-testid="design-route-idempotent"
          />
        </label>
        <label className="design-flag-toggle">
          <span className="design-field-label">{t('design.flags.deprecated', 'deprecated')}</span>
          <Toggle
            checked={route.doc.deprecated === true}
            onChange={(checked) => {
              const { deprecated: _dropped, ...docRest } = route.doc
              commit({ ...route, doc: checked ? { ...docRest, deprecated: true } : docRest })
            }}
            aria-label={t('design.flags.deprecated', 'deprecated')}
            data-testid="design-route-deprecated"
          />
        </label>
        <label className="design-field">
          <span className="design-field-label">{t('design.routes.settings.cacheSeconds', 'Cache (seconds)')}</span>
          <InputBox
            value={route.design?.cacheSeconds === undefined ? '' : String(route.design.cacheSeconds)}
            onChange={(next) => {
              const parsed = Number(next)
              patchMeta({ cacheSeconds: next.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined })
            }}
            options={{ type: 'number', min: 0, ariaLabel: t('design.routes.settings.cacheSeconds', 'Cache (seconds)') }}
            data-testid="design-route-cache"
          />
        </label>
        <label className="design-field">
          <span className="design-field-label">{t('design.routes.settings.traffic', 'Expected traffic')}</span>
          <SelectBox
            id={`design-route-traffic-${route.id}`}
            className=""
            options={TRAFFIC.map((v) => ({ text: v === '' ? t('design.modelSettings.volumetryUnset', '(unspecified)') : t(`design.traffic.${v}`, v) }))}
            selected={Math.max(0, TRAFFIC.indexOf(route.intents?.traffic ?? ''))}
            onDidSelect={(data: ISelectData) => {
              const picked = TRAFFIC.find((v) => (v === '' ? t('design.modelSettings.volumetryUnset', '(unspecified)') : t(`design.traffic.${v}`, v)) === data.selected) ?? ''
              const { intents: _dropped, ...routeRest } = route
              commit(picked === '' ? { ...routeRest } : { ...routeRest, intents: { ...(route.intents ?? {}), traffic: picked } })
            }}
            selectBoxOptions={{ ariaLabel: t('design.routes.settings.traffic', 'Expected traffic'), useCustomDrawn: true }}
            data-testid="design-route-traffic"
          />
        </label>
        <label className="design-field">
          <span className="design-field-label">{t('design.routes.settings.authOverride', 'Auth override')}</span>
          <SelectBox
            id={`design-route-auth-${route.id}`}
            className=""
            options={authOverrideOptions}
            selected={authOverrideIndex}
            onDidSelect={(data: ISelectData) => {
              const index = authOverrideOptions.findIndex((opt) => opt.text === data.selected)
              patchMeta({ authOverride: index <= 0 ? undefined : AUTH_KINDS[index - 1] })
            }}
            selectBoxOptions={{ ariaLabel: t('design.routes.settings.authOverride', 'Auth override'), useCustomDrawn: true }}
            data-testid="design-route-auth-override"
          />
        </label>
      </div>

      {anyPaginated && (
        <>
          <h3 className="design-settings-group-title">{t('design.routes.settings.pagination', 'Pagination')}</h3>
          <div className="design-settings-grid">
            <label className="design-field">
              <span className="design-field-label">{t('design.routes.settings.defaultLimit', 'Default page size')}</span>
              <InputBox
                value={route.design?.pagination?.defaultLimit === undefined ? '' : String(route.design.pagination.defaultLimit)}
                onChange={(next) => {
                  const parsed = Number(next)
                  const current = route.design?.pagination ?? { style: 'offset' as const }
                  const { defaultLimit: _dropped, ...rest } = current
                  patchMeta({ pagination: next.trim() !== '' && Number.isFinite(parsed) && parsed > 0 ? { ...rest, defaultLimit: parsed } : rest })
                }}
                options={{ type: 'number', min: 1, ariaLabel: t('design.routes.settings.defaultLimit', 'Default page size') }}
                data-testid="design-route-default-limit"
              />
            </label>
            <label className="design-field">
              <span className="design-field-label">{t('design.routes.settings.maxLimit', 'Max page size')}</span>
              <InputBox
                value={route.design?.pagination?.maxLimit === undefined ? '' : String(route.design.pagination.maxLimit)}
                onChange={(next) => {
                  const parsed = Number(next)
                  const current = route.design?.pagination ?? { style: 'offset' as const }
                  const { maxLimit: _dropped, ...rest } = current
                  patchMeta({ pagination: next.trim() !== '' && Number.isFinite(parsed) && parsed > 0 ? { ...rest, maxLimit: parsed } : rest })
                }}
                options={{ type: 'number', min: 1, ariaLabel: t('design.routes.settings.maxLimit', 'Max page size') }}
                data-testid="design-route-max-limit"
              />
            </label>
          </div>
        </>
      )}
    </div>
  )
}
