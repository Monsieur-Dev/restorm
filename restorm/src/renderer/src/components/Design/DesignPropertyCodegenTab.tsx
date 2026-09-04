import React, { useCallback } from 'react'
import type { ApiDesign, DesignModel, DesignProperty } from '../../../../shared/types/collections'
import { useCodegenContextVariables } from '../../hooks/useCodegenContextVariables'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import { useTemplateDeclaredVariables } from '../../hooks/useTemplateDeclaredVariables'
import { replaceProperty } from './designMutations'
import { DesignCodegenVariablesPanels } from './DesignCodegenVariablesPanels'

/**
 * The property panel's "Génération de code" tab: per-template PROPERTY-scope
 * variable values for THIS property. Values are Handlebars expressions evaluated
 * per property at generate time; the value editor offers this property's context
 * (`property.name`, `property.type`…) plus its model (`model.*`) and the env
 * variables.
 */
export const DesignPropertyCodegenTab: React.FC<{
  design: ApiDesign
  model: DesignModel
  property: DesignProperty
}> = ({ design, model, property }) => {
  const helpers = useHandlebarsHelpers()
  const variables = useCodegenContextVariables(design, { model, property })
  const templates = design.codegen?.templates ?? []
  const declsByTemplate = useTemplateDeclaredVariables(templates)

  const valuesFor = useCallback(
    (templateId: string): Record<string, string> => property.design?.codegenVars?.[templateId] ?? {},
    [property.design?.codegenVars]
  )
  const declsFor = useCallback(
    (templateId: string) => (declsByTemplate.get(templateId) ?? []).filter((d) => d.scope === 'property'),
    [declsByTemplate]
  )
  const allDeclsFor = useCallback((templateId: string) => declsByTemplate.get(templateId) ?? [], [declsByTemplate])

  const onChange = useCallback((templateId: string, values: Record<string, string>): void => {
    const { [templateId]: _drop, ...rest } = property.design?.codegenVars ?? {}
    const nextVars = Object.keys(values).length === 0 ? rest : { ...rest, [templateId]: values }
    const nextMeta = { ...property.design }
    if (Object.keys(nextVars).length === 0) delete nextMeta.codegenVars
    else nextMeta.codegenVars = nextVars
    const { design: _dropped, ...propertyRest } = property
    replaceProperty(design, model.id, property.id, Object.keys(nextMeta).length > 0 ? { ...propertyRest, design: nextMeta } : propertyRest)
  }, [design, model.id, property])

  return (
    <DesignCodegenVariablesPanels
      templates={templates}
      variables={variables}
      helpers={helpers}
      valuesFor={valuesFor}
      declsFor={declsFor}
      allDeclsFor={allDeclsFor}
      onChange={onChange}
      scopeKey={property.id}
      testIdPrefix="design-property-codegen"
    />
  )
}
