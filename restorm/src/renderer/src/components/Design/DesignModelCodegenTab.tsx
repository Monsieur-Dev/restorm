import React, { useCallback } from 'react'
import type { ApiDesign, DesignModel } from '../../../../shared/types/collections'
import { useCodegenContextVariables } from '../../hooks/useCodegenContextVariables'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import { useTemplateDeclaredVariables } from '../../hooks/useTemplateDeclaredVariables'
import { replaceModel } from './designMutations'
import { DesignCodegenVariablesPanels } from './DesignCodegenVariablesPanels'

/**
 * The model detail's "Génération de code" tab: per-template MODEL-scope variable
 * values for THIS model. Values are Handlebars expressions evaluated per model at
 * generate time; the value editor offers this model's context (`model.name`,
 * `model.properties…`) plus the env variables.
 */
export const DesignModelCodegenTab: React.FC<{
  design: ApiDesign
  model: DesignModel
}> = ({ design, model }) => {
  const helpers = useHandlebarsHelpers()
  const variables = useCodegenContextVariables(design, { model })
  const templates = design.codegen?.templates ?? []
  const declsByTemplate = useTemplateDeclaredVariables(templates)

  const valuesFor = useCallback(
    (templateId: string): Record<string, string> => model.design?.codegenVars?.[templateId] ?? {},
    [model.design?.codegenVars]
  )
  const declsFor = useCallback(
    (templateId: string) => (declsByTemplate.get(templateId) ?? []).filter((d) => d.scope === 'model'),
    [declsByTemplate]
  )
  const allDeclsFor = useCallback((templateId: string) => declsByTemplate.get(templateId) ?? [], [declsByTemplate])

  const onChange = useCallback((templateId: string, values: Record<string, string>): void => {
    const { [templateId]: _drop, ...rest } = model.design?.codegenVars ?? {}
    const nextVars = Object.keys(values).length === 0 ? rest : { ...rest, [templateId]: values }
    const nextMeta = { ...model.design }
    if (Object.keys(nextVars).length === 0) delete nextMeta.codegenVars
    else nextMeta.codegenVars = nextVars
    const { design: _dropped, ...modelRest } = model
    replaceModel(design, model.id, Object.keys(nextMeta).length > 0 ? { ...modelRest, design: nextMeta } : modelRest)
  }, [design, model])

  return (
    <DesignCodegenVariablesPanels
      templates={templates}
      variables={variables}
      helpers={helpers}
      valuesFor={valuesFor}
      declsFor={declsFor}
      allDeclsFor={allDeclsFor}
      onChange={onChange}
      scopeKey={model.id}
      testIdPrefix="design-model-codegen"
    />
  )
}
