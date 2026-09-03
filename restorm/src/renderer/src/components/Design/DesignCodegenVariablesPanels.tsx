import React, { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, StaticPane, type VariableDefinition } from 'electron-core-ui/renderer'
import type { TranslatedHelperDefinition } from '../../utils/handlebarsHelpersDefinitions'
import type { DesignCodegenTemplate } from '../../../../shared/types/collections'
import type { TemplateVariableDecl } from '../../../../shared/design/templateVariables'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { CodegenVariablesEditor, type CodegenVariablesEditorHandle } from './CodegenVariablesEditor'

/** A friendly label for a configured template row (mirrors the Code section). */
function templateLabel(template: DesignCodegenTemplate): string {
  if (template.label !== undefined && template.label !== '') return template.label
  const source = template.source
  if (source.kind === 'repo') return source.repo
  return source.path.split(/[/\\]/).filter(Boolean).pop() ?? source.path
}

/** One template's pane: an ECUI StaticPane titled with the template, its "Add"
 * button in the header, and the key/value editor as its body. */
const CodegenTemplatePane: React.FC<{
  template: DesignCodegenTemplate
  variables: VariableDefinition[]
  helpers?: TranslatedHelperDefinition[]
  values: Record<string, string>
  decls: TemplateVariableDecl[]
  /** ALL declared variables (every scope) — discovery reconciles against these,
   * so a project var used in a route file isn't flagged undeclared in a route pane. */
  allDecls: TemplateVariableDecl[]
  onChange: (values: Record<string, string>) => void
  scopeKey: string
  testIdPrefix: string
}> = ({ template, variables, helpers, values, decls, allDecls, onChange, scopeKey, testIdPrefix }) => {
  const { t } = useTranslation()
  const editorRef = useRef<CodegenVariablesEditorHandle>(null)
  // Remount the editor when the manifest decls arrive (they seed the rows once).
  const declsKey = decls.map((d) => d.name).join(',')

  // DISCOVERY (on demand — acquiring a remote template is heavy): the variable
  // names the template's files actually reference, reconciled with the declared
  // set to surface undeclared-but-used ones.
  const [used, setUsed] = useState<string[] | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const discover = useCallback(async (): Promise<void> => {
    const getUsedVariables = window.restorm?.designCodegen.getUsedVariables
    if (typeof getUsedVariables !== 'function') return
    setDiscovering(true)
    try {
      const result = await getUsedVariables(template.source)
      setUsed(result.success && result.used !== undefined ? result.used : [])
    } finally {
      setDiscovering(false)
    }
  }, [template.source])
  const undeclared = used === null ? null : used.filter((name) => !allDecls.some((d) => d.name === name))

  return (
    <StaticPane
      className="design-codegen-vars-pane"
      title={templateLabel(template)}
      data-testid={`${testIdPrefix}-panel-${template.id}`}
      headerActions={
        <>
          <HeaderHoverTooltip label={t('design.codegen.vars.discover', 'Discover the variables this template uses')}>
            <Button
              secondary
              small
              icon="search"
              disabled={discovering}
              options={{ ariaLabel: t('design.codegen.vars.discover', 'Discover the variables this template uses') }}
              onClick={() => { void discover() }}
              data-testid={`${testIdPrefix}-discover-${template.id}`}
            />
          </HeaderHoverTooltip>
          <HeaderHoverTooltip label={t('design.codegen.vars.add', 'Add a variable')}>
            <Button
              secondary
              small
              icon="add"
              options={{ ariaLabel: t('design.codegen.vars.add', 'Add a variable') }}
              onClick={() => { editorRef.current?.addRow() }}
              data-testid={`${testIdPrefix}-add-${template.id}`}
            />
          </HeaderHoverTooltip>
        </>
      }
    >
      <CodegenVariablesEditor
        ref={editorRef}
        key={`${template.id}:${scopeKey}:${declsKey}`}
        values={values}
        decls={decls}
        onChange={onChange}
        variables={variables}
        {...(helpers !== undefined ? { helpers } : {})}
        testIdPrefix={`${testIdPrefix}-editor-${template.id}`}
      />
      {undeclared !== null && (
        <p className="design-codegen-vars-discovery" data-testid={`${testIdPrefix}-discovery-${template.id}`}>
          {undeclared.length > 0
            ? t('design.codegen.vars.undeclared', 'Used but not declared: {{names}}', { names: undeclared.join(', ') })
            : t('design.codegen.vars.allDeclared', 'Every variable this template uses is declared.')}
        </p>
      )}
    </StaticPane>
  )
}

export interface DesignCodegenVariablesPanelsProps {
  /** The design's configured templates — one pane each. */
  templates: DesignCodegenTemplate[]
  /** Contextual variables the value editor offers (content-stable). */
  variables: VariableDefinition[]
  helpers?: TranslatedHelperDefinition[]
  /** Stored values for a template (variable name → Handlebars expression). */
  valuesFor: (templateId: string) => Record<string, string>
  /** Variables the template declares for THIS scope (pre-filled keys). */
  declsFor: (templateId: string) => TemplateVariableDecl[]
  /** ALL variables the template declares (every scope) — for discovery reconciliation. */
  allDeclsFor: (templateId: string) => TemplateVariableDecl[]
  onChange: (templateId: string, values: Record<string, string>) => void
  /** Identifies the entity so each editor remounts on entity switch. */
  scopeKey: string
  testIdPrefix: string
}

/**
 * The shared body of every code-generation variables surface: one ECUI pane per
 * configured template (Yoann's "un pane par template"), each holding that
 * template's key/value Handlebars editor with its "Add" button in the pane
 * header. Reused by the per-entity "Génération de code" tabs (model / route)
 * and the "Variables générales" master-detail.
 */
export const DesignCodegenVariablesPanels: React.FC<DesignCodegenVariablesPanelsProps> = ({
  templates, variables, helpers, valuesFor, declsFor, allDeclsFor, onChange, scopeKey, testIdPrefix
}) => {
  const { t } = useTranslation()

  if (templates.length === 0) {
    return (
      <div className="design-codegen-vars-empty-state" data-testid={`${testIdPrefix}-empty`}>
        <p>{t('design.codegen.vars.noTemplates', 'Choose one or more templates in the “</> Code” section — you’ll then define the variables used by generation here.')}</p>
      </div>
    )
  }

  return (
    <div className="design-codegen-vars-panels" data-testid={testIdPrefix}>
      {templates.map((template) => (
        <CodegenTemplatePane
          key={template.id}
          template={template}
          variables={variables}
          {...(helpers !== undefined ? { helpers } : {})}
          values={valuesFor(template.id)}
          decls={declsFor(template.id)}
          allDecls={allDeclsFor(template.id)}
          onChange={(values) => { onChange(template.id, values) }}
          scopeKey={scopeKey}
          testIdPrefix={testIdPrefix}
        />
      ))}
    </div>
  )
}
