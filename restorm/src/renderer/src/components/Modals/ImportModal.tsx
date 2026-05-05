/**
 * ImportModal - Modal for importing requests from various sources
 */

import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  Modal,
  Button,
  InputBox
} from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import type { FolderItem, EnvironmentFolder } from '../../../../shared/types/collections'
import { isEnvironmentFolder, isRequest } from '../../../../shared/types/collections'
import type { AuthenticationRequest } from '../../../../shared/models'
import { logger } from 'electron-core-ui/renderer'
import { AuthenticationSetupModal } from './AuthenticationSetupModal'
import { ImportFormatShowcase } from './ImportFormatShowcase'
import { ImportSelectionTree } from './ImportSelectionTree'
import { allLeafKeys } from './importSelectionHelpers'
import { filterImportTreeBySelection } from '../../../../shared/utils/importNaturalKey'
import './ImportModal.css'

/**
 * Optional payload that flips the modal into "Refresh from source"
 * mode. When set, the modal:
 *
 * - Pre-fills the source URL + the attached auth route from the
 *   already-imported env folder. Both fields are display-only —
 *   they're sourced from the env folder's stored apiUpdate config
 *   and aren't editable in this flow.
 * - Calls `apiUpdate.previewTree(targetFolderId)` to get the parsed
 *   preview tree + the set of leaves whose operation already lives
 *   in the target. Locked leaves arrive checked + disabled (the user
 *   can't opt them out without losing a route the folder already
 *   exposes); other leaves arrive unchecked and surface as opt-in
 *   additions.
 * - Replaces the "Import" button with "Apply update" and routes the
 *   confirm action to `apiUpdate.apply` instead of the fresh-import
 *   handler. The callback receives the resulting payload so the host
 *   can splice the new requests onto its own copy of the env folder.
 */
export interface RefreshContext {
  sourceUrl: string
  authenticationRequest?: AuthenticationRequest
  targetFolderId: string
  onApplied: (updatedFolder: unknown) => void
}

export interface ImportModalProps {
  isOpen: boolean
  onClose: () => void
  onImport: (items: FolderItem[]) => void
  refreshContext?: RefreshContext
}

export function ImportModal({
  isOpen,
  onClose,
  onImport,
  refreshContext
}: ImportModalProps): React.JSX.Element {
  const { t } = useTranslation()
  
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [previewItems, setPreviewItems] = useState<FolderItem[]>([])
  /**
   * Set of leaf natural keys the user wants to import. Initialised
   * to the full leaf set whenever a fresh preview lands so the
   * default behaviour matches the legacy "import everything" UX,
   * then narrowed as the user un-checks rows in the selection tree.
   */
  const [selection, setSelection] = useState<Set<string>>(() => new Set())
  const [searchFilter, setSearchFilter] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [attachedAuth, setAttachedAuth] = useState<AuthenticationRequest | null>(null)
  // Resolved auth headers live in a ref rather than state — the only
  // consumer is the debounced preview closure, and we need the value
  // to be readable synchronously after `handleAuthAttach` fires
  // (React state updates batch, so a closure would see `null`).
  const attachedAuthHeadersRef = useRef<Record<string, string> | null>(null)
  const [showAuthSetupModal, setShowAuthSetupModal] = useState(false)
  /**
   * Set of leaf natural keys whose checkbox is forced-on + disabled
   * because their operation already exists in the target folder.
   * Populated from `apiUpdate.previewTree`'s `lockedKeys` array on
   * refresh-from-source, empty in fresh-import mode.
   */
  const [lockedKeys, setLockedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Handle input change with debounce
  const handleInputChange = useCallback((value: string) => {
    setInput(value)
    setError(null)

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // If input is empty, clear preview immediately
    if (!value.trim()) {
      logger.warn('[ImportModal] Clearing preview items - input is empty', { value })
      setPreviewItems([])
      setSelection(new Set())
      setSearchFilter('')
      setIsLoading(false)
      debounceTimerRef.current = null
      return
    }

    // Set loading state
    setIsLoading(true)

    // Debounce the preview
    debounceTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          // Read through the ref so the current value lands in the
          // fetch options even when state updates haven't propagated
          // through the closure yet (auth-attach re-preview path).
          const currentHeaders = attachedAuthHeadersRef.current
          const previewOptions = currentHeaders !== null
            ? { extraHeaders: currentHeaders }
            : undefined
          const result = await window.restorm?.import.preview(value.trim(), previewOptions)

          if (result?.success) {
            setPreviewItems(result.items as FolderItem[])
            setError(null)
          } else {
            setPreviewItems([])
            setError(result?.error ?? t('import.error.unknown'))
          }
        } catch (err) {
          setPreviewItems([])
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setIsLoading(false)
        }
      })()
    }, 200)
  }, [t])

  // Handle drag and drop
  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()

    const files = event.dataTransfer.files
    if (files.length > 0) {
      const file = files[0]
      if (file) {
        handleInputChange((file as { path?: string }).path ?? file.name)
      }
    }
  }, [handleInputChange])

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  // Handle import click
  const handleImportClick = useCallback(() => {
    if (previewItems.length === 0) return
    if (selection.size === 0) return

    // Refresh-from-source confirm path: route through the apiUpdate
    // apply IPC instead of the fresh-import handler. Selection is
    // already in ImportSelectionTree key shape (`request:http:METHOD
    // …`, `request:graphql:…`, …); main translates back to pipeline
    // naturalKeys before filtering the spec. We hand both `include`
    // and `skip` so a previously-skipped route stays skipped on the
    // next refresh unless the user explicitly opts it in here.
    if (refreshContext) {
      const allKeys = allLeafKeys(previewItems)
      const include = Array.from(selection).sort()
      const skip = Array.from(allKeys).filter((k) => !selection.has(k)).sort()
      void (async () => {
        try {
          const api = (window as unknown as {
            restorm?: { apiUpdate?: { apply: (id: string, sel: { include: string[]; skip: string[] }) => Promise<{ updatedFolder: unknown }> } }
          }).restorm?.apiUpdate
          const result = await api?.apply(refreshContext.targetFolderId, { include, skip })
          refreshContext.onApplied(result?.updatedFolder)
        } catch (err) {
          logger.error('[ImportModal] apiUpdate.apply failed', { error: err instanceof Error ? err.message : String(err) })
        } finally {
          onClose()
        }
      })()
      return
    }

    // Apply the user's selective-import choice before any further
    // transformation: leaves not in `selection` are dropped, and
    // folders that lose all of their selected descendants are
    // pruned. The auth-attach pass and the upstream import pipeline
    // only see the kept subset, so skipped items never materialise.
    const selectedItems = filterImportTreeBySelection(previewItems, selection)

    // If the user attached an auth request, wire every imported
    // request to reference it and nest the auth route itself as the
    // FIRST child of the top-level imported folder (usually the
    // env-folder the importer produced). The auth route belongs to
    // the imported collection, not to whatever sits next to it at
    // the true root — folder-mode save then lays it out as
    // `Microsoft.Dynamics.CRM/0001 - Authentication route.yaml`
    // instead of writing a stray auth folder alongside the env
    // folder.
    let finalItems: FolderItem[] = selectedItems
    if (attachedAuth) {
      const authId = attachedAuth.id
      const attach = (items: FolderItem[]): FolderItem[] => items.map((item) => {
        if ('items' in item) {
          return { ...item, items: attach(item.items) }
        }
        if (isRequest(item)) {
          return Object.assign(Object.create(Object.getPrototypeOf(item) as object), item, {
            authenticationRequestId: authId
          }) as FolderItem
        }
        return item
      })
      const attachedTree = attach(selectedItems)
      const firstFolderIdx = attachedTree.findIndex((item) => 'items' in item)
      if (firstFolderIdx >= 0) {
        const firstFolder = attachedTree[firstFolderIdx] as Extract<FolderItem, { items: FolderItem[] }>
        finalItems = [
          ...attachedTree.slice(0, firstFolderIdx),
          { ...firstFolder, items: [attachedAuth as unknown as FolderItem, ...firstFolder.items] },
          ...attachedTree.slice(firstFolderIdx + 1)
        ]
      } else {
        // Shouldn't happen in practice — every importer produces at
        // least one top-level folder — but fall back to prepending
        // at the true root rather than dropping the attached auth.
        finalItems = [attachedAuth as unknown as FolderItem, ...attachedTree]
      }
    }

    // Stamp the apiUpdate config on every top-level env folder so a
    // future refresh has every field the orchestrator needs: the URL
    // we just fetched from, the static defaults from the migration,
    // and the attached auth-route id when the user supplied one.
    // Tying sourceUrl in here — instead of leaving it to the legacy
    // migration step — means the "Refresh from source" entry shows
    // up immediately after the import, without waiting for the next
    // project reload.
    const sourceUrlAtImport = input.trim()
    const isUrlImport = sourceUrlAtImport.startsWith('http://') || sourceUrlAtImport.startsWith('https://')
    const stampApiUpdate = (items: FolderItem[]): FolderItem[] => items.map((item) => {
      if (!isEnvironmentFolder(item)) return item
      const stamped = { ...item } as EnvironmentFolder
      if (isUrlImport) {
        const existing = (stamped as unknown as { apiUpdate?: Record<string, unknown> }).apiUpdate ?? {}
        const apiDoc = (stamped as unknown as { apiDocumentation?: { api?: { version?: string } } }).apiDocumentation
        ;(stamped as unknown as { apiUpdate?: Record<string, unknown> }).apiUpdate = {
          sourceUrl: sourceUrlAtImport,
          autoCheckEnabled: false,
          interval: 'daily',
          ...(apiDoc?.api?.version !== undefined ? { lastImportedSpecVersion: apiDoc.api.version } : {}),
          ...existing,
          ...(attachedAuth ? { authenticationRequestId: attachedAuth.id } : {})
        }
      } else if (attachedAuth) {
        // File imports don't get a sourceUrl, but if the user
        // attached an auth route we still capture it for any manual
        // URL the user types into the env-folder home.
        const apiUpdate = (stamped as unknown as { apiUpdate?: Record<string, unknown> }).apiUpdate ?? {}
        ;(stamped as unknown as { apiUpdate?: Record<string, unknown> }).apiUpdate = {
          ...apiUpdate,
          authenticationRequestId: attachedAuth.id
        }
      }
      return stamped
    })
    finalItems = stampApiUpdate(finalItems)

    // Imports always land at the project root — the destination
    // picker (and the per-import "new folder" creation that went with
    // it) is gone until the import-screen redesign defines a path
    // that's actually wired through the persistence layer.
    onImport(finalItems)

    // Close modal (useEffect will clear state when modal closes)
    onClose()
  }, [previewItems, selection, input, onImport, onClose, attachedAuth, refreshContext])

  // Refresh-from-source bootstrap. When `refreshContext` is provided
  // we pre-fill the URL display + the auth pill from the env folder's
  // stored config, then ask main to do the preview. Main runs the
  // saved auth route through the env's first environment (so any
  // `{{var}}`-style placeholders get resolved before /login fires)
  // and returns the parsed-spec tree. Skipping the renderer-side
  // auth.prefetch path is what makes refresh handle Handlebars-style
  // variables the same way the apply path does.
  useEffect(() => {
    if (!isOpen || !refreshContext) return
    setInput(refreshContext.sourceUrl)
    setAttachedAuth(refreshContext.authenticationRequest ?? null)
    attachedAuthHeadersRef.current = null
    setIsLoading(true)
    setError(null)
    const token = { cancelled: false }
    void (async () => {
      try {
        const api = (window as unknown as {
          restorm?: { apiUpdate?: { previewTree?: (id: string) => Promise<{ success: boolean; items: unknown[]; lockedKeys?: string[]; error?: string }> } }
        }).restorm?.apiUpdate
        if (!api?.previewTree) throw new Error('apiUpdate.previewTree IPC unavailable')
        const result = await api.previewTree(refreshContext.targetFolderId)
        if (token.cancelled) return
        if (result.success) {
          setPreviewItems(result.items as FolderItem[])
          setLockedKeys(new Set(result.lockedKeys ?? []))
          setError(null)
        } else {
          setPreviewItems([])
          setLockedKeys(new Set())
          setError(result.error ?? t('import.error.unknown'))
        }
      } catch (err) {
        if (!token.cancelled) {
          setPreviewItems([])
          setLockedKeys(new Set())
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (!token.cancelled) setIsLoading(false)
      }
    })()
    return () => { token.cancelled = true }
  }, [isOpen, refreshContext, t])

  const handleAuthAttach = useCallback((authRequest: AuthenticationRequest, resolvedHeaders: Record<string, string>) => {
    setAttachedAuth(authRequest)
    attachedAuthHeadersRef.current = resolvedHeaders
    setShowAuthSetupModal(false)
    // Re-run the preview with the resolved auth headers.
    if (input.trim()) {
      handleInputChange(input)
    }
  }, [input, handleInputChange])

  const handleDetachAuth = useCallback(() => {
    setAttachedAuth(null)
    attachedAuthHeadersRef.current = null
    if (input.trim()) {
      handleInputChange(input)
    }
  }, [input, handleInputChange])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  // Whenever a fresh preview lands, default the selection.
  //
  // - Fresh import: every leaf checked, matching the legacy
  //   "import everything" UX.
  // - Refresh from source: only the locked leaves are pre-checked.
  //   A locked leaf is one whose operation is already present in the
  //   target folder (per the same `findOperationForRoute` matcher
  //   that drives Docs-tab visibility). New operations arrive
  //   unchecked so they show up as opt-in additions; locked leaves
  //   are read-only (the user can't opt them out). An empty
  //   `lockedKeys` set in refresh mode would surface every fresh
  //   route as a brand-new addition — that's the right default since
  //   it means the existing folder doesn't cover any of the spec's
  //   current operations.
  useEffect(() => {
    if (refreshContext) {
      setSelection(new Set(lockedKeys))
      return
    }
    setSelection(allLeafKeys(previewItems))
  }, [previewItems, refreshContext, lockedKeys])

  // Counter shown on the confirm button — only checked **and**
  // enabled leaves count. Locked leaves are forced-checked but the
  // user has no choice over them, so surfacing them in "Apply update
  // (N)" would mislead about how many routes the user is actually
  // opting into. Subtracting `lockedKeys.size` from `selection.size`
  // works because the modal always keeps every locked key in the
  // selection (init + folder toggle + select-none all preserve them).
  const selectedLeafCount = Math.max(0, selection.size - lockedKeys.size)

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setInput('')
      setPreviewItems([])
      setSelection(new Set())
      setLockedKeys(new Set())
      setSearchFilter('')
      setError(null)
      setIsLoading(false)
    }
  }, [isOpen])

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={refreshContext
        ? t('import.refreshTitle', 'Refresh from source')
        : t('import.title')}
      data-testid="import-modal-dialog"
    >
      <div
        className="import-modal"
        data-testid="import-modal"
        data-refresh-mode={refreshContext ? 'true' : undefined}
      >

        {/* Source Input */}
        <div className="import-section">
          <label className="import-label">
            {t('import.source.label')}
          </label>
          {refreshContext ? (
            // Refresh mode: the URL is bound to the env folder's
            // stored apiUpdate config and isn't editable here. Render
            // it read-only so the user still sees what's being
            // refreshed.
            <div
              data-testid="source-input-readonly"
              style={{
                padding: '6px 10px',
                borderRadius: 4,
                border: '1px solid var(--input-border, #555)',
                background: 'var(--input-background, #1e1e1e)',
                color: 'var(--input-foreground, #ddd)',
                fontFamily: 'monospace',
                fontSize: 12,
                wordBreak: 'break-all'
              }}
            >
              {refreshContext.sourceUrl}
            </div>
          ) : (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
            >
              <InputBox
                value={input}
                onChange={handleInputChange}
                options={{
                  placeholder: t('import.source.placeholder'),
                  flexibleHeight: true,
                  flexibleMaxHeight: 200
                }}
                data-testid="source-input"
              />
            </div>
          )}
          {isLoading && (
            <div className="import-loading" role="status">
              <i className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
              {t('import.loading')}
            </div>
          )}
          {error && (
            <div className="import-error" role="alert">
              <i className="codicon codicon-error" aria-hidden="true" />
              <span style={{ flex: 1 }}>{error}</span>
            </div>
          )}
          {/* Auth-route attach is always available — not just on 401/403 —
              so users can pre-wire APIs that need a token even when the
              first request otherwise succeeds (or on file-based imports). */}
          {!attachedAuth ? (
            <div style={{ alignSelf: 'flex-start' }}>
              <Button
                icon="key"
                onClick={() => { setShowAuthSetupModal(true) }}
                options={{
                  ariaLabel: t('import.addAuth', 'Add an authentication route'),
                  title: t('import.addAuth', 'Add an authentication route')
                }}
                data-testid="import-add-auth-button"
              >
                {t('import.addAuth', 'Add an authentication route')}
              </Button>
            </div>
          ) : null}
          {attachedAuth ? (
            <div
              className="import-auth-pill"
              data-testid="import-auth-pill"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 4px 4px 8px',
                borderRadius: 12,
                background: '#f97316',
                color: '#ffffff',
                fontSize: 12,
                alignSelf: 'flex-start'
              }}
            >
              <button
                type="button"
                onClick={() => { setShowAuthSetupModal(true) }}
                title={t('import.editAuth', 'Edit authentication route')}
                aria-label={t('import.editAuth', 'Edit authentication route')}
                data-testid="import-edit-auth-button"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  border: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  padding: 0,
                  cursor: 'pointer',
                  font: 'inherit'
                }}
              >
                <i className="codicon codicon-key" aria-hidden="true" />
                <span>{t('import.authenticatedVia', 'Authenticated via {{name}}', { name: attachedAuth.name || 'auth route' })}</span>
              </button>
              <Button
                small
                icon="close"
                onClick={handleDetachAuth}
                options={{
                  ariaLabel: t('import.detachAuth', 'Detach authentication route'),
                  title: t('import.detachAuth', 'Detach authentication route')
                }}
                data-testid="import-detach-auth-button"
              />
            </div>
          ) : null}
        </div>

        {/* Format showcase — pitches one supported import format at a
            time when there's nothing to preview yet. Hidden in refresh
            mode (the user already chose a format the day they imported)
            and once a preview tree is on screen. */}
        {!refreshContext && previewItems.length === 0 && (
          <ImportFormatShowcase />
        )}

        {/* Section 3: Selection tree (preview + tri-state checkboxes) */}
        {previewItems.length > 0 && (
          <div className="import-section import-preview-section">
            <div className="import-preview-header">
              <label className="import-label">
                {t('import.preview.label')}
              </label>
              <div className="import-preview-actions">
                <Button
                  secondary
                  onClick={() => { setSelection(allLeafKeys(previewItems)) }}
                  data-testid="import-select-all-button"
                >
                  {t('import.selectAll', 'Select all')}
                </Button>
                <Button
                  secondary
                  onClick={() => {
                    // Locked leaves stay checked even on "Select none"
                    // — opting them out would silently drop a route the
                    // target folder already exposes.
                    setSelection(new Set(lockedKeys))
                  }}
                  data-testid="import-select-none-button"
                >
                  {t('import.selectNone', 'Select none')}
                </Button>
              </div>
            </div>
            <div className="import-preview-search">
              <InputBox
                value={searchFilter}
                onChange={setSearchFilter}
                options={{ placeholder: t('import.searchPlaceholder', 'Filter routes / folders…') }}
                data-testid="import-selection-search"
              />
            </div>
            <div className="import-preview">
              <ImportSelectionTree
                items={previewItems}
                selection={selection}
                onSelectionChange={setSelection}
                searchFilter={searchFilter}
                lockedKeys={lockedKeys}
                data-testid="import-selection-tree"
              />
            </div>
          </div>
        )}

        {!isLoading && !error && previewItems.length === 0 && input.trim() !== '' && (
          <div className="import-no-results" role="status">
            <i className="codicon codicon-info" aria-hidden="true" />
            {t('import.noResults')}
          </div>
        )}

        {/* Actions */}
        <div className="import-actions">
          <Button secondary onClick={onClose} data-testid="cancel-button">
            {t('import.cancel')}
          </Button>
          <Button
            emphasis={1}
            onClick={handleImportClick}
            disabled={previewItems.length === 0 || selection.size === 0}
            data-testid="import-button"
          >
            {(() => {
              const baseLabel = refreshContext
                ? t('import.applyUpdate', 'Apply update')
                : t('import.ok')
              return selectedLeafCount > 0
                ? t('import.okN', '{{action}} ({{count}})', { action: baseLabel, count: selectedLeafCount })
                : baseLabel
            })()}
          </Button>
        </div>
      </div>

      <AuthenticationSetupModal
        isOpen={showAuthSetupModal}
        onClose={() => { setShowAuthSetupModal(false) }}
        onAttach={handleAuthAttach}
        {...(attachedAuth ? { initialRequest: attachedAuth } : {})}
      />
    </Modal>
  )
}
