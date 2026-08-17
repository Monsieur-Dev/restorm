import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  InputBox,
  MessageType,
  SelectBox,
  Toggle,
  type ISelectData
} from 'electron-core-ui/renderer'
import type {
  ApiDesign,
  DesignRoute,
  DesignRouteGroup,
  DesignResponseMeta
} from '../../../../shared/types/collections'
import { buildErrorModel, findErrorModel, withStandardErrorResponses } from '../../../../shared/design/designRoutes'
import { generateUniqueId } from '../../utils/treeManipulation'
import { assignDesignSection, replaceRoute } from './designMutations'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'

export interface RouteResponsesTabProps {
  design: ApiDesign
  group: DesignRouteGroup
  route: DesignRoute
}

/**
 * The Réponses tab: one accordion row per status code — collapsed rows
 * summarise (model, cardinality, example), the expanded row edits
 * model / list+paginated / served example / description. The standard-
 * errors action posts 400/401/404/500 at once, minting the shared
 * Error model on first use.
 */
/** Rebuild a route with the given response metas, omitting empty bags —
 * `design: { responses: {} }` must never reach the file. */
function withResponses(route: DesignRoute, responses: Record<string, DesignResponseMeta>): DesignRoute {
  const { responses: _dropped, ...designRest } = route.design ?? {}
  const design = Object.keys(responses).length > 0 ? { ...designRest, responses } : designRest
  const { design: _oldDesign, ...routeRest } = route
  const next: DesignRoute = { ...routeRest }
  if (Object.keys(design).length > 0) next.design = design
  return next
}

export const RouteResponsesTab: React.FC<RouteResponsesTabProps> = ({ design, group, route }) => {
  const { t } = useTranslation()
  const [expandedCode, setExpandedCode] = useState<string | null>(null)
  const [newCode, setNewCode] = useState('')

  const commit = useCallback((next: DesignRoute) => {
    replaceRoute(design, group.id, route.id, next)
  }, [design, group.id, route.id])

  const codes = Object.keys(route.doc.responses ?? {}).sort()

  const addCode = useCallback(() => {
    const code = newCode.trim()
    if (!/^[1-5][0-9]{2}$/.test(code) || route.doc.responses?.[code] !== undefined) return
    commit({
      ...route,
      doc: { ...route.doc, responses: { ...(route.doc.responses ?? {}), [code]: {} } }
    })
    setNewCode('')
    setExpandedCode(code)
  }, [commit, newCode, route])

  const deleteCode = useCallback((code: string) => {
    const { [code]: _doc, ...docResponses } = route.doc.responses ?? {}
    const { [code]: _meta, ...designResponses } = route.design?.responses ?? {}
    commit(withResponses({ ...route, doc: { ...route.doc, responses: docResponses } }, designResponses))
    if (expandedCode === code) setExpandedCode(null)
  }, [commit, expandedCode, route])

  const addStandardErrors = useCallback(() => {
    let errorModel = findErrorModel(design)
    if (errorModel === undefined) {
      errorModel = buildErrorModel(generateUniqueId)
      assignDesignSection(design, 'models', [...design.models, errorModel])
    }
    commit(withStandardErrorResponses(route, errorModel.id))
  }, [commit, design, route])

  const patchMeta = useCallback((code: string, patch: { [K in keyof DesignResponseMeta]?: DesignResponseMeta[K] | undefined }) => {
    const merged = { ...(route.design?.responses?.[code] ?? {}), ...patch }
    const cleaned: DesignResponseMeta = {}
    if (merged.modelId !== undefined) cleaned.modelId = merged.modelId
    if (merged.list !== undefined) cleaned.list = merged.list
    if (merged.paginated !== undefined) cleaned.paginated = merged.paginated
    if (merged.exampleId !== undefined) cleaned.exampleId = merged.exampleId
    commit(withResponses(route, { ...(route.design?.responses ?? {}), [code]: cleaned }))
  }, [commit, route])

  const patchDescription = useCallback((code: string, value: string) => {
    const current = route.doc.responses?.[code] ?? {}
    const { description: _dropped, ...rest } = current
    commit({
      ...route,
      doc: {
        ...route.doc,
        responses: { ...(route.doc.responses ?? {}), [code]: value === '' ? rest : { ...rest, description: value } }
      }
    })
  }, [commit, route])

  const summaryOf = (code: string): string => {
    const meta = route.design?.responses?.[code]
    const doc = route.doc.responses?.[code]
    if (meta?.modelId === undefined) return doc?.description ?? t('design.routes.responses.emptyBody', 'empty body')
    const model = design.models.find((m) => m.id === meta.modelId)
    const name = model?.doc.name ?? '?'
    if (meta.list === true) {
      return meta.paginated === true
        ? t('design.routes.responses.paginatedListOf', 'paginated list of {{name}}', { name })
        : t('design.routes.responses.listOf', 'list of {{name}}', { name })
    }
    return name
  }

  return (
    <div className="design-route-responses" data-testid={`design-route-responses-${route.id}`}>
      <div className="design-route-responses-actions">
        <InputBox
          value={newCode}
          onChange={setNewCode}
          options={{
            type: 'text',
            placeholder: '404',
            maxLength: 3,
            ariaLabel: t('design.routes.responses.codePlaceholder', 'Status code'),
            validationOptions: {
              validation: (value: string) => {
                if (value === '') return null
                if (!/^[1-5][0-9]{2}$/.test(value)) return { content: t('design.routes.responses.codeInvalid', 'Enter a 3-digit status code'), type: MessageType.ERROR }
                if (route.doc.responses?.[value] !== undefined) return { content: t('design.routes.responses.codeTaken', 'This code is already declared'), type: MessageType.ERROR }
                return null
              }
            }
          }}
          className="design-response-code-input"
          data-testid="design-response-new-code"
        />
        <Button icon="add" secondary onClick={addCode} data-testid="design-response-add">
          {t('design.routes.responses.add', 'Add')}
        </Button>
        <Button secondary onClick={addStandardErrors} data-testid="design-response-standard-errors">
          {t('design.routes.responses.standardErrors', '+ standard errors')}
        </Button>
      </div>

      {codes.length === 0 && (
        <p className="design-section-placeholder-message">{t('design.routes.responses.empty', 'No response declared yet.')}</p>
      )}

      {codes.map((code) => {
        const meta = route.design?.responses?.[code] ?? {}
        const doc = route.doc.responses?.[code] ?? {}
        const expanded = expandedCode === code
        const model = meta.modelId !== undefined ? design.models.find((m) => m.id === meta.modelId) : undefined
        const modelOptions = [{ text: t('design.routes.body.empty', '(empty)') }, ...design.models.map((m) => ({ text: m.doc.name }))]
        const modelIndex = meta.modelId === undefined ? 0 : Math.max(0, design.models.findIndex((m) => m.id === meta.modelId) + 1)
        const examples = model?.examples ?? []
        const exampleOptions = [{ text: t('design.routes.responses.exampleAuto', '(seeded auto)') }, ...examples.map((e) => ({ text: e.name }))]
        const exampleIndex = meta.exampleId === undefined ? 0 : Math.max(0, examples.findIndex((e) => e.id === meta.exampleId) + 1)

        return (
          <div key={code} className={`design-response-row${expanded ? ' expanded' : ''}`} data-testid={`design-response-${code}`}>
            <button
              type="button"
              className="design-response-header"
              aria-expanded={expanded}
              onClick={() => { setExpandedCode(expanded ? null : code) }}
              data-testid={`design-response-header-${code}`}
            >
              <span className={`codicon codicon-chevron-${expanded ? 'down' : 'right'}`} />
              <span className="design-response-code">{code}</span>
              <span className="design-response-summary">{summaryOf(code)}</span>
            </button>
            {expanded && (
              <div className="design-response-body">
                <div className="design-settings-grid">
                  <label className="design-field">
                    <span className="design-field-label">{t('design.routes.responses.model', 'Returned model')}</span>
                    <SelectBox
                      id={`design-response-model-${route.id}-${code}`}
                      className=""
                      options={modelOptions}
                      selected={modelIndex}
                      onDidSelect={(data: ISelectData) => {
                        const index = modelOptions.findIndex((opt) => opt.text === data.selected)
                        const picked = index <= 0 ? undefined : design.models[index - 1]
                        patchMeta(code, picked === undefined
                          ? { modelId: undefined, list: undefined, paginated: undefined, exampleId: undefined }
                          : { modelId: picked.id, exampleId: undefined })
                      }}
                      selectBoxOptions={{ ariaLabel: t('design.routes.responses.model', 'Returned model'), useCustomDrawn: true }}
                      data-testid={`design-response-model-${code}`}
                    />
                  </label>
                  {meta.modelId !== undefined && (
                    <>
                      <label className="design-flag-toggle">
                        <span className="design-field-label">{t('design.routes.responses.list', 'List')}</span>
                        <Toggle
                          checked={meta.list === true}
                          onChange={(checked) => { patchMeta(code, checked ? { list: true } : { list: undefined, paginated: undefined }) }}
                          aria-label={t('design.routes.responses.list', 'List')}
                          data-testid={`design-response-list-${code}`}
                        />
                      </label>
                      {meta.list === true && (
                        <label className="design-flag-toggle">
                          <span className="design-field-label">{t('design.routes.responses.paginated', 'Paginated')}</span>
                          <Toggle
                            checked={meta.paginated === true}
                            onChange={(checked) => { patchMeta(code, { paginated: checked ? true : undefined }) }}
                            aria-label={t('design.routes.responses.paginated', 'Paginated')}
                            data-testid={`design-response-paginated-${code}`}
                          />
                        </label>
                      )}
                      <label className="design-field">
                        <span className="design-field-label">{t('design.routes.responses.example', 'Served example')}</span>
                        <SelectBox
                          id={`design-response-example-${route.id}-${code}`}
                          className=""
                          options={exampleOptions}
                          selected={exampleIndex}
                          onDidSelect={(data: ISelectData) => {
                            const index = exampleOptions.findIndex((opt) => opt.text === data.selected)
                            const picked = index <= 0 ? undefined : examples[index - 1]
                            patchMeta(code, { exampleId: picked?.id })
                          }}
                          selectBoxOptions={{ ariaLabel: t('design.routes.responses.example', 'Served example'), useCustomDrawn: true }}
                          data-testid={`design-response-example-${code}`}
                        />
                      </label>
                    </>
                  )}
                  <label className="design-field design-field-full">
                    <span className="design-field-label">{t('design.schema.fields.description', 'Description')}</span>
                    <InputBox
                      value={doc.description ?? ''}
                      onChange={(next) => { patchDescription(code, next) }}
                      options={{ type: 'text', ariaLabel: t('design.schema.fields.description', 'Description') }}
                      data-testid={`design-response-description-${code}`}
                    />
                  </label>
                </div>
                <HeaderHoverTooltip label={t('design.routes.responses.delete', 'Delete the response')}>
                  <Button
                    secondary
                    small
                    icon="trash"
                    options={{ ariaLabel: t('design.routes.responses.delete', 'Delete the response') }}
                    onClick={() => { deleteCode(code) }}
                    data-testid={`design-response-delete-${code}`}
                  />
                </HeaderHoverTooltip>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
