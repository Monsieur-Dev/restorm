import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListView, StaticPane, type ListViewItemData } from 'electron-core-ui/renderer'
import type { ApiDesign, DesignModel, DesignProperty, DesignRoute, DesignRouteGroup } from '../../../../shared/types/collections'
import type { TemplateVariableScope } from '../../../../shared/design/templateVariables'
import { useCodegenContextVariables } from '../../hooks/useCodegenContextVariables'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import { useTemplateDeclaredVariables } from '../../hooks/useTemplateDeclaredVariables'
import { setTemplateScopeVariables } from './designMutations'
import { DesignCodegenVariablesPanels } from './DesignCodegenVariablesPanels'

/** A representative entity for a scope, so the value editor can suggest
 * `model.*` / `route.*` paths even though a global value applies to all. */
function pickSampleEntity(
  design: ApiDesign,
  scope: TemplateVariableScope
): { model?: DesignModel; property?: DesignProperty; group?: DesignRouteGroup; route?: DesignRoute } {
  if (scope === 'model') return design.models[0] !== undefined ? { model: design.models[0] } : {}
  if (scope === 'property') {
    for (const model of design.models) {
      if (model.properties[0] !== undefined) return { model, property: model.properties[0] }
    }
    return {}
  }
  if (scope === 'route') {
    for (const group of design.routeGroups) {
      if (group.routes[0] !== undefined) return { group, route: group.routes[0] }
    }
  }
  return {}
}

/**
 * The "Variables générales" master-detail (inside the "</> Code" section): a
 * left list [Général | Modèles | Routes] picks the scope; the right shows the
 * per-template panels editing that template's GLOBAL values for the scope
 * (`template.variables[scope]`), applied to every entity of that scope. A global
 * value is a Handlebars formula evaluated PER entity at generate time, so the
 * editor offers a representative entity's context (a sample model / route) for
 * autocomplete.
 */
export const DesignCodegenGeneralVariables: React.FC<{ design: ApiDesign }> = ({ design }) => {
  const { t } = useTranslation()
  const helpers = useHandlebarsHelpers()
  const [scope, setScope] = useState<TemplateVariableScope>('project')
  const templates = design.codegen?.templates ?? []
  const declsByTemplate = useTemplateDeclaredVariables(templates)

  // A global value applies to every entity of the scope, so the editor uses a
  // representative entity's context for autocomplete. Cheap enough to recompute
  // each render (the hook below memoises on a content signature).
  const variables = useCodegenContextVariables(design, pickSampleEntity(design, scope))

  const valuesFor = useCallback(
    (templateId: string): Record<string, string> =>
      design.codegen?.templates?.find((tpl) => tpl.id === templateId)?.variables?.[scope] ?? {},
    [design.codegen, scope]
  )
  const declsFor = useCallback(
    (templateId: string) => (declsByTemplate.get(templateId) ?? []).filter((d) => d.scope === scope),
    [declsByTemplate, scope]
  )
  const allDeclsFor = useCallback((templateId: string) => declsByTemplate.get(templateId) ?? [], [declsByTemplate])
  const onChange = useCallback((templateId: string, values: Record<string, string>): void => {
    setTemplateScopeVariables(design, templateId, scope, values)
  }, [design, scope])

  const items: ListViewItemData[] = [
    { id: 'project', title: t('design.codegen.vars.scope.general', 'General'), icon: <span className="codicon codicon-globe" aria-hidden="true" /> },
    { id: 'model', title: t('design.section.models'), icon: <span className="codicon codicon-symbol-class" aria-hidden="true" /> },
    { id: 'property', title: t('design.codegen.vars.scope.property', 'Model property'), icon: <span className="codicon codicon-symbol-field" aria-hidden="true" /> },
    { id: 'route', title: t('design.section.routes'), icon: <span className="codicon codicon-symbol-event" aria-hidden="true" /> }
  ]

  return (
    <div className="design-section design-entity-list-section design-codegen-general" data-testid="design-codegen-general-section">
      <StaticPane className="design-entity-list" title={t('design.codegen.vars.generalTitle', 'General variables')}>
        <ListView
          items={items}
          rootRole="list"
          ariaLabel={t('design.codegen.vars.generalTitle', 'General variables')}
          selectedIds={[scope]}
          onItemClick={(payload) => { setScope(payload.item.id as TemplateVariableScope) }}
          data-testid="design-codegen-general-scopes"
        />
      </StaticPane>
      <div className="design-entity-detail" data-testid="design-codegen-general-detail">
        <DesignCodegenVariablesPanels
          templates={templates}
          variables={variables}
          helpers={helpers}
          valuesFor={valuesFor}
          declsFor={declsFor}
          allDeclsFor={allDeclsFor}
          onChange={onChange}
          scopeKey={`global:${scope}`}
          testIdPrefix="design-codegen-general"
        />
      </div>
    </div>
  )
}
