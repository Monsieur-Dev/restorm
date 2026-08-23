/**
 * Template library modal (TASK-468.20) — opened from the Code section's "Add"
 * button. Three tabs let the user pick a template source to append to the
 * design's list: recently-used (user MRU), the official registry (repo name +
 * description), and a custom repository / local folder. Picking a source adds
 * it and keeps the modal open (a toast confirms) so several stacks — app,
 * DB, backend — go in without reopening; "Done" closes.
 */

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, InputBox, Modal, Tabs, toasterService, type Tab } from 'electron-core-ui/renderer'
import type { DesignTemplateSource } from '../../../../shared/types/collections'
import { OFFICIAL_CHOICES } from './designOfficialTemplates'
import type { RecentTemplate } from './designCodegenRecents'
import './designTemplateLibrary.css'

export const DesignTemplateLibraryModal: React.FC<{
  isOpen: boolean
  onClose: () => void
  onAdd: (source: DesignTemplateSource, label: string) => void
  recents: RecentTemplate[]
}> = ({ isOpen, onClose, onAdd, recents }) => {
  const { t } = useTranslation()
  const [repo, setRepo] = useState('')
  const [localPath, setLocalPath] = useState('')

  const add = (source: DesignTemplateSource, label: string): void => {
    onAdd(source, label)
    // Stay open — a design often stacks several templates. Confirm with a
    // non-blocking toast; the user closes via "Done" when finished.
    toasterService.push('app', {
      id: 'design-template-added',
      title: t('design.code.library.added', 'Template added'),
      body: label
    })
  }

  /** Human summary of a source, for the recent-row second line. */
  const sourceSummary = (source: DesignTemplateSource): string => {
    if (source.kind === 'official') return t('design.code.library.officialTag', 'Official')
    if (source.kind === 'repo') return source.repo
    return source.path
  }

  const browse = async (): Promise<void> => {
    const result = await window.restorm?.designCodegen.pickDirectory(
      localPath !== '' ? localPath : undefined
    )
    if (result?.success === true && result.path !== undefined) setLocalPath(result.path)
  }

  const recentTab: Tab | null =
    recents.length > 0
      ? {
          id: 'recent',
          label: t('design.code.library.recent', 'Recently used'),
          content: (
            <ul className="design-template-library__list" data-testid="design-template-library-recent">
              {recents.map((entry, index) => (
                <li key={`${entry.label}-${index}`} className="design-template-library__row">
                  <div className="design-template-library__row-text">
                    <span className="design-template-library__row-title">{entry.label}</span>
                    <span className="design-template-library__row-desc">
                      {sourceSummary(entry.source)}
                    </span>
                  </div>
                  <Button
                    onClick={() => { add(entry.source, entry.label) }}
                    data-testid={`design-template-library-recent-add-${index}`}
                  >
                    {t('design.code.library.add', 'Add')}
                  </Button>
                </li>
              ))}
            </ul>
          )
        }
      : null

  const officialTab: Tab = {
    id: 'official',
    label: t('design.code.library.official', 'Official templates'),
    content: (
      <ul className="design-template-library__list" data-testid="design-template-library-official">
        {OFFICIAL_CHOICES.map((choice) => (
          <li key={choice.id} className="design-template-library__row">
            <div className="design-template-library__row-text">
              <span className="design-template-library__row-title">{choice.repo}</span>
              <span className="design-template-library__row-desc">
                {choice.stack} — {t(`design.code.library.officialDesc.${choice.id}`, choice.stack)}
              </span>
            </div>
            <Button
              onClick={() => { add({ kind: 'official', id: choice.id }, choice.stack) }}
              data-testid={`design-template-library-official-add-${choice.id}`}
            >
              {t('design.code.library.add', 'Add')}
            </Button>
          </li>
        ))}
      </ul>
    )
  }

  const customTab: Tab = {
    id: 'custom',
    label: t('design.code.library.custom', 'Custom'),
    content: (
      <div className="design-template-library__custom" data-testid="design-template-library-custom">
        <label className="design-field">
          <span className="design-field-label">{t('design.code.repo', 'Repository (owner/repo)')}</span>
          <div className="design-template-library__custom-row">
            <InputBox
              value={repo}
              onChange={(value) => { setRepo(value) }}
              options={{ ariaLabel: t('design.code.repo', 'Repository (owner/repo)') }}
              data-testid="design-template-library-repo"
            />
            <Button
              disabled={repo.trim() === ''}
              onClick={() => { add({ kind: 'repo', repo: repo.trim() }, repo.trim()) }}
              data-testid="design-template-library-repo-add"
            >
              {t('design.code.library.add', 'Add')}
            </Button>
          </div>
        </label>
        <label className="design-field">
          <span className="design-field-label">{t('design.code.local', 'Local template folder')}</span>
          <div className="design-template-library__custom-row">
            <InputBox
              value={localPath}
              onChange={(value) => { setLocalPath(value) }}
              options={{ ariaLabel: t('design.code.local', 'Local template folder') }}
              data-testid="design-template-library-local"
            />
            <Button
              icon="folder-opened"
              onClick={() => { void browse() }}
              options={{ ariaLabel: t('design.code.browse', 'Choose the output folder') }}
              data-testid="design-template-library-local-browse"
            />
            <Button
              disabled={localPath.trim() === ''}
              onClick={() => { add({ kind: 'local', path: localPath.trim() }, folderLabel(localPath.trim())) }}
              data-testid="design-template-library-local-add"
            >
              {t('design.code.library.add', 'Add')}
            </Button>
          </div>
        </label>
      </div>
    )
  }

  const tabs = [recentTab, officialTab, customTab].filter((tab): tab is Tab => tab !== null)

  return (
    <Modal
      title={t('design.code.library.title', 'Template library')}
      isOpen={isOpen}
      onClose={onClose}
      scopeToSelector=".restorm-workbench-tab"
      data-testid="design-template-library-modal"
    >
      <Tabs tabs={tabs} data-testid="design-template-library-tabs" />
      <div className="design-template-library__footer">
        <Button onClick={onClose} data-testid="design-template-library-done">
          {t('design.code.library.done', 'Done')}
        </Button>
      </div>
    </Modal>
  )
}

/** The trailing folder name of a path, for a local template's label. */
function folderLabel(path: string): string {
  const parts = path.split(/[/\\]/).filter((segment) => segment !== '')
  const last = parts[parts.length - 1]
  return last ?? path
}
