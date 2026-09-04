import React, { useCallback } from 'react'
import type { ApiDesign, DesignRoute, DesignRouteGroup } from '../../../../shared/types/collections'
import { useCodegenContextVariables } from '../../hooks/useCodegenContextVariables'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import { useTemplateDeclaredVariables } from '../../hooks/useTemplateDeclaredVariables'
import { replaceRoute } from './designMutations'
import { DesignCodegenVariablesPanels } from './DesignCodegenVariablesPanels'

/**
 * The route detail's "Génération de code" tab: per-template ROUTE-scope
 * variable values for THIS route. Values are Handlebars expressions evaluated
 * per route at generate time; the value editor offers this route's context
 * (`route.method`, `route.fullPath`, `route.params…`) plus the env variables.
 */
export const DesignRouteCodegenTab: React.FC<{
  design: ApiDesign
  group: DesignRouteGroup
  route: DesignRoute
}> = ({ design, group, route }) => {
  const helpers = useHandlebarsHelpers()
  const variables = useCodegenContextVariables(design, { group, route })
  const templates = design.codegen?.templates ?? []
  const declsByTemplate = useTemplateDeclaredVariables(templates)

  const valuesFor = useCallback(
    (templateId: string): Record<string, string> => route.design?.codegenVars?.[templateId] ?? {},
    [route.design?.codegenVars]
  )
  const declsFor = useCallback(
    (templateId: string) => (declsByTemplate.get(templateId) ?? []).filter((d) => d.scope === 'route'),
    [declsByTemplate]
  )
  const allDeclsFor = useCallback((templateId: string) => declsByTemplate.get(templateId) ?? [], [declsByTemplate])

  const onChange = useCallback((templateId: string, values: Record<string, string>): void => {
    const { [templateId]: _drop, ...rest } = route.design?.codegenVars ?? {}
    const nextVars = Object.keys(values).length === 0 ? rest : { ...rest, [templateId]: values }
    const nextMeta = { ...route.design }
    if (Object.keys(nextVars).length === 0) delete nextMeta.codegenVars
    else nextMeta.codegenVars = nextVars
    const { design: _dropped, ...routeRest } = route
    replaceRoute(design, group.id, route.id, Object.keys(nextMeta).length > 0 ? { ...routeRest, design: nextMeta } : routeRest)
  }, [design, group.id, route])

  return (
    <DesignCodegenVariablesPanels
      templates={templates}
      variables={variables}
      helpers={helpers}
      valuesFor={valuesFor}
      declsFor={declsFor}
      allDeclsFor={allDeclsFor}
      onChange={onChange}
      scopeKey={route.id}
      testIdPrefix="design-route-codegen"
    />
  )
}
