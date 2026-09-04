import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  InputBox,
  MessageType,
  SelectBox,
  StaticPane,
  Table,
  Toggle,
  type ISelectData,
  type ISelectOptionItem,
  type TableColumn
} from 'electron-core-ui/renderer'
import type {
  ApiDesign,
  DesignRoute,
  DesignRouteGroup
} from '../../../../shared/types/collections'
import type { ParameterDocumentation } from '../../../../shared/types/apiDocumentation'
import { composeRoutePath, groupChainBasePath } from '../../../../shared/design/apiDesignDoc'
import { syncPathParams } from '../../../../shared/design/designRoutes'
import { designRouteProjections, resolveDesignPath } from '../../../../shared/design/designProjections'
import { flattenEnvVars } from '../../../../shared/utils/resolveUrlAgainstEnv'
import { KNOWN_HTTP_METHODS, httpBadgeIdFor } from '../../../../shared/utils/httpMethod'
import { displayValue, parseTypedRaw } from './designDisplay'
import { assignDesignSection, replaceRoute, uniqueComponentName } from './designMutations'
import { generateUniqueId } from '../../utils/treeManipulation'
import { DesignParamTypeControl } from './DesignParamTypeControl'
import { RegistryBadge } from '../common/RegistryBadge'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { useDesignEnvVariables } from '../../hooks/useDesignEnvVariables'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { DesignTagsEditor } from './DesignTagsEditor'

/** Rebuild a route with the given param links, omitting empty bags —
 * `design: { paramLinks: {} }` must never reach the file. */
/** Rebuild a route with its two param-name-keyed bags (model links + enum
 * refs), dropping either when empty and the whole `design` block when it ends
 * up empty — so a route never carries a stray `{}`. */
function withParamMaps(
  route: DesignRoute,
  links: NonNullable<NonNullable<DesignRoute['design']>['paramLinks']>,
  enumRefs: NonNullable<NonNullable<DesignRoute['design']>['paramEnumRefs']>
): DesignRoute {
  const { paramLinks: _l, paramEnumRefs: _e, ...designRest } = route.design ?? {}
  const design: NonNullable<DesignRoute['design']> = { ...designRest }
  if (Object.keys(links).length > 0) design.paramLinks = links
  if (Object.keys(enumRefs).length > 0) design.paramEnumRefs = enumRefs
  const { design: _oldDesign, ...routeRest } = route
  const next: DesignRoute = { ...routeRest }
  if (Object.keys(design).length > 0) next.design = design
  return next
}
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH'])

/** Title-case the alphanumeric words of a name for a synthesized enum name
 * (e.g. `Finds pets by status` + `status` → `FindsPetsByStatusStatus`). */
function pascalCaseName(input: string): string {
  return (input.match(/[A-Za-z0-9]+/g) ?? [])
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

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
  // Variables of the env-folder that contains the design — the same
  // autocomplete the request URL offers, so a route path can carry
  // `{{variables}}` alongside its `{{pathParam}}` placeholders.
  const envVariables = useDesignEnvVariables(design.id)
  const handlebarsHelpers = useHandlebarsHelpers()

  // Resolve `{{baseUrl}}`-style handlebars against the design's environment
  // folder (values may themselves reference other vars → flatten first), the
  // same way a served request would. Path-params like `{{id}}` aren't env vars,
  // so they stay as placeholders.
  const envMap = useMemo(
    () => flattenEnvVars(Object.fromEntries(envVariables.map((v) => [v.name, v.value]))),
    [envVariables]
  )

  const commit = useCallback((next: DesignRoute) => {
    replaceRoute(design, group.id, route.id, next)
  }, [design, group.id, route.id])

  const patchDoc = useCallback((patch: Partial<DesignRoute['doc']>) => {
    commit({ ...route, doc: { ...route.doc, ...patch } })
  }, [commit, route])

  const parameters = useMemo(() => route.doc.parameters ?? [], [route.doc.parameters])
  const pathParams = parameters.filter((p) => p.location === 'path')
  const otherParams = parameters.filter((p) => p.location !== 'path')

  // How this one route is exposed across every protocol the design can serve —
  // read back from the same projections the served endpoints use. `replaceRoute`
  // swaps the route object on every edit, so this recomputes as the user types.
  const projections = useMemo(() => designRouteProjections(design, group, route, envMap), [design, group, route, envMap])

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
    // The two param-name-keyed bags (model links + enum refs) must follow the
    // rename in lockstep, exactly like the path `{{param}}` placeholders.
    const moveKey = <V,>(map: Record<string, V> | undefined): Record<string, V> | undefined => {
      const value = map?.[oldName]
      if (map === undefined || value === undefined) return map
      const next: Record<string, V> = {}
      for (const [key, entry] of Object.entries(map)) {
        if (key !== oldName) next[key] = entry
      }
      next[newName] = value
      return next
    }
    const design = { ...(route.design ?? {}) }
    const paramLinks = moveKey(design.paramLinks)
    const paramEnumRefs = moveKey(design.paramEnumRefs)
    const nextDesign: NonNullable<DesignRoute['design']> = { ...design }
    if (paramLinks !== undefined) nextDesign.paramLinks = paramLinks
    if (paramEnumRefs !== undefined) nextDesign.paramEnumRefs = paramEnumRefs
    commit({
      ...route,
      doc: { ...route.doc, parameters: nextParameters },
      ...(Object.keys(nextDesign).length > 0 ? { design: nextDesign } : {})
    })
  }, [commit, parameters, route])

  const deleteParam = useCallback((name: string) => {
    const nextParameters = parameters.filter((p) => p.name !== name)
    const { [name]: _l, ...links } = route.design?.paramLinks ?? {}
    const { [name]: _e, ...enumRefs } = route.design?.paramEnumRefs ?? {}
    commit(withParamMaps({ ...route, doc: { ...route.doc, parameters: nextParameters } }, links, enumRefs))
  }, [commit, parameters, route])

  const addParam = useCallback(() => {
    let name = t('design.routes.newParamName', 'param')
    for (let i = 2; parameters.some((p) => p.name === name); i++) name = `${t('design.routes.newParamName', 'param')}${i}`
    patchDoc({ parameters: [...parameters, { name, location: 'query', type: 'string', required: false }] })
  }, [patchDoc, parameters, t])

  const setLink = useCallback((paramName: string, target: { modelId: string; propertyId: string } | null) => {
    const links = { ...(route.design?.paramLinks ?? {}) }
    const enumRefs = { ...(route.design?.paramEnumRefs ?? {}) }
    if (target === null) {
      const { [paramName]: _dropped, ...rest } = links
      commit(withParamMaps(route, rest, enumRefs))
      return
    }
    // A model link and an enum reference are mutually exclusive — clear the
    // enum ref when linking to a property. Re-linking also restores the AUTO
    // mirror: any detached description the parameter carried is cleared, so the
    // badge and the export can never disagree about whose text is served.
    const { [paramName]: _clearedEnum, ...enumRest } = enumRefs
    const parametersWithoutOwnDescription = parameters.map((p) => {
      if (p.name !== paramName) return p
      const { description: _ownDescription, ...rest } = p
      return rest
    })
    commit(withParamMaps(
      { ...route, doc: { ...route.doc, parameters: parametersWithoutOwnDescription } },
      { ...links, [paramName]: { ...target, descriptionAuto: true } },
      enumRest
    ))
  }, [commit, parameters, route])

  // ── Parameter enum: inline values, named-enum reference, extract ────
  const setParamEnumValues = useCallback((paramName: string, values: unknown[]) => {
    updateParam(paramName, (p) => {
      const { enumValues: _dropped, ...rest } = p
      return values.length > 0 ? { ...rest, enumValues: values } : rest
    })
  }, [updateParam])

  const paramEnumRefId = useCallback((name: string): string | undefined => route.design?.paramEnumRefs?.[name], [route.design])

  const setParamEnumRef = useCallback((paramName: string, enumId: string | null) => {
    const links = { ...(route.design?.paramLinks ?? {}) }
    const { [paramName]: _dropped, ...enumRest } = route.design?.paramEnumRefs ?? {}
    // Selecting a named enum clears any model link + inline values (the
    // component is the single source); clearing it just drops the ref.
    const { [paramName]: _clearedLink, ...linkRest } = links
    const nextParams = enumId === null
      ? parameters
      : parameters.map((p) => {
        if (p.name !== paramName) return p
        const { enumValues: _e, ...rest } = p
        return rest
      })
    commit(withParamMaps(
      { ...route, doc: { ...route.doc, parameters: nextParams } },
      enumId === null ? links : linkRest,
      enumId === null ? enumRest : { ...enumRest, [paramName]: enumId }
    ))
  }, [commit, parameters, route])

  const setParamPrimitiveType = useCallback((paramName: string, type: string) => {
    // Set the scalar type AND clear any enum reference for this param in a
    // single commit (the two live in doc vs design — separate commits race).
    const links = { ...(route.design?.paramLinks ?? {}) }
    const { [paramName]: _dropped, ...enumRest } = route.design?.paramEnumRefs ?? {}
    // Picking a plain scalar also drops any INLINE enum values the param
    // carried — otherwise an `integer` param keeps stale string enum values and
    // the combo still reads "· enum ×N" (the named-enum ref is cleared above).
    const nextParams = parameters.map((p) => {
      if (p.name !== paramName) return p
      const { enumValues: _enum, ...rest } = p
      return { ...rest, type }
    })
    commit(withParamMaps({ ...route, doc: { ...route.doc, parameters: nextParams } }, links, enumRest))
  }, [commit, parameters, route])

  const extractParamToEnum = useCallback((paramName: string) => {
    const param = parameters.find((p) => p.name === paramName)
    const values = param?.enumValues ?? []
    if (values.length === 0) return
    const sameValues = (a: unknown[], b: unknown[]): boolean =>
      a.length === b.length && a.every((v, i) => String(v) === String(b[i]))
    const existing = design.enums.find((e) => sameValues(e.doc.enumValues ?? [], values))
    let enumId: string
    if (existing !== undefined) {
      enumId = existing.id
    } else {
      enumId = generateUniqueId()
      const seed = `${pascalCaseName(route.doc.summary ?? route.doc.match.urlPattern)}${pascalCaseName(paramName)}` || 'Enum'
      const name = uniqueComponentName(design, seed)
      assignDesignSection(design, 'enums', [...design.enums, { id: enumId, doc: { name, properties: [], enumValues: values } }])
    }
    setParamEnumRef(paramName, enumId)
  }, [design, parameters, route, setParamEnumRef])

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
      defaultWidth: 150,
      renderCell: (param) => {
        const link = linkFor(param.name)
        return (
          <DesignParamTypeControl
            param={param}
            enumRefId={paramEnumRefId(param.name)}
            inherited={link !== null ? { type: link.type, ...(link.format !== undefined ? { format: link.format } : {}) } : null}
            enums={design.enums}
            onSetType={(typeString) => { setParamPrimitiveType(param.name, typeString) }}
            onSetEnumRef={(enumId) => { setParamEnumRef(param.name, enumId) }}
            onSetEnumValues={(next) => { setParamEnumValues(param.name, next) }}
            onExtract={() => { extractParamToEnum(param.name) }}
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

  const resolvedPath = resolveDesignPath(composeRoutePath({
    ...(design.server?.basePath !== undefined ? { designBasePath: design.server.basePath } : {}),
    groupBasePath: groupChainBasePath(design, group)
  }, route.doc.match.urlPattern), envMap)

  const method = route.doc.match.method ?? 'GET'
  // The method combo mirrors the request editor: verb badges + free-text
  // entry (a custom verb the known set doesn't list is appended so it stays
  // selected).
  const methodOptions = useMemo<ISelectOptionItem[]>(() => {
    const verbs: string[] = [...KNOWN_HTTP_METHODS]
    if (!verbs.includes(method)) verbs.push(method)
    return verbs.map((verb) => ({
      text: verb,
      label: <RegistryBadge badgeId={httpBadgeIdFor(verb)} text={verb} />
    }))
  }, [method])
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
            options={methodOptions}
            selected={Math.max(0, methodOptions.findIndex((opt) => opt.text === method))}
            onDidSelect={(data: ISelectData) => {
              patchDoc({ match: { ...route.doc.match, method: data.selected } })
            }}
            selectBoxOptions={{ ariaLabel: t('design.routes.method', 'Method'), useCustomDrawn: true, editable: true }}
            data-testid="design-route-method"
          />
        </div>
        <div className="design-route-path">
          <RestormVariableInputBox
            value={route.doc.match.urlPattern}
            onChange={(next) => { commit(syncPathParams(route, next)) }}
            variables={envVariables}
            helpers={handlebarsHelpers}
            placeholder="/{{id}}"
            ariaLabel={t('design.routes.path', 'Path')}
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
        <label className="design-field design-field-full">
          <span className="design-field-label">{t('design.tags.routeLabel', 'Tags')}</span>
          <DesignTagsEditor
            tags={route.doc.tags ?? []}
            onChange={(tags) => {
              const { tags: _dropped, ...docRest } = route.doc
              commit({ ...route, doc: tags.length > 0 ? { ...docRest, tags } : docRest })
            }}
            data-testid="design-route-tags"
          />
        </label>
      </div>

      {/* A request body is offered for EVERY method. It is standard on
          POST/PUT/PATCH; on GET/DELETE/HEAD/… it is unusual but not forbidden
          (RFC 9110), and tooling like curl/Postman/Elasticsearch allow it — so
          Restorm lets you define one and just flags it as non-standard. */}
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
        {!BODY_METHODS.has(method) && route.design?.body !== undefined && (
          <span className="design-field-hint" data-testid="design-route-body-nonstandard-hint">
            {t('design.routes.body.nonStandardHint', 'A request body on {{method}} is non-standard — many servers and proxies ignore it. Restorm still serves and documents it.', { method })}
          </span>
        )}
      </label>

      <StaticPane
        title={t('design.routes.params.pathTitle', 'Path parameters')}
        className="design-route-params-pane"
      >
        {pathParams.length === 0
          ? <p className="design-section-placeholder-message">{t('design.routes.params.pathEmpty', 'Type a {{param}} in the path to create its row.', { param: '{{param}}' })}</p>
          : (
            <Table<ParameterDocumentation>
              columns={paramColumns(true)}
              rows={pathParams}
              getRowId={(p) => `path-${p.name}`}
            />
          )}
      </StaticPane>

      <StaticPane
        title={t('design.routes.params.otherTitle', 'Parameters (query / header)')}
        className="design-route-params-pane"
        headerActions={
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
        }
      >
        {otherParams.length === 0
          ? <p className="design-section-placeholder-message">{t('design.routes.params.otherEmpty', 'No query or header parameters yet.')}</p>
          : (
            <Table<ParameterDocumentation>
              columns={paramColumns(false)}
              rows={otherParams}
              getRowId={(p) => `other-${p.name}`}
            />
          )}
      </StaticPane>

      <StaticPane title={t('design.projections.title', 'Projections')} className="design-route-projections-pane">
        <p className="design-section-placeholder-message design-projections-hint">
          {t('design.projections.hint', 'The same operation, as each served protocol exposes it.')}
        </p>
        <div className="design-route-projections" data-testid="design-route-projections">
          {([['http', projections.http], ['graphql', projections.graphql], ['soap', projections.soap], ['odata', projections.odata], ['grpc', projections.grpc]] as const).map(([proto, sig]) => (
            <div
              key={proto}
              className={`design-projection-row${sig === null ? ' design-projection-inactive' : ''}`}
              data-testid={`design-projection-${proto}`}
            >
              <span className="design-projection-proto">{t(`design.protocol.${proto}`)}</span>
              <code className="design-projection-sig">{sig ?? '—'}</code>
            </div>
          ))}
        </div>
      </StaticPane>
    </div>
  )
}
