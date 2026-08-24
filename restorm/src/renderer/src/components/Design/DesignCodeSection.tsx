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
  GatedControl,
  InputBox,
  Modal,
  ScrollableElement,
  toasterService,
  useAuthState
} from 'electron-core-ui/renderer'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
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
import { officialLabel } from './designOfficialTemplates'
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
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

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

  const sourceSummary = useCallback(
    (source: DesignTemplateSource): string => {
      if (source.kind === 'official') return t('design.code.library.officialTag', 'Official')
      if (source.kind === 'repo') return source.repo
      return source.path
    },
    [t]
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
      setPreview(null)
      setGenerating(true)
      try {
        const plain = JSON.parse(JSON.stringify(design)) as ApiDesign
        const result = await window.restorm?.designCodegen.generate(plain, tpl.source)
        if (result?.success === true && result.preview !== undefined && result.manifest !== undefined) {
          setPreview({ manifest: result.manifest, preview: result.preview, log: result.log ?? [] })
          void pushRecentTemplate({ source: tpl.source, label: labelFor(tpl) })
        } else {
          setMessage(result?.error ?? t('design.code.failed', 'The generation failed'))
        }
      } finally {
        setGenerating(false)
      }
    },
    [design, labelFor, t]
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
          })
        })
        setPreview(null)
        setActiveId(null)
        setMessage(null)
      } else {
        setMessage(result?.error ?? t('design.code.failed', 'The generation failed'))
      }
    },
    [design.id, t]
  )

  const cancelExtract = useCallback(() => {
    void window.restorm?.designCodegen.discard(design.id)
    setPreview(null)
    setActiveId(null)
  }, [design.id])

  return (
    <ScrollableElement className="design-section-scroll">
      <div className="design-section design-code" data-testid="design-code-section">
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

        <ul className="design-code-template-list" data-testid="design-code-template-list">
          {templates.map((tpl) => (
            <li key={tpl.id} className="design-code-template" data-testid={`design-code-template-${tpl.id}`}>
              <div className="design-code-template-head">
                <div className="design-code-template-text">
                  <span className="design-code-template-title">{labelFor(tpl)}</span>
                  <span className="design-code-template-source">{sourceSummary(tpl.source)}</span>
                </div>
                <div className="design-code-template-output">
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
                </div>
                <div className="design-code-template-actions">
                  <Button
                    icon="trash"
                    disabled={generating && activeId === tpl.id}
                    onClick={() => { setPendingDelete(tpl.id) }}
                    options={{ ariaLabel: t('design.code.remove', 'Remove this template') }}
                    data-testid={`design-code-remove-${tpl.id}`}
                  />
                  <GatedControl
                    locked={runLocked}
                    onSubscribe={() => { void subscribeToPro() }}
                    data-testid={`design-code-gate-${tpl.id}`}
                  >
                    <HeaderHoverTooltip
                      label={
                        blocked
                          ? t('design.code.blocked', 'Fix the design’s {{count}} validation issue(s) before generating', { count: issues.length })
                          : t('design.code.generateOne', 'Generate this project')
                      }
                    >
                      <RoundActionButton
                        icon={generating && activeId === tpl.id ? 'loading' : 'run'}
                        tone="run"
                        size="secondary"
                        disabled={runLocked || blocked || generating}
                        onClick={() => { void generate(tpl) }}
                        ariaLabel={t('design.code.generateOne', 'Generate this project')}
                        data-testid={`design-code-generate-${tpl.id}`}
                      />
                    </HeaderHoverTooltip>
                  </GatedControl>
                </div>
              </div>

              {activeId === tpl.id && message !== null && (
                <p className="design-code-message" data-testid="design-code-message">{message}</p>
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
            </li>
          ))}
        </ul>

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
    </ScrollableElement>
  )
}
