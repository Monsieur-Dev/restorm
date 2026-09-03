/**
 * Template library modal — opened from the Code section's "Add" button. Tabs let
 * the user pick a template source to append to the design's list:
 *   - Recently used (user MRU)
 *   - Templates <org> (the org's own cloud templates — Enterprise only; a
 *     permitted user can add / remove them)
 *   - Official templates (the cloud-curated set — shown only when the backend
 *     returns some)
 *   - Custom (a repository / local folder)
 *
 * The official + org lists are fetched from the cloud `templates` endpoint. A
 * template the user "uses" is appended as a plain `repo` source (its git URL) —
 * the official/org distinction lives only here, in the library. Picking a source
 * keeps the modal open (a toast confirms); "Done" closes.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconView, InputBox, Modal, Tabs, toasterService, type Tab } from 'electron-core-ui/renderer'
import type { DesignTemplateSource } from '../../../../shared/types/collections'
import type { CloudTemplate } from '../../../../shared/types/codegenTemplates'
import type { RecentTemplate } from './designCodegenRecents'
import './designTemplateLibrary.css'

/** Git host → its provider logo, as a Material Design icon (github / gitlab /
 * bitbucket, falling back to the generic `git` mark for anything else). */
function providerIcon(url: string): { type: 'material'; value: string } {
  let host = ''
  try { host = new URL(url).host.toLowerCase() } catch { host = '' }
  if (host.includes('github')) return { type: 'material', value: 'github' }
  if (host.includes('gitlab')) return { type: 'material', value: 'gitlab' }
  if (host.includes('bitbucket')) return { type: 'material', value: 'bitbucket' }
  return { type: 'material', value: 'git' }
}

/** A short display name for a cloud-template row — the `owner/repo` path from
 * its URL (falling back to the raw URL). */
function repoName(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '')
    return path !== '' ? path : url
  } catch {
    return url
  }
}

export const DesignTemplateLibraryModal: React.FC<{
  isOpen: boolean
  onClose: () => void
  onAdd: (source: DesignTemplateSource, label: string) => void
  recents: RecentTemplate[]
}> = ({ isOpen, onClose, onAdd, recents }) => {
  const { t } = useTranslation()
  const [repo, setRepo] = useState('')
  const [localPath, setLocalPath] = useState('')

  const [orgName, setOrgName] = useState<string | null>(null)
  const [isEnterprise, setIsEnterprise] = useState(false)
  const [canManage, setCanManage] = useState(false)
  const [official, setOfficial] = useState<CloudTemplate[]>([])
  const [orgTemplates, setOrgTemplates] = useState<CloudTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signedOut, setSignedOut] = useState(false)

  // Org-template add form.
  const [newUrl, setNewUrl] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    setSignedOut(false)
    try {
      const res = await window.restorm?.designCodegen.listTemplates()
      const view = res?.success === true ? res.view : undefined
      if (view === undefined) {
        if (res?.signedOut === true) setSignedOut(true)
        else setError(res?.error ?? t('design.code.library.unavailable', 'unavailable'))
        setOfficial([])
        setOrgTemplates([])
        return
      }
      setOrgName(view.orgName)
      setIsEnterprise(view.isEnterprise)
      setCanManage(view.canManage)
      setOfficial(view.official)
      setOrgTemplates(view.org)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (isOpen) void refresh()
  }, [isOpen, refresh])

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

  /** "Use" a cloud template → append it as a repo source (its git URL). */
  const applyTemplate = (tpl: CloudTemplate): void => {
    add({ kind: 'repo', repo: tpl.url }, repoName(tpl.url))
  }

  const openRepo = (url: string): void => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const createOrgTemplate = async (): Promise<void> => {
    const url = newUrl.trim()
    if (url === '') return
    setBusy(true)
    setError(null)
    try {
      const res = await window.restorm?.designCodegen.createTemplate(url, newDesc.trim())
      if (res?.success === true) {
        setNewUrl('')
        setNewDesc('')
        await refresh()
      } else {
        setError(res?.error ?? t('design.code.library.unavailable', 'unavailable'))
      }
    } finally {
      setBusy(false)
    }
  }

  const deleteOrgTemplate = async (id: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.restorm?.designCodegen.deleteTemplate(id)
      if (res?.success === true) await refresh()
      else setError(res?.error ?? t('design.code.library.unavailable', 'unavailable'))
    } finally {
      setBusy(false)
    }
  }

  const browse = async (): Promise<void> => {
    const result = await window.restorm?.designCodegen.pickDirectory(
      localPath !== '' ? localPath : undefined
    )
    if (result?.success === true && result.path !== undefined) setLocalPath(result.path)
  }

  /** Human summary of a source, for the recent-row second line. */
  const sourceSummary = (source: DesignTemplateSource): string => {
    if (source.kind === 'repo') return source.repo
    return source.path
  }

  // A cloud-template row: a clickable provider logo (opens the repo in the
  // browser), the repo name + description, an optional Remove, and Use.
  const cloudRow = (
    tpl: CloudTemplate,
    opts: { canRemove: boolean; testidPrefix: string }
  ): React.ReactNode => (
    <li key={tpl.id} className="design-template-library__row">
      <button
        type="button"
        className="design-template-library__logo"
        onClick={() => { openRepo(tpl.url) }}
        title={t('design.code.library.openRepo', 'Open the repository')}
        aria-label={t('design.code.library.openRepo', 'Open the repository')}
        data-testid={`${opts.testidPrefix}-logo-${tpl.id}`}
      >
        <IconView icon={providerIcon(tpl.url)} size={18} />
      </button>
      <div className="design-template-library__row-text">
        <span className="design-template-library__row-title">{repoName(tpl.url)}</span>
        {tpl.description !== null && tpl.description !== '' && (
          <span className="design-template-library__row-desc">{tpl.description}</span>
        )}
      </div>
      {opts.canRemove && (
        <Button
          secondary
          icon="trash"
          disabled={busy}
          onClick={() => { void deleteOrgTemplate(tpl.id) }}
          options={{ ariaLabel: t('design.code.library.remove', 'Remove') }}
          data-testid={`${opts.testidPrefix}-remove-${tpl.id}`}
        />
      )}
      <Button
        onClick={() => { applyTemplate(tpl) }}
        data-testid={`${opts.testidPrefix}-use-${tpl.id}`}
      >
        {t('design.code.library.use', 'Use')}
      </Button>
    </li>
  )

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

  const orgTab: Tab | null = isEnterprise
    ? {
        id: 'org',
        label: orgName !== null && orgName !== ''
          ? t('design.code.library.orgTab', 'Templates {{org}}', { org: orgName })
          : t('design.code.library.orgTabFallback', 'Organization templates'),
        content: (
          <div data-testid="design-template-library-org">
            {orgTemplates.length === 0
              ? (
                <p className="design-template-library__empty">
                  {t('design.code.library.noOrgTemplates', 'No organization templates yet.')}
                </p>
              )
              : (
                <ul className="design-template-library__list">
                  {orgTemplates.map((tpl) =>
                    cloudRow(tpl, { canRemove: canManage, testidPrefix: 'design-template-library-org' })
                  )}
                </ul>
              )}
            {canManage && (
              <div className="design-template-library__add" data-testid="design-template-library-org-add-form">
                <InputBox
                  value={newUrl}
                  onChange={(value) => { setNewUrl(value) }}
                  options={{ placeholder: t('design.code.library.urlPlaceholder', 'Git repository URL') }}
                  data-testid="design-template-library-org-url"
                />
                <InputBox
                  value={newDesc}
                  onChange={(value) => { setNewDesc(value) }}
                  options={{ placeholder: t('design.code.library.descPlaceholder', 'Description (stack / what it generates)') }}
                  data-testid="design-template-library-org-desc"
                />
                <Button
                  disabled={busy || newUrl.trim() === ''}
                  onClick={() => { void createOrgTemplate() }}
                  data-testid="design-template-library-org-create"
                >
                  {t('design.code.library.addTemplate', 'Add template')}
                </Button>
              </div>
            )}
          </div>
        )
      }
    : null

  const officialTab: Tab | null = official.length > 0
    ? {
        id: 'official',
        label: t('design.code.library.official', 'Official templates'),
        content: (
          <ul className="design-template-library__list" data-testid="design-template-library-official">
            {official.map((tpl) =>
              cloudRow(tpl, { canRemove: false, testidPrefix: 'design-template-library-official' })
            )}
          </ul>
        )
      }
    : null

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

  const tabs = [recentTab, orgTab, officialTab, customTab].filter((tab): tab is Tab => tab !== null)

  return (
    <Modal
      title={t('design.code.library.title', 'Template library')}
      isOpen={isOpen}
      onClose={onClose}
      scopeToSelector=".restorm-workbench-tab"
      data-testid="design-template-library-modal"
    >
      {loading && (
        <div className="design-template-library__status" data-testid="design-template-library-loading">
          {t('design.code.library.loading', 'Loading templates…')}
        </div>
      )}
      {signedOut && (
        <div className="design-template-library__status" data-testid="design-template-library-signedout">
          {t('design.code.library.signedOut', 'Sign in to see the official and organization templates.')}
        </div>
      )}
      {error !== null && (
        <div className="design-template-library__error" role="alert" data-testid="design-template-library-error">
          {t('design.code.library.fetchError', 'Could not load templates:')} {error}
        </div>
      )}
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
