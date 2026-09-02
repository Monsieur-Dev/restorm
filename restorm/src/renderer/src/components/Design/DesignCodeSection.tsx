/**
 * Code section — turn the design into projects through sandboxed template
 * runs. A design carries a LIST of templates (TASK-468.20): the app code, then
 * the DB, then the backend… Each row names a template source + its output
 * folder and has its own round "generate" disc; new rows are added from the
 * template library modal (recent / official / custom). Generation renders INTO
 * MEMORY and the previewed tree is confirmed before a byte lands on disk.
 * Generation is the paid half of the design capability (DESIGN_RUN_CAPABILITY)
 * and an invalid design cannot generate at all.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  ControlGroup,
  GatedControl,
  InputBox,
  Modal,
  Pane,
  ScrollableElement,
  SplitView,
  Tabs,
  toasterService,
  useAuthState
} from 'electron-core-ui/renderer'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { DesignCodegenGeneralVariables } from './DesignCodegenGeneralVariables'
import { DesignTemplateQuestions } from './DesignTemplateQuestions'
import { DesignCodeErrorView } from './DesignCodeErrorView'
import { useCollapsedCodeTemplates } from '../../hooks/useCollapsedCodeTemplates'
import { RoundActionButton } from '../common/RoundActionButton'
import type {
  ApiDesign,
  DesignCodegenTemplate,
  DesignTemplateSource
} from '../../../../shared/types/collections'
import type { DesignIssue } from '../../../../shared/design/validateApiDesign'
import { isDesignRunLocked } from '../../../../shared/auth/planCapabilities'
import { generateUniqueId } from '../../../../shared/utils/reidentifyTree'
import { subscribeToPro } from '../../services/subscribeToPro'
import { assignDesignSection } from './designMutations'
import { officialLabel, officialRepo } from './designOfficialTemplates'
import { DesignTemplateLibraryModal } from './DesignTemplateLibraryModal'
import { loadRecentTemplates, pushRecentTemplate, type RecentTemplate } from './designCodegenRecents'

interface PreviewState {
  manifest: { name: string; type: string; language: string }
  preview: { path: string; bytes: number }[]
  log: string[]
}

export const DesignCodeSection: React.FC<{
  design: ApiDesign
  issues: DesignIssue[]
}> = ({ design, issues }) => {
  const { t } = useTranslation()
  const runLocked = isDesignRunLocked(useAuthState())

  const templates = useMemo(() => design.codegen?.templates ?? [], [design.codegen])
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [recents, setRecents] = useState<RecentTemplate[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  // A generation/extraction FAILURE (often a multi-line sandbox traceback) —
  // shown read-only in a CodeEditor so it stays legible, separate from the short
  // `message` info line.
  const [errorText, setErrorText] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  // Current Copier answers per template, lifted from the questions form so
  // generate can pass them (they are persisted to the output's .copier-answers
  // .yml, never on the design). Keyed by template id.
  const [answersByTemplate, setAnswersByTemplate] = useState<Record<string, Record<string, unknown>>>({})
  const onAnswersChange = useCallback((templateId: string, answers: Record<string, unknown>): void => {
    setAnswersByTemplate((prev) => ({ ...prev, [templateId]: answers }))
  }, [])
  // Collapsed/expanded state of each template pane, persisted in the user
  // profile. `loaded` gates the SplitView (its panes read defaultCollapsed once).
  const { loaded: collapseLoaded, collapsedIds, setCollapsedIds } = useCollapsedCodeTemplates()
  const onPaneCollapsedChange = useCallback((mask: boolean[]): void => {
    setCollapsedIds(templates.filter((_, i) => mask[i] === true).map((tpl) => tpl.id))
  }, [templates, setCollapsedIds])

  useEffect(() => {
    void loadRecentTemplates().then(setRecents)
  }, [libraryOpen])

  const blocked = issues.length > 0

  const persistTemplates = useCallback(
    (next: DesignCodegenTemplate[]) => {
      assignDesignSection(design, 'codegen', next.length > 0 ? { templates: next } : undefined)
    },
    [design]
  )

  const labelFor = useCallback(
    (tpl: DesignCodegenTemplate): string => {
      if (tpl.label !== undefined && tpl.label !== '') return tpl.label
      if (tpl.source.kind === 'official') return officialLabel(tpl.source.id)
      if (tpl.source.kind === 'repo') return tpl.source.repo
      return tpl.source.path
    },
    []
  )

  // The GitHub repo URL (or local path) shown on the "Source" line.
  const sourceUrl = useCallback(
    (source: DesignTemplateSource): string => {
      if (source.kind === 'local') return source.path
      if (source.kind === 'repo') {
        const url = `https://github.com/${source.repo}`
        return source.ref !== undefined && source.ref !== '' ? `${url} @ ${source.ref}` : url
      }
      const repo = officialRepo(source.id)
      return repo !== undefined ? `https://github.com/${repo}` : officialLabel(source.id)
    },
    []
  )

  const addTemplate = useCallback(
    (source: DesignTemplateSource, label: string) => {
      persistTemplates([...templates, { id: generateUniqueId(), source, label }])
    },
    [templates, persistTemplates]
  )

  const updateOutput = useCallback(
    (id: string, value: string) => {
      persistTemplates(
        templates.map((tpl) => {
          if (tpl.id !== id) return tpl
          const next = { ...tpl }
          if (value === '') delete next.outputDir
          else next.outputDir = value
          return next
        })
      )
    },
    [templates, persistTemplates]
  )

  const removeTemplate = useCallback(
    (id: string) => {
      if (activeId === id) {
        void window.restorm?.designCodegen.discard(design.id)
        setActiveId(null)
        setPreview(null)
        setMessage(null)
      }
      persistTemplates(templates.filter((tpl) => tpl.id !== id))
    },
    [templates, persistTemplates, activeId, design.id]
  )

  const browse = useCallback(
    async (id: string, current: string | undefined) => {
      const result = await window.restorm?.designCodegen.pickDirectory(
        current !== undefined && current !== '' ? current : undefined
      )
      if (result?.success === true && result.path !== undefined) updateOutput(id, result.path)
    },
    [updateOutput]
  )

  const generate = useCallback(
    async (tpl: DesignCodegenTemplate) => {
      setActiveId(tpl.id)
      setMessage(null)
      setErrorText(null)
      setPreview(null)
      setGenerating(true)
      try {
        const plain = JSON.parse(JSON.stringify(design)) as ApiDesign
        const answers = answersByTemplate[tpl.id]
        const result = await window.restorm?.designCodegen.generate(plain, tpl.source, answers)
        if (result?.success === true && result.preview !== undefined && result.manifest !== undefined) {
          setPreview({ manifest: result.manifest, preview: result.preview, log: result.log ?? [] })
          void pushRecentTemplate({ source: tpl.source, label: labelFor(tpl) })
        } else {
          setErrorText(result?.error ?? t('design.code.failed', 'The generation failed'))
        }
      } finally {
        setGenerating(false)
      }
    },
    [design, labelFor, t, answersByTemplate]
  )

  const confirmExtract = useCallback(
    async (tpl: DesignCodegenTemplate) => {
      const outputDir = (tpl.outputDir ?? '').trim()
      if (outputDir === '') {
        setMessage(t('design.code.outputMissing', 'Choose an output folder first'))
        return
      }
      const result = await window.restorm?.designCodegen.extract(design.id, outputDir)
      if (result?.success === true) {
        // Files are on disk — dismiss the whole confirm panel and report the
        // result in a non-blocking toast instead of an inline message.
        toasterService.push('app', {
          id: 'design-codegen-written',
          title: t('design.code.extractedTitle', 'Files written'),
          body: t('design.code.extracted', '{{count}} file(s) written to {{root}}', {
            count: result.written?.length ?? 0,
            root: result.root ?? outputDir
          }),
          durationMs: 5000
        })
        setPreview(null)
        setActiveId(null)
        setMessage(null)
      } else {
        setErrorText(result?.error ?? t('design.code.failed', 'The generation failed'))
      }
    },
    [design.id, t]
  )

  const cancelExtract = useCallback(() => {
    void window.restorm?.designCodegen.discard(design.id)
    setPreview(null)
    setActiveId(null)
    setErrorText(null)
  }, [design.id])

  const templateTab = (
    <div className="design-code-template-tab">
        <p className="design-section-subtitle">
          {t(
            'design.code.subtitle',
            'Generate projects from this design — rendered in a sandbox, written only after you confirm the tree'
          )}
        </p>

        {templates.length === 0 && (
          <p className="design-code-empty" data-testid="design-code-empty">
            {t('design.code.empty', 'No template yet — add one to generate code from this design.')}
          </p>
        )}

        {collapseLoaded && templates.length > 0 && (
        <SplitView
          className="design-code-template-list"
          data-testid="design-code-template-list"
          orientation="vertical"
          onCollapsedChange={onPaneCollapsedChange}
        >
          {templates.map((tpl) => (
            <Pane
              key={tpl.id}
              title={labelFor(tpl)}
              minSize={44}
              defaultCollapsed={collapsedIds.has(tpl.id)}
              alwaysShowHeaderActions
              headerActions={
                <HeaderHoverTooltip label={t('design.code.remove', 'Remove this template')}>
                  <Button
                    secondary
                    small
                    icon="trash"
                    disabled={generating && activeId === tpl.id}
                    options={{ ariaLabel: t('design.code.remove', 'Remove this template') }}
                    onClick={() => { setPendingDelete(tpl.id) }}
                    data-testid={`design-code-remove-${tpl.id}`}
                  />
                </HeaderHoverTooltip>
              }
            >
              <ScrollableElement className="design-code-template-scroll">
              <div className="design-code-template-body" data-testid={`design-code-template-${tpl.id}`}>
              <div className="design-code-template-top">
                <div className="design-code-template-play">
                  <GatedControl
                    locked={runLocked}
                    onSubscribe={() => { void subscribeToPro() }}
                    data-testid={`design-code-gate-${tpl.id}`}
                  >
                    <HeaderHoverTooltip
                      label={
                        blocked
                          ? t('design.code.blocked', 'Fix the design’s {{count}} validation issue(s) before generating', { count: issues.length })
                          : (tpl.outputDir ?? '').trim() === ''
                            ? t('design.code.outputMissing', 'Choose an output folder first')
                            : t('design.code.generateOne', 'Generate this project')
                      }
                    >
                      <RoundActionButton
                        icon={generating && activeId === tpl.id ? 'loading' : 'run'}
                        tone="run"
                        size="secondary"
                        disabled={runLocked || blocked || generating || (tpl.outputDir ?? '').trim() === ''}
                        onClick={() => { void generate(tpl) }}
                        ariaLabel={t('design.code.generateOne', 'Generate this project')}
                        data-testid={`design-code-generate-${tpl.id}`}
                      />
                    </HeaderHoverTooltip>
                  </GatedControl>
                </div>
                <div className="design-code-template-fields">
                  <div className="design-code-field-row">
                    <span className="design-code-field-label">{t('design.code.source', 'Source')}</span>
                    <span className="design-code-source-value" title={sourceUrl(tpl.source)}>{sourceUrl(tpl.source)}</span>
                  </div>
                  <div className="design-code-field-row">
                    <span className="design-code-field-label">{t('design.code.destination', 'Destination')}</span>
                    <ControlGroup className="design-code-destination">
                      <InputBox
                        value={tpl.outputDir ?? ''}
                        onChange={(value) => { updateOutput(tpl.id, value) }}
                        options={{
                          ariaLabel: t('design.code.output', 'Output folder (absolute, or relative to the project)'),
                          placeholder: t('design.code.output', 'Output folder (absolute, or relative to the project)')
                        }}
                        data-testid={`design-code-output-${tpl.id}`}
                      />
                      <Button
                        icon="folder-opened"
                        onClick={() => { void browse(tpl.id, tpl.outputDir) }}
                        options={{ ariaLabel: t('design.code.browse', 'Choose the output folder') }}
                        data-testid={`design-code-browse-${tpl.id}`}
                      />
                      <Button
                        icon="link-external"
                        disabled={(tpl.outputDir ?? '').trim() === ''}
                        onClick={() => { void window.restorm?.designCodegen.revealOutput(tpl.id, (tpl.outputDir ?? '').trim()) }}
                        options={{ ariaLabel: t('design.code.openOutput', 'Open the output folder') }}
                        data-testid={`design-code-open-output-${tpl.id}`}
                      />
                    </ControlGroup>
                  </div>
                </div>
              </div>

              <DesignTemplateQuestions template={tpl} onAnswersChange={onAnswersChange} />

              {activeId === tpl.id && message !== null && (
                <p className="design-code-message" data-testid="design-code-message">{message}</p>
              )}

              {activeId === tpl.id && errorText !== null && (
                <DesignCodeErrorView text={errorText} />
              )}

              {activeId === tpl.id && preview !== null && (
                <div className="design-code-preview" data-testid="design-code-preview">
                  <h3 className="design-settings-group-title">
                    {t('design.code.preview', '{{name}} generated {{count}} file(s) — confirm to write them', {
                      name: preview.manifest.name,
                      count: preview.preview.length
                    })}
                  </h3>
                  <ul className="design-code-preview-list">
                    {preview.preview.map((file) => (
                      <li key={file.path} className="design-code-preview-item">
                        <span className="design-code-preview-path">{file.path}</span>
                        <span className="design-code-preview-bytes">{file.bytes}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="design-code-preview-actions">
                    <Button
                      onClick={() => { void confirmExtract(tpl) }}
                      data-testid="design-code-confirm"
                    >
                      {t('design.code.confirm', 'Write to the output folder')}
                    </Button>
                    <Button onClick={() => { cancelExtract() }} data-testid="design-code-cancel">
                      {t('design.code.discard', 'Discard')}
                    </Button>
                  </div>
                </div>
              )}
              </div>
              </ScrollableElement>
            </Pane>
          ))}
        </SplitView>
        )}

        <div className="design-code-actions">
          <Button
            icon="add"
            onClick={() => { setLibraryOpen(true) }}
            data-testid="design-code-add"
          >
            {t('design.code.addTemplate', 'Add a template')}
          </Button>
          {blocked && (
            <span className="design-code-blocked" data-testid="design-code-blocked">
              {t('design.code.blocked', 'Fix the design’s {{count}} validation issue(s) before generating', { count: issues.length })}
            </span>
          )}
        </div>
    </div>
  )

  return (
    <div className="design-section design-code" data-testid="design-code-section">
      <Tabs
        data-testid="design-code-tabs"
        mountStrategy="lazy-once"
        tabs={[
          { id: 'template', label: t('design.code.tabs.template', 'Template'), content: templateTab },
          {
            id: 'variables',
            label: t('design.codegen.vars.generalTitle', 'General variables'),
            content: <DesignCodegenGeneralVariables design={design} />
          }
        ]}
      />

      <DesignTemplateLibraryModal
        isOpen={libraryOpen}
        onClose={() => { setLibraryOpen(false) }}
        onAdd={addTemplate}
        recents={recents}
      />

      {pendingDelete !== null && (
        <Modal
          title={t('design.code.removeTitle', 'Remove this template?')}
          isOpen
          onClose={() => { setPendingDelete(null) }}
          size="dialog"
          data-testid="design-code-remove-modal"
          enterActionTestId="design-code-remove-confirm"
        >
          <div className="design-delete-modal-body">
            <p>
              {t('design.code.removeConfirm', 'The template “{{name}}” will be removed from this design (generated files on disk are left untouched).', {
                name: (() => { const tpl = templates.find((x) => x.id === pendingDelete); return tpl ? labelFor(tpl) : '' })()
              })}
            </p>
            <div className="design-delete-modal-actions">
              <Button secondary onClick={() => { setPendingDelete(null) }} data-testid="design-code-remove-cancel">
                {t('sidebar.deleteConfirm.cancel')}
              </Button>
              <Button onClick={() => { const id = pendingDelete; setPendingDelete(null); removeTemplate(id) }} data-testid="design-code-remove-confirm">
                {t('sidebar.deleteConfirm.confirm')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
