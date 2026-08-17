import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  InputBox,
  MessageType,
  SelectBox,
  Table,
  Toggle,
  type ISelectData,
  type TableColumn
} from 'electron-core-ui/renderer'
import type {
  ApiDesign,
  DesignRoute,
  DesignRouteGroup
} from '../../../../shared/types/collections'
import type { ParameterDocumentation } from '../../../../shared/types/apiDocumentation'
import { composeRoutePath } from '../../../../shared/design/apiDesignDoc'
import { syncPathParams } from '../../../../shared/design/designRoutes'
import { displayValue, parseTypedRaw } from './designDisplay'
import { replaceRoute } from './designMutations'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

/** Rebuild a route with the given param links, omitting empty bags —
 * `design: { paramLinks: {} }` must never reach the file. */
function withParamLinks(route: DesignRoute, links: NonNullable<NonNullable<DesignRoute['design']>['paramLinks']>): DesignRoute {
  const { paramLinks: _dropped, ...designRest } = route.design ?? {}
  const design = Object.keys(links).length > 0 ? { ...designRest, paramLinks: links } : designRest
  const { design: _oldDesign, ...routeRest } = route
  const next: DesignRoute = { ...routeRest }
  if (Object.keys(design).length > 0) next.design = design
  return next
}
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH'])
const PARAM_TYPES = ['string', 'integer', 'number', 'boolean'] as const

export interface RouteDefinitionTabProps {
  design: ApiDesign
  group: DesignRouteGroup
  route: DesignRoute
}

/**
 * The Définition tab of a route: method + relative path (Restorm
 * `{{param}}` syntax, parameter rows auto-created from the pattern),
 * the fully-resolved path line, summary/description, the path and
 * query/header parameter tables (a parameter is typed directly OR
 * linked to a model property — id-based, rename-proof, with inherited
 * type/example greyed), and the body combo for body-carrying methods.
 */
export const RouteDefinitionTab: React.FC<RouteDefinitionTabProps> = ({ design, group, route }) => {
  const { t } = useTranslation()

  const commit = useCallback((next: DesignRoute) => {
    replaceRoute(design, group.id, route.id, next)
  }, [design, group.id, route.id])

  const patchDoc = useCallback((patch: Partial<DesignRoute['doc']>) => {
    commit({ ...route, doc: { ...route.doc, ...patch } })
  }, [commit, route])

  const parameters = useMemo(() => route.doc.parameters ?? [], [route.doc.parameters])
  const pathParams = parameters.filter((p) => p.location === 'path')
  const otherParams = parameters.filter((p) => p.location !== 'path')

  const linkFor = (name: string): { modelName: string; propertyName: string; example: unknown; type: string; format?: string; description?: string } | null => {
    const link = route.design?.paramLinks?.[name]
    if (link === undefined) return null
    const model = design.models.find((m) => m.id === link.modelId)
    const property = model?.properties.find((p) => p.id === link.propertyId)
    if (model === undefined || property === undefined) return null
    return {
      modelName: model.doc.name,
      propertyName: property.doc.name,
      example: property.doc.example,
      type: property.doc.type,
      ...(property.doc.format !== undefined ? { format: property.doc.format } : {}),
      ...(property.doc.description !== undefined ? { description: property.doc.description } : {})
    }
  }

  // ── Parameter mutations ────────────────────────────────────────────
  const updateParam = useCallback((name: string, update: (p: ParameterDocumentation) => ParameterDocumentation) => {
    patchDoc({ parameters: parameters.map((p) => (p.name === name ? update(p) : p)) })
  }, [patchDoc, parameters])

  const renameParam = useCallback((oldName: string, newName: string) => {
    if (newName === '' || parameters.some((p) => p.name === newName)) return
    const nextParameters = parameters.map((p) => (p.name === oldName ? { ...p, name: newName } : p))
    const links = { ...(route.design?.paramLinks ?? {}) }
    const moved = links[oldName]
    if (moved !== undefined) {
      const { [oldName]: _dropped, ...rest } = links
      commit({ ...route, doc: { ...route.doc, parameters: nextParameters }, design: { ...(route.design ?? {}), paramLinks: { ...rest, [newName]: moved } } })
      return
    }
    patchDoc({ parameters: nextParameters })
  }, [commit, patchDoc, parameters, route])

  const deleteParam = useCallback((name: string) => {
    const nextParameters = parameters.filter((p) => p.name !== name)
    const { [name]: _dropped, ...links } = route.design?.paramLinks ?? {}
    commit(withParamLinks({ ...route, doc: { ...route.doc, parameters: nextParameters } }, links))
  }, [commit, parameters, route])

  const addParam = useCallback(() => {
    let name = t('design.routes.newParamName', 'param')
    for (let i = 2; parameters.some((p) => p.name === name); i++) name = `${t('design.routes.newParamName', 'param')}${i}`
    patchDoc({ parameters: [...parameters, { name, location: 'query', type: 'string', required: false }] })
  }, [patchDoc, parameters, t])

  const setLink = useCallback((paramName: string, target: { modelId: string; propertyId: string } | null) => {
    const links = { ...(route.design?.paramLinks ?? {}) }
    if (target === null) {
      const { [paramName]: _dropped, ...rest } = links
      commit(withParamLinks(route, rest))
      return
    }
    // Re-linking restores the AUTO mirror: any detached description the
    // parameter carried is cleared, so the badge and the export can
    // never disagree about whose text is served.
    const parametersWithoutOwnDescription = parameters.map((p) => {
      if (p.name !== paramName) return p
      const { description: _ownDescription, ...rest } = p
      return rest
    })
    commit(withParamLinks(
      { ...route, doc: { ...route.doc, parameters: parametersWithoutOwnDescription } },
      { ...links, [paramName]: { ...target, descriptionAuto: true } }
    ))
  }, [commit, parameters, route])

  // ── Model-property link vocabulary ─────────────────────────────────
  const linkChoices = useMemo(() => design.models.flatMap((m) =>
    m.properties
      .filter((p) => p.doc.name !== '')
      .map((p) => ({ modelId: m.id, propertyId: p.id, label: `${m.doc.name} ▸ ${p.doc.name}` }))
  ), [design.models])

  const paramColumns = (isPath: boolean): TableColumn<ParameterDocumentation>[] => [
    {
      id: 'name',
      header: t('design.routes.params.name', 'Name'),
      autoWidth: false,
      defaultWidth: 140,
      renderCell: (param) => isPath
        ? <span className="design-param-name">{`{{${param.name}}}`}</span>
        : (
          <InputBox
            value={param.name}
            onChange={(next) => { renameParam(param.name, next) }}
            options={{
              type: 'text',
              ariaLabel: t('design.routes.params.name', 'Name'),
              validationOptions: {
                validation: (value: string) => {
                  if (value === '') return { content: t('design.routes.params.nameEmpty', 'A parameter needs a name'), type: MessageType.ERROR }
                  if (value !== param.name && parameters.some((other) => other.name === value)) {
                    return { content: t('design.routes.params.nameTaken', 'This name is already used'), type: MessageType.ERROR }
                  }
                  return null
                }
              }
            }}
            data-testid={`design-param-name-${param.name}`}
          />
        )
    },
    ...(isPath ? [] : [{
      id: 'location',
      header: t('design.routes.params.location', 'In'),
      autoWidth: false,
      defaultWidth: 90,
      renderCell: (param: ParameterDocumentation) => (
        <SelectBox
          id={`design-param-location-${route.id}-${param.name}`}
          className=""
          options={[{ text: 'query' }, { text: 'header' }]}
          selected={param.location === 'header' ? 1 : 0}
          onDidSelect={(data: ISelectData) => { updateParam(param.name, (p) => ({ ...p, location: data.selected === 'header' ? 'header' : 'query' })) }}
          selectBoxOptions={{ ariaLabel: t('design.routes.params.location', 'In'), useCustomDrawn: true }}
          data-testid={`design-param-location-${param.name}`}
        />
      )
    }]),
    {
      id: 'type',
      header: t('design.schema.columns.type', 'Type'),
      autoWidth: false,
      defaultWidth: 110,
      renderCell: (param) => {
        const link = linkFor(param.name)
        if (link !== null) {
          return (
            <span className="design-param-inherited" data-testid={`design-param-type-${param.name}`}>
              {link.type}{link.format !== undefined ? ` ${link.format}` : ''}
            </span>
          )
        }
        return (
          <SelectBox
            id={`design-param-type-${route.id}-${param.name}`}
            className=""
            options={PARAM_TYPES.map((type) => ({ text: type }))}
            selected={Math.max(0, PARAM_TYPES.indexOf(param.type as typeof PARAM_TYPES[number]))}
            onDidSelect={(data: ISelectData) => { updateParam(param.name, (p) => ({ ...p, type: data.selected })) }}
            selectBoxOptions={{ ariaLabel: t('design.schema.columns.type', 'Type'), useCustomDrawn: true }}
            data-testid={`design-param-type-${param.name}`}
          />
        )
      }
    },
    {
      id: 'link',
      header: t('design.routes.params.link', 'Model link'),
      autoWidth: false,
      defaultWidth: 170,
      renderCell: (param) => {
        const link = route.design?.paramLinks?.[param.name]
        const currentIndex = link === undefined
          ? 0
          : Math.max(0, linkChoices.findIndex((c) => c.modelId === link.modelId && c.propertyId === link.propertyId) + 1)
        const options = [{ text: t('design.routes.params.noLink', '—') }, ...linkChoices.map((c) => ({ text: c.label }))]
        return (
          <SelectBox
            id={`design-param-link-${route.id}-${param.name}`}
            className=""
            options={options}
            selected={currentIndex}
            onDidSelect={(data: ISelectData) => {
              const index = options.findIndex((opt) => opt.text === data.selected)
              const picked = index <= 0 ? null : linkChoices[index - 1] ?? null
              setLink(param.name, picked === null ? null : { modelId: picked.modelId, propertyId: picked.propertyId })
            }}
            selectBoxOptions={{ ariaLabel: t('design.routes.params.link', 'Model link'), useCustomDrawn: true }}
            data-testid={`design-param-link-${param.name}`}
          />
        )
      }
    },
    {
      id: 'required',
      header: t('design.flags.required', 'required'),
      autoWidth: true,
      renderCell: (param) => (
        <Toggle
          checked={param.required}
          onChange={(checked) => { updateParam(param.name, (p) => ({ ...p, required: checked })) }}
          disabled={isPath}
          aria-label={t('design.flags.required', 'required')}
          data-testid={`design-param-required-${param.name}`}
        />
      )
    },
    {
      id: 'example',
      header: t('design.schema.columns.example', 'Example'),
      autoWidth: false,
      defaultWidth: 130,
      renderCell: (param) => {
        const link = linkFor(param.name)
        if (link !== null) {
          return <span className="design-param-inherited" data-testid={`design-param-example-${param.name}`}>{displayValue(link.example)}</span>
        }
        return (
          <InputBox
            value={displayValue(param.example)}
            onChange={(next) => {
              updateParam(param.name, (p) => {
                const { example: _dropped, ...rest } = p
                // Typed like every example field — an integer parameter
                // stores 10, never "10".
                return next === '' ? rest : { ...rest, example: parseTypedRaw(p.type, next) }
              })
            }}
            options={{ type: 'text', ariaLabel: t('design.schema.columns.example', 'Example') }}
            data-testid={`design-param-example-${param.name}`}
          />
        )
      }
    },
    {
      id: 'description',
      header: t('design.schema.fields.description', 'Description'),
      renderCell: (param) => {
        const link = route.design?.paramLinks?.[param.name]
        const inherited = linkFor(param.name)
        const auto = link?.descriptionAuto === true && inherited !== null
        const shown = auto ? inherited.description ?? '' : param.description ?? ''
        return (
          <div className="design-param-description">
            <InputBox
              value={shown}
              onChange={(next) => {
                // Editing DETACHES the mirror: the description becomes the
                // parameter's own.
                const links = { ...(route.design?.paramLinks ?? {}) }
                const current = links[param.name]
                const nextParameters = parameters.map((p) => {
                  if (p.name !== param.name) return p
                  const { description: _dropped, ...rest } = p
                  return next === '' ? rest : { ...rest, description: next }
                })
                if (current?.descriptionAuto === true) {
                  commit({
                    ...route,
                    doc: { ...route.doc, parameters: nextParameters },
                    design: { ...(route.design ?? {}), paramLinks: { ...links, [param.name]: { modelId: current.modelId, propertyId: current.propertyId } } }
                  })
                  return
                }
                patchDoc({ parameters: nextParameters })
              }}
              options={{ type: 'text', ariaLabel: t('design.schema.fields.description', 'Description') }}
              data-testid={`design-param-description-${param.name}`}
            />
            {auto && <span className="design-param-auto-badge" data-testid={`design-param-auto-${param.name}`}>{t('design.routes.params.auto', 'auto')}</span>}
            {!isPath && (
              <HeaderHoverTooltip label={t('design.routes.params.delete', 'Delete the parameter')}>
                <Button
                  secondary
                  small
                  icon="trash"
                  options={{ ariaLabel: t('design.routes.params.delete', 'Delete the parameter') }}
                  onClick={() => { deleteParam(param.name) }}
                  data-testid={`design-param-delete-${param.name}`}
                />
              </HeaderHoverTooltip>
            )}
          </div>
        )
      }
    }
  ]

  const resolvedPath = composeRoutePath({
    ...(design.server?.basePath !== undefined ? { designBasePath: design.server.basePath } : {}),
    ...(group.design?.versionPrefix !== undefined ? { versionPrefix: group.design.versionPrefix } : {}),
    ...(group.design?.basePath !== undefined ? { groupBasePath: group.design.basePath } : {})
  }, route.doc.match.urlPattern)

  const method = route.doc.match.method ?? 'GET'
  const bodyModels = useMemo(() => design.models.map((m) => ({ id: m.id, name: m.doc.name })), [design.models])
  const bodyOptions = [{ text: t('design.routes.body.empty', '(empty)') }, ...bodyModels.map((m) => ({ text: m.name }))]
  const bodyIndex = route.design?.body?.modelId === undefined
    ? 0
    : Math.max(0, bodyModels.findIndex((m) => m.id === route.design?.body?.modelId) + 1)

  return (
    <div className="design-route-definition" data-testid={`design-route-definition-${route.id}`}>
      <div className="design-route-line">
        <div className="design-route-method">
          <SelectBox
            id={`design-route-method-${route.id}`}
            className=""
            options={METHODS.map((m) => ({ text: m }))}
            selected={Math.max(0, METHODS.indexOf(method as typeof METHODS[number]))}
            onDidSelect={(data: ISelectData) => {
              patchDoc({ match: { ...route.doc.match, method: data.selected } })
            }}
            selectBoxOptions={{ ariaLabel: t('design.routes.method', 'Method'), useCustomDrawn: true }}
            data-testid="design-route-method"
          />
        </div>
        <div className="design-route-path">
          <InputBox
            value={route.doc.match.urlPattern}
            onChange={(next) => { commit(syncPathParams(route, next)) }}
            options={{ type: 'text', placeholder: '/{{id}}', ariaLabel: t('design.routes.path', 'Path') }}
            data-testid="design-route-path"
          />
        </div>
      </div>
      <p className="design-route-resolved" data-testid="design-route-resolved">{resolvedPath}</p>

      <div className="design-settings-grid">
        <label className="design-field design-field-full">
          <span className="design-field-label">{t('design.schema.fields.description', 'Description')}</span>
          <InputBox
            value={route.doc.description ?? ''}
            onChange={(next) => {
              const { description: _dropped, ...docRest } = route.doc
              commit({ ...route, doc: next === '' ? docRest : { ...docRest, description: next } })
            }}
            options={{ type: 'text', flexibleHeight: true, ariaLabel: t('design.schema.fields.description', 'Description') }}
            data-testid="design-route-description"
          />
        </label>
      </div>

      {BODY_METHODS.has(method) && (
        <label className="design-field">
          <span className="design-field-label">{t('design.routes.body.label', 'Request body')}</span>
          <SelectBox
            id={`design-route-body-${route.id}`}
            className=""
            options={bodyOptions}
            selected={bodyIndex}
            onDidSelect={(data: ISelectData) => {
              const index = bodyOptions.findIndex((opt) => opt.text === data.selected)
              const picked = index <= 0 ? undefined : bodyModels[index - 1]
              const { body: _dropped, ...designRest } = route.design ?? {}
              commit({
                ...route,
                design: picked === undefined
                  ? designRest
                  : { ...designRest, body: { modelId: picked.id, contentType: route.design?.body?.contentType ?? 'application/json' } }
              })
            }}
            selectBoxOptions={{ ariaLabel: t('design.routes.body.label', 'Request body'), useCustomDrawn: true }}
            data-testid="design-route-body"
          />
        </label>
      )}

      <h3 className="design-settings-group-title">{t('design.routes.params.pathTitle', 'Path parameters')}</h3>
      {pathParams.length === 0
        ? <p className="design-section-placeholder-message">{t('design.routes.params.pathEmpty', 'Type a {{param}} in the path to create its row.', { param: '{{param}}' })}</p>
        : (
          <Table<ParameterDocumentation>
            columns={paramColumns(true)}
            rows={pathParams}
            getRowId={(p) => `path-${p.name}`}
          />
        )}

      <div className="design-route-params-header">
        <h3 className="design-settings-group-title">{t('design.routes.params.otherTitle', 'Parameters (query / header)')}</h3>
        <HeaderHoverTooltip label={t('design.routes.params.add', 'Add a parameter')}>
          <Button
            secondary
            small
            icon="add"
            options={{ ariaLabel: t('design.routes.params.add', 'Add a parameter') }}
            onClick={addParam}
            data-testid="design-route-add-param"
          />
        </HeaderHoverTooltip>
      </div>
      {otherParams.length === 0
        ? <p className="design-section-placeholder-message">{t('design.routes.params.otherEmpty', 'No query or header parameters yet.')}</p>
        : (
          <Table<ParameterDocumentation>
            columns={paramColumns(false)}
            rows={otherParams}
            getRowId={(p) => `other-${p.name}`}
          />
        )}
    </div>
  )
}
