/**
 * Code section — turn the design into a project through a sandboxed
 * template run. The user picks the template SOURCE (official registry /
 * a repository fork / a local folder), the OUTPUT FOLDER (persisted in
 * the design, absolute or project-relative), generates INTO MEMORY, and
 * confirms the previewed tree before a single byte lands on disk.
 * Generation is the paid half of the design capability
 * (DESIGN_RUN_CAPABILITY) and an invalid design cannot generate at all.
 */

import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  GatedControl,
  InputBox,
  ScrollableElement,
  SelectBox,
  useAuthState,
  type ISelectData
} from 'electron-core-ui/renderer'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import type { ApiDesign, DesignCodegen, DesignTemplateSource } from '../../../../shared/types/collections'
import type { DesignIssue } from '../../../../shared/design/validateApiDesign'
import { isDesignRunLocked } from '../../../../shared/auth/planCapabilities'
import { subscribeToPro } from '../../services/subscribeToPro'
import { assignDesignSection } from './designMutations'

/** Mirrors the embedded official registry (main-side source of truth —
 * ids travel over IPC, the list here is only display). */
const OFFICIAL_CHOICES = [
  { id: 'server-typescript', label: 'TypeScript · Express' },
  { id: 'server-dotnet', label: 'C# · ASP.NET Core' },
  { id: 'db-postgres', label: 'SQL · PostgreSQL' }
] as const

type SourceKind = 'official' | 'repo' | 'local'

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

  const persisted = design.codegen ?? {}
  const [sourceKind, setSourceKind] = useState<SourceKind>(persisted.templateSource?.kind ?? 'official')
  const [officialIndex, setOfficialIndex] = useState(() => {
    const source = persisted.templateSource
    if (source?.kind !== 'official') return 0
    const index = OFFICIAL_CHOICES.findIndex((c) => c.id === source.id)
    return index >= 0 ? index : 0
  })
  const [repo, setRepo] = useState(persisted.templateSource?.kind === 'repo' ? persisted.templateSource.repo : '')
  const [localPath, setLocalPath] = useState(persisted.templateSource?.kind === 'local' ? persisted.templateSource.path : '')
  const [outputDir, setOutputDir] = useState(persisted.outputDir ?? '')

  const [generating, setGenerating] = useState(false)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const source = useMemo((): DesignTemplateSource | null => {
    if (sourceKind === 'official') {
      const choice = OFFICIAL_CHOICES[Math.min(officialIndex, OFFICIAL_CHOICES.length - 1)]
      return choice !== undefined ? { kind: 'official', id: choice.id } : null
    }
    if (sourceKind === 'repo') return repo.trim() !== '' ? { kind: 'repo', repo: repo.trim() } : null
    return localPath.trim() !== '' ? { kind: 'local', path: localPath.trim() } : null
  }, [sourceKind, officialIndex, repo, localPath])

  /** Persist template source + output folder into the design (AC#7). */
  const persist = useCallback((patch: Partial<DesignCodegen>) => {
    const next: DesignCodegen = { ...(design.codegen ?? {}), ...patch }
    if (next.outputDir === '') delete next.outputDir
    if (patch.templateSource === undefined && next.templateSource === undefined) delete next.templateSource
    assignDesignSection(design, 'codegen', next)
  }, [design])

  const blocked = issues.length > 0
  const generateTooltip = blocked
    ? t('design.code.blocked', 'Fix the design’s {{count}} validation issue(s) before generating', { count: issues.length })
    : t('design.code.generate', 'Generate the project')

  const generate = useCallback(async () => {
    if (source === null) return
    setMessage(null)
    setPreview(null)
    setGenerating(true)
    persist({ templateSource: source, outputDir })
    try {
      const plain = JSON.parse(JSON.stringify(design)) as ApiDesign
      const result = await window.restorm?.designCodegen.generate(plain, source)
      if (result?.success === true && result.preview !== undefined && result.manifest !== undefined) {
        setPreview({ manifest: result.manifest, preview: result.preview, log: result.log ?? [] })
      } else {
        setMessage(result?.error ?? t('design.code.failed', 'The generation failed'))
      }
    } finally {
      setGenerating(false)
    }
  }, [design, source, outputDir, persist, t])

  const confirmExtract = useCallback(async () => {
    if (outputDir.trim() === '') {
      setMessage(t('design.code.outputMissing', 'Choose an output folder first'))
      return
    }
    const result = await window.restorm?.designCodegen.extract(design.id, outputDir.trim())
    if (result?.success === true) {
      setPreview(null)
      setMessage(t('design.code.extracted', '{{count}} file(s) written to {{root}}', {
        count: result.written?.length ?? 0,
        root: result.root ?? outputDir
      }))
    } else {
      setMessage(result?.error ?? t('design.code.failed', 'The generation failed'))
    }
  }, [design.id, outputDir, t])

  const cancelExtract = useCallback(() => {
    void window.restorm?.designCodegen.discard(design.id)
    setPreview(null)
  }, [design.id])

  const browse = useCallback(async () => {
    const result = await window.restorm?.designCodegen.pickDirectory(outputDir !== '' ? outputDir : undefined)
    if (result?.success === true && result.path !== undefined) {
      setOutputDir(result.path)
      persist({ outputDir: result.path })
    }
  }, [outputDir, persist])

  return (
    <ScrollableElement className="design-section-scroll">
      <div className="design-section design-code" data-testid="design-code-section">
        <h2 className="design-section-title">{t('design.section.code')}</h2>
        <p className="design-section-subtitle">
          {t('design.code.subtitle', 'Generate a project from this design — rendered in a sandbox, written only after you confirm the tree')}
        </p>

        <h3 className="design-settings-group-title">{t('design.code.sourceTitle', 'Template')}</h3>
        <div className="design-code-sources" data-testid="design-code-sources">
          {(['official', 'repo', 'local'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={`design-protocol-pill${sourceKind === kind ? ' active' : ''}`}
              data-testid={`design-code-source-${kind}`}
              onClick={() => { setSourceKind(kind) }}
            >
              {t(`design.code.sourceKind.${kind}`)}
            </button>
          ))}
        </div>
        <div className="design-settings-grid">
          {sourceKind === 'official' && (
            <label className="design-field">
              <span className="design-field-label">{t('design.code.official', 'Official template')}</span>
              <SelectBox
                id="design-code-official"
                className=""
                options={OFFICIAL_CHOICES.map((choice) => ({ text: choice.label }))}
                selected={Math.min(officialIndex, OFFICIAL_CHOICES.length - 1)}
                onDidSelect={(data: ISelectData) => { setOfficialIndex(data.index) }}
                selectBoxOptions={{ ariaLabel: t('design.code.official', 'Official template'), useCustomDrawn: true }}
                data-testid="design-code-official"
              />
            </label>
          )}
          {sourceKind === 'repo' && (
            <label className="design-field">
              <span className="design-field-label">{t('design.code.repo', 'Repository (owner/repo)')}</span>
              <InputBox
                value={repo}
                onChange={(value) => { setRepo(value) }}
                options={{ ariaLabel: t('design.code.repo', 'Repository (owner/repo)') }}
                data-testid="design-code-repo"
              />
            </label>
          )}
          {sourceKind === 'local' && (
            <label className="design-field">
              <span className="design-field-label">{t('design.code.local', 'Local template folder')}</span>
              <InputBox
                value={localPath}
                onChange={(value) => { setLocalPath(value) }}
                options={{ ariaLabel: t('design.code.local', 'Local template folder') }}
                data-testid="design-code-local"
              />
            </label>
          )}
          <label className="design-field">
            <span className="design-field-label">{t('design.code.output', 'Output folder (absolute, or relative to the project)')}</span>
            <div className="design-code-output-row">
              <InputBox
                value={outputDir}
                onChange={(value) => { setOutputDir(value); persist({ outputDir: value }) }}
                options={{ ariaLabel: t('design.code.output', 'Output folder (absolute, or relative to the project)') }}
                data-testid="design-code-output"
              />
              <Button
                icon="folder-opened"
                onClick={() => { void browse() }}
                options={{ ariaLabel: t('design.code.browse', 'Choose the output folder') }}
                data-testid="design-code-browse"
              />
            </div>
          </label>
        </div>

        <div className="design-code-actions">
          <GatedControl locked={runLocked} onSubscribe={() => { void subscribeToPro() }} data-testid="design-code-gate">
            <HeaderHoverTooltip label={generateTooltip}>
              <Button
                onClick={() => { void generate() }}
                disabled={runLocked || blocked || generating || source === null}
                data-testid="design-code-generate"
              >
                {generating
                  ? t('design.code.generating', 'Generating in the sandbox…')
                  : t('design.code.generate', 'Generate the project')}
              </Button>
            </HeaderHoverTooltip>
          </GatedControl>
          {blocked && (
            <span className="design-code-blocked" data-testid="design-code-blocked">
              {t('design.code.blocked', 'Fix the design’s {{count}} validation issue(s) before generating', { count: issues.length })}
            </span>
          )}
        </div>

        {message !== null && (
          <p className="design-code-message" data-testid="design-code-message">{message}</p>
        )}

        {preview !== null && (
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
                onClick={() => { void confirmExtract() }}
                data-testid="design-code-confirm"
              >
                {t('design.code.confirm', 'Write to the output folder')}
              </Button>
              <Button
                onClick={() => { cancelExtract() }}
                data-testid="design-code-cancel"
              >
                {t('design.code.discard', 'Discard')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ScrollableElement>
  )
}
